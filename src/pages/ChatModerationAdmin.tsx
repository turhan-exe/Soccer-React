import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import BackButton from '@/components/ui/back-button';
import { AlertTriangle, Ban, BellOff, CheckCircle2, MessageSquare, ShieldAlert, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CHAT_RETENTION_DAYS,
  filterRetainedGlobalChatMessages,
  getGlobalChatRetentionCutoffMs,
  subscribeToGlobalChat,
} from '@/services/chat';
import type { GlobalChatMessage } from '@/types';
import {
  collection,
  type DocumentData,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  query,
  startAfter,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/services/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { getMatchControlPresenceStats, getRegisteredUsersCount, isMatchControlConfigured } from '@/services/matchControl';

type Severity = 'low' | 'medium' | 'high';
type MessageStatus = 'active' | 'deleted';
type ModerationActionType = 'delete' | 'timeout' | 'ban';

type ChatMessage = {
  id: string;
  playerName: string;
  playerTag: string;
  channel: 'Global' | 'Guild' | 'Match';
  text: string;
  timestamp: number;
  severity: Severity;
  flags: string[];
  status: MessageStatus;
  userId?: string | null;
};

type ModeratedUser = {
  userName: string;
  userTag: string;
  type: Exclude<ModerationActionType, 'delete'>;
  reason: string;
  startedAt: number;
  expiresAt: number | null;
  userId?: string | null;
};

type ActionLogEntry = {
  id: string;
  userName: string;
  userTag: string;
  action: ModerationActionType;
  detail: string;
  moderator: string;
  timestamp: number;
};

type AdminSession = {
  name: string;
  email: string;
};

type PlayerSummary = {
  id: string;
  username: string;
  teamLabel: string;
  lastMessage: string;
  lastSeen: number;
};

const ADMIN_EMAIL_DOMAIN = 'mgx.gg';
const CHAT_PAGE_SIZE = 100;
const CHAT_PAGE_FETCH_LIMIT = CHAT_PAGE_SIZE + 1;
const CHAT_REALTIME_WINDOW_LIMIT = 100;
const CHAT_API_ENDPOINT = import.meta.env.VITE_CHAT_API_ENDPOINT || '';
const USERS_API_ENDPOINT = import.meta.env.VITE_USERS_API_ENDPOINT || '';
const SANCTION_ENDPOINT = import.meta.env.VITE_CHAT_SANCTION_ENDPOINT || '';
const SANCTION_SECRET = import.meta.env.VITE_CHAT_SANCTION_SECRET || '';

const severityConfig: Record<Severity, { label: string; badgeClass: string }> = {
  low: { label: 'Dusuk', badgeClass: 'bg-emerald-400/15 text-emerald-300 border-emerald-500/40' },
  medium: { label: 'Orta', badgeClass: 'bg-amber-400/15 text-amber-200 border-amber-500/40' },
  high: { label: 'Kritik', badgeClass: 'bg-rose-500/15 text-rose-200 border-rose-500/40' },
};

const keywordMatrix = [
  { label: 'Toksik Dil', weight: 'medium' as Severity, patterns: ['idiot', 'ez', 'trash'] },
  { label: 'Hile Iddiasi', weight: 'medium' as Severity, patterns: ['cheat', 'hack', 'script'] },
  { label: 'Nefret Soylemi', weight: 'high' as Severity, patterns: ['kill yourself', 'die', 'bomb'] },
  { label: 'Flood', weight: 'low' as Severity, patterns: ['spam', '!!!!', '1234'] },
];

const SANCTIONS_COLLECTION = 'chatSanctions';

const messageJsonSchema = {
  $id: 'mgx.chat.message',
  type: 'object',
  required: ['id', 'playerName', 'playerTag', 'channel', 'text', 'timestamp', 'severity', 'flags', 'status'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    playerName: { type: 'string' },
    playerTag: { type: 'string' },
    channel: { type: 'string', enum: ['Global', 'Guild', 'Match'] },
    text: { type: 'string' },
    timestamp: { type: 'number' },
    severity: { type: 'string', enum: ['low', 'medium', 'high'] },
    flags: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['active', 'deleted'] },
  },
} as const;

const userJsonSchema = {
  $id: 'mgx.chat.user',
  type: 'object',
  required: ['id', 'username', 'teamLabel', 'lastSeen'],
  properties: {
    id: { type: 'string' },
    username: { type: 'string' },
    teamLabel: { type: 'string' },
    lastMessage: { type: 'string' },
    lastSeen: { type: 'number' },
    status: { type: 'string', enum: ['active', 'timeout', 'ban'] },
  },
} as const;

const generateRandomId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const loginProfiles = [
  { email: 'ops.lead@mgx.gg', password: 'SecureMod#42', otp: '842310', name: 'Ece Korkmaz' },
  { email: 'safety@mgx.gg', password: 'Moderation!54', otp: '113579', name: 'Deniz Ufuk' },
];

const ensureDateValue = (value: unknown): Date => {
  const millis = toMillis(value);
  return new Date(millis ?? Date.now());
};

type ChatMessagesCursor =
  | { kind: 'firestore'; snapshot: QueryDocumentSnapshot<DocumentData> }
  | { kind: 'api'; beforeMs: number }
  | null;

type ChatMessagesPage = {
  items: ChatMessage[];
  cursor: ChatMessagesCursor;
  hasMore: boolean;
};

const normalizeGlobalChatMessages = (
  payload: Partial<GlobalChatMessage>[],
): GlobalChatMessage[] =>
  filterRetainedGlobalChatMessages(
    payload.map((item) => ({
      id: String(item.id ?? generateRandomId()),
      text: String(item.text ?? ''),
      userId: typeof item.userId === 'string' ? item.userId : '',
      username: String(item.username ?? item.teamName ?? 'Menajer'),
      teamName: String(item.teamName ?? 'Takimim'),
      createdAt: ensureDateValue(item.createdAt ?? Date.now()),
      expiresAt: item.expiresAt ? ensureDateValue(item.expiresAt) : null,
      isVip: Boolean(item.isVip),
      gradientStart: typeof item.gradientStart === 'string' ? item.gradientStart : null,
      gradientEnd: typeof item.gradientEnd === 'string' ? item.gradientEnd : null,
      gradientAngle: typeof item.gradientAngle === 'number' ? item.gradientAngle : null,
    })),
  );

const toModerationMessages = (items: GlobalChatMessage[]): ChatMessage[] =>
  items
    .map(transformIncomingMessage)
    .sort((left, right) => right.timestamp - left.timestamp);

const mergeChatMessages = (
  current: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] => {
  const merged = new Map<string, ChatMessage>();

  current.forEach((message) => {
    merged.set(message.id, message);
  });

  incoming.forEach((message) => {
    const existing = merged.get(message.id);
    merged.set(
      message.id,
      existing?.status === 'deleted'
        ? { ...message, status: 'deleted' }
        : message,
    );
  });

  return Array.from(merged.values()).sort(
    (left, right) => right.timestamp - left.timestamp,
  );
};

const fetchMessagesPage = async (
  cursor: ChatMessagesCursor = null,
): Promise<ChatMessagesPage> => {
  const retentionCutoffMs = getGlobalChatRetentionCutoffMs();

  if (CHAT_API_ENDPOINT) {
    const params = new URLSearchParams({
      limit: String(CHAT_PAGE_SIZE),
      sinceMs: String(retentionCutoffMs),
    });

    if (cursor?.kind === 'api') {
      params.set('before', String(cursor.beforeMs));
      params.set('beforeMs', String(cursor.beforeMs));
    }

    const response = await fetch(
      `${CHAT_API_ENDPOINT}/chat/messages?${params.toString()}`,
    );
    if (!response.ok) {
      throw new Error('Sohbet API istegi basarisiz.');
    }
    const payload = normalizeGlobalChatMessages(
      (await response.json()) as Partial<GlobalChatMessage>[],
    ).sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );

    const pageItems = payload.slice(0, CHAT_PAGE_SIZE);
    const nextBeforeMs = pageItems.at(-1)?.createdAt.getTime() ?? null;
    const requestedBeforeMs = cursor?.kind === 'api' ? cursor.beforeMs : null;
    const hasMore =
      pageItems.length === CHAT_PAGE_SIZE
      && nextBeforeMs !== null
      && (requestedBeforeMs === null || nextBeforeMs < requestedBeforeMs);

    return {
      items: toModerationMessages(pageItems),
      cursor: hasMore && nextBeforeMs !== null
        ? { kind: 'api', beforeMs: nextBeforeMs }
        : null,
      hasMore,
    };
  }

  const queryConstraints: QueryConstraint[] = [
    where('createdAt', '>=', Timestamp.fromMillis(retentionCutoffMs)),
    orderBy('createdAt', 'desc'),
  ];

  if (cursor?.kind === 'firestore') {
    queryConstraints.push(startAfter(cursor.snapshot));
  }

  queryConstraints.push(limit(CHAT_PAGE_FETCH_LIMIT));

  const snapshot = await getDocs(
    query(collection(db, 'globalChatMessages'), ...queryConstraints),
  );
  const hasMore = snapshot.docs.length > CHAT_PAGE_SIZE;
  const pageDocs = hasMore
    ? snapshot.docs.slice(0, CHAT_PAGE_SIZE)
    : snapshot.docs;

  const items = normalizeGlobalChatMessages(
    pageDocs.map((docSnapshot) => {
      const data = docSnapshot.data();
      return {
        id: docSnapshot.id,
        text: String(data.text ?? ''),
        userId: typeof data.userId === 'string' ? data.userId : '',
        username: String(data.username ?? data.teamName ?? 'Menajer'),
        teamName: String(data.teamName ?? 'Takimim'),
        createdAt: ensureDateValue(data.createdAt),
        expiresAt: data.expiresAt ? ensureDateValue(data.expiresAt) : null,
        isVip: Boolean(data.isVip),
        gradientStart: typeof data.gradientStart === 'string' ? data.gradientStart : null,
        gradientEnd: typeof data.gradientEnd === 'string' ? data.gradientEnd : null,
        gradientAngle: typeof data.gradientAngle === 'number' ? data.gradientAngle : null,
      } satisfies Partial<GlobalChatMessage>;
    }),
  );

  return {
    items: toModerationMessages(items),
    cursor: hasMore && pageDocs.length > 0
      ? { kind: 'firestore', snapshot: pageDocs[pageDocs.length - 1] }
      : null,
    hasMore,
  };
};

const fetchUsers = async (
  blockedUsers: Map<string, ModeratedUser>,
  seedMessages?: ChatMessage[],
): Promise<PlayerSummary[]> => {
  if (USERS_API_ENDPOINT) {
    const response = await fetch(`${USERS_API_ENDPOINT}/chat/users?limit=12`);
    if (!response.ok) {
      throw new Error('Kullanici API istegi basarisiz.');
    }
    const payload = (await response.json()) as Array<{
      id?: string;
      username?: string;
      teamLabel?: string;
      teamName?: string;
      lastSeen?: number;
      lastMessage?: string;
    }>;
    return payload
      .map((record) => ({
        id: record.id ?? generateRandomId(),
        username: record.username || record.teamLabel || record.teamName || 'Bilinmeyen',
        teamLabel: record.teamLabel || record.teamName || 'Takimim',
        lastMessage: record.lastMessage || '',
        lastSeen: typeof record.lastSeen === 'number' ? record.lastSeen : Date.now(),
      }))
      .filter(
        (record) =>
          !blockedUsers.has(record.id) &&
          !blockedUsers.has(record.teamLabel) &&
          !blockedUsers.has(record.username),
      )
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, 12);
  }

  if (seedMessages?.length) {
    return derivePlayers(seedMessages, blockedUsers);
  }

  const fallback = await fetchMessagesPage();
  return derivePlayers(fallback.items, blockedUsers);
};

const evaluateMessage = (text: string): { severity: Severity; flags: string[] } => {
  let severity: Severity = 'low';
  const matches = new Set<string>();

  keywordMatrix.forEach(({ label, weight, patterns }) => {
    if (patterns.some((pattern) => text.toLowerCase().includes(pattern))) {
      matches.add(label);
      if (weight === 'high') severity = 'high';
      if (weight === 'medium' && severity !== 'high') severity = 'medium';
    }
  });

  if (matches.size === 0) {
    return { severity: 'low', flags: [] };
  }

  return { severity, flags: Array.from(matches) };
};

const transformIncomingMessage = (message: GlobalChatMessage): ChatMessage => {
  const { severity, flags } = evaluateMessage(message.text ?? '');
  const timestamp = message.createdAt instanceof Date ? message.createdAt.getTime() : Date.now();
  const teamLabel = message.teamName?.trim() || 'Takim Bilinmiyor';
  const fallbackTag = message.userId ? message.userId.slice(-4) : teamLabel.slice(0, 4) || '0000';

  return {
    id: message.id,
    playerName: message.username || teamLabel,
    playerTag: fallbackTag,
    channel: 'Global',
    text: message.text,
    timestamp,
    severity,
    flags,
    status: 'active',
    userId: message.userId ?? null,
  };
};

const toMillis = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value !== null && 'toDate' in (value as { toDate: () => Date })) {
    try {
      return ((value as { toDate: () => Date }).toDate() as Date).getTime();
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && value !== null && 'toMillis' in (value as { toMillis: () => number })) {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch {
      return null;
    }
  }
  return null;
};

const derivePlayers = (items: ChatMessage[], blockedUsers: Map<string, ModeratedUser>): PlayerSummary[] => {
  const map = new Map<string, PlayerSummary>();

  items.forEach((message) => {
    if (blockedUsers.has(message.playerTag)) {
      return;
    }

    const key = message.userId || `${message.playerName}-${message.playerTag}`;
    const existing = map.get(key);
    if (!existing || existing.lastSeen < message.timestamp) {
      map.set(key, {
        id: key,
        username: message.playerName,
        teamLabel: message.playerTag,
        lastMessage: message.text,
        lastSeen: message.timestamp,
      });
    }
  });

  return Array.from(map.values())
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 8);
};

const getInitials = (name: string) =>
  name
    .split(' ')
    .map((chunk) => chunk[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const formatTimeDistance = (timestamp: number) =>
  formatDistanceToNow(new Date(timestamp), { addSuffix: true, includeSeconds: false });

const actionLabels: Record<ModerationActionType, string> = {
  delete: 'Mesaj Silindi',
  timeout: 'Timeout/Mute',
  ban: 'Kalici Ban',
};

const actionIcons: Record<ModerationActionType, JSX.Element> = {
  delete: <AlertTriangle className="h-4 w-4 text-amber-300" />,
  timeout: <BellOff className="h-4 w-4 text-sky-300" />,
  ban: <Ban className="h-4 w-4 text-rose-400" />,
};

const timeoutDurationPresets = [
  { label: '15 dk', minutes: 15 },
  { label: '1 Saat', minutes: 60 },
  { label: '1 Gun', minutes: 1440 },
  { label: '1 Ay', minutes: 43200 },
] as const;

const ChatModerationAdmin = () => {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState({ email: '', password: '', otp: '' });
  const [sessionUser, setSessionUser] = useState<AdminSession | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesCursor, setMessagesCursor] = useState<ChatMessagesCursor>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const [moderatedUsers, setModeratedUsers] = useState<ModeratedUser[]>([]);
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [actionForm, setActionForm] = useState({ reason: '', duration: 60, notifyPlayer: true });
  const [actionError, setActionError] = useState<string | null>(null);
  const [isApplyingAction, setIsApplyingAction] = useState(false);

  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [playerSummaries, setPlayerSummaries] = useState<PlayerSummary[]>([]);
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(true);
  const [playersError, setPlayersError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [registeredUsersCount, setRegisteredUsersCount] = useState<number | null>(null);
  const [onlineUsersCount, setOnlineUsersCount] = useState<number | null>(null);
  const [onlineUsersTtlSec, setOnlineUsersTtlSec] = useState<number | null>(null);
  const [isLoadingAudienceStats, setIsLoadingAudienceStats] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    let isMounted = true;
    setIsLoadingMessages(true);
    setDataError(null);

    const hydrateFromBackend = async () => {
      try {
        const initialPage = await fetchMessagesPage();
        if (!isMounted) return;
        setMessages(initialPage.items);
        setMessagesCursor(initialPage.cursor);
        setHasMoreMessages(initialPage.hasMore);
        setSelectedMessageId((current) => current ?? initialPage.items[0]?.id ?? null);
      } catch (error) {
        console.error('[chat] fetchMessages failed', error);
        if (isMounted) {
          setDataError('Sohbet akisi cekilemedi. Sayfayi yenileyin.');
          setMessagesCursor(null);
          setHasMoreMessages(false);
        }
      } finally {
        if (isMounted) {
          setIsLoadingMessages(false);
        }
      }
    };

    void hydrateFromBackend();

    const unsubscribe = subscribeToGlobalChat(
      (incomingMessages) => {
        if (!isMounted) return;
        const hydrated = toModerationMessages(incomingMessages);
        setMessages((prev) => mergeChatMessages(prev, hydrated));
        setSelectedMessageId((current) => current ?? hydrated[0]?.id ?? null);
        setIsLoadingMessages(false);
        setDataError(null);
      },
      (error) => {
        console.error('[chat] moderasyon akisi okunamadi', error);
        if (isMounted) {
          setDataError('Sohbet akisi cekilemedi. Sayfayi yenileyin.');
          setIsLoadingMessages(false);
        }
      },
      {
        limitCount: CHAT_REALTIME_WINDOW_LIMIT,
        sinceMs: getGlobalChatRetentionCutoffMs(),
      },
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const loadMoreMessages = async () => {
    if (!hasMoreMessages || !messagesCursor || isLoadingMoreMessages) {
      return;
    }

    setIsLoadingMoreMessages(true);
    setDataError(null);

    try {
      const nextPage = await fetchMessagesPage(messagesCursor);
      setMessages((prev) => mergeChatMessages(prev, nextPage.items));
      setMessagesCursor(nextPage.cursor);
      setHasMoreMessages(nextPage.hasMore);
    } catch (error) {
      console.error('[chat] fetchMessagesPage failed', error);
      setDataError('Eski mesajlar yuklenemedi. Lutfen tekrar deneyin.');
    } finally {
      setIsLoadingMoreMessages(false);
    }
  };

  useEffect(() => {
    const sanctionsQuery = query(collection(db, SANCTIONS_COLLECTION), orderBy('startedAt', 'desc'));
    const unsubscribe = onSnapshot(
      sanctionsQuery,
      (snapshot) => {
        const records: ModeratedUser[] = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          const type: ModeratedUser['type'] = data.type === 'ban' ? 'ban' : 'timeout';
          const expiresAt = type === 'ban' ? null : toMillis(data.expiresAt);
          return {
            userName: data.userName ?? data.username ?? 'Bilinmeyen',
            userTag: data.userTag ?? data.userId ?? docSnapshot.id,
            userId: data.userId ?? null,
            type,
            reason: data.reason ?? 'Belirtilmedi',
            startedAt: toMillis(data.startedAt) ?? Date.now(),
            expiresAt,
          };
        });
        setModeratedUsers(records);
      },
      (error) => {
        console.error('[chat] sanctions listener failed', error);
        setActionError('Yaptirim verisine erisim izni yok. Firestore kurallarini guncelleyin.');
      },
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAuthenticated || !user?.email) {
      return;
    }

    const normalizedEmail = user.email.toLowerCase().trim();
    const profile = loginProfiles.find(
      (candidate) => candidate.email.toLowerCase().trim() === normalizedEmail,
    );

    if (profile) {
      setIsAuthenticated(true);
      setSessionUser({ name: profile.name, email: profile.email });
      setLoginError(null);
    }
  }, [isAuthenticated, user]);

  const activeSanctions = useMemo(
    () => moderatedUsers.filter((record) => record.expiresAt === null || record.expiresAt > Date.now()),
    [moderatedUsers],
  );

  const activeSanctionsMap = useMemo(() => {
    const map = new Map<string, ModeratedUser>();
    activeSanctions.forEach((record) => {
      map.set(record.userTag, record);
      if (record.userId) {
        map.set(record.userId, record);
      }
    });
    return map;
  }, [activeSanctions]);

  const filteredMessages = useMemo(() => {
    return messages.filter((message) => {
      if (message.status === 'deleted') return false;
      if ((message.userId && activeSanctionsMap.has(message.userId)) || activeSanctionsMap.has(message.playerTag)) return false;
      if (severityFilter !== 'all' && message.severity !== severityFilter) return false;
      if (flaggedOnly && message.flags.length === 0) return false;
      if (!searchTerm) return true;

      const term = searchTerm.toLowerCase();
      return (
        message.playerName.toLowerCase().includes(term) ||
        message.playerTag.toLowerCase().includes(term) ||
        message.text.toLowerCase().includes(term)
      );
    });
  }, [messages, severityFilter, flaggedOnly, searchTerm, activeSanctionsMap]);

  useEffect(() => {
    if (!selectedMessageId && filteredMessages.length > 0) {
      setSelectedMessageId(filteredMessages[0]?.id ?? null);
      return;
    }

    if (selectedMessageId && !messages.find((message) => message.id === selectedMessageId && message.status === 'active')) {
      setSelectedMessageId(filteredMessages[0]?.id ?? null);
    }
  }, [filteredMessages, messages, selectedMessageId]);

  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedMessageId),
    [messages, selectedMessageId],
  );

  const flaggedCount = messages.filter((message) => message.flags.length > 0 && message.status === 'active').length;
  const totalActiveMessages = messages.filter((message) => message.status === 'active').length;

  useEffect(() => {
    let isActive = true;
    if (playerSummaries.length === 0) {
      setIsLoadingPlayers(true);
      setPlayersError(null);
    }

    const hydratePlayers = async () => {
      try {
        const records = await fetchUsers(activeSanctionsMap, messages);
        if (!isActive) return;
        setPlayerSummaries(records);
        setPlayersError(null);
      } catch (error) {
        console.error('[chat] fetchUsers failed', error);
        if (isActive) {
          setPlayersError('Oyuncu listesi yuklenemedi.');
        }
      } finally {
        if (isActive) {
          setIsLoadingPlayers(false);
        }
      }
    };

    void hydratePlayers();

    return () => {
      isActive = false;
    };
  }, [messages, activeSanctionsMap, playerSummaries.length]);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    const loadAudienceStats = async () => {
      if (!cancelled) {
        setIsLoadingAudienceStats(true);
      }

      try {
        const [registeredCount, presenceStats] = await Promise.all([
          getRegisteredUsersCount(),
          isMatchControlConfigured()
            ? getMatchControlPresenceStats().catch((error) => {
                console.warn('[chat] presence stats unavailable', error);
                return null;
              })
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        setRegisteredUsersCount(registeredCount);
        setOnlineUsersCount(
          presenceStats && typeof presenceStats.onlineUsers === 'number'
            ? presenceStats.onlineUsers
            : null,
        );
        setOnlineUsersTtlSec(
          presenceStats && typeof presenceStats.ttlSec === 'number'
            ? presenceStats.ttlSec
            : null,
        );
      } catch (error) {
        console.error('[chat] audience stats failed', error);
      } finally {
        if (!cancelled) {
          setIsLoadingAudienceStats(false);
        }
      }
    };

    void loadAudienceStats();
    intervalId = window.setInterval(() => {
      void loadAudienceStats();
    }, 15000);

    return () => {
      cancelled = true;
      if (intervalId != null) {
        window.clearInterval(intervalId);
      }
    };
  }, []);

  const handleLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const profile = loginProfiles.find((candidate) => candidate.email === credentials.email);

    if (!credentials.email.endsWith(`@${ADMIN_EMAIL_DOMAIN}`)) {
      setLoginError(`Sadece @${ADMIN_EMAIL_DOMAIN} alan adindaki hesaplara izin verilir.`);
      return;
    }

    if (!profile || profile.password !== credentials.password || profile.otp !== credentials.otp) {
      setLoginError('Kimlik dogrulama basarisiz. Bilgileri kontrol edin.');
      return;
    }

    setIsAuthenticated(true);
    setSessionUser({ name: profile.name, email: profile.email });
    setCredentials({ email: '', password: '', otp: '' });
    setLoginError(null);
  };

  const logout = () => {
    setIsAuthenticated(false);
    setSessionUser(null);
    setSelectedMessageId(null);
  };

  const handleBackToHome = () => {
    logout();
    navigate('/');
  };

  const pushActionLog = (entry: Omit<ActionLogEntry, 'id' | 'timestamp'>) => {
    setActionLog((prev) => [{ id: generateRandomId(), timestamp: Date.now(), ...entry }, ...prev].slice(0, 20));
    setActionFeedback(`${entry.userName} kullanicisi icin ${actionLabels[entry.action]} uygulandi.`);
    setTimeout(() => setActionFeedback(null), 3500);
  };

  const updateMessageStatus = (messageId: string, status: MessageStatus) => {
    setMessages((prev) => prev.map((message) => (message.id === messageId ? { ...message, status } : message)));
  };

  const persistChatSanction = async (action: Exclude<ModerationActionType, 'delete'>, message: ChatMessage, reason: string) => {
    if (!SANCTION_ENDPOINT || !SANCTION_SECRET) {
      throw new Error('Moderasyon API yapilandirilamadi. .env degerlerini kontrol edin.');
    }

    const payload = {
      action,
      reason,
      durationMinutes: action === 'ban' ? null : actionForm.duration,
      message: {
        id: message.id,
        userId: message.userId ?? null,
        playerTag: message.playerTag,
        playerName: message.playerName,
      },
    };

    const response = await fetch(SANCTION_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': SANCTION_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage =
        (errorData as { message?: string } | null)?.message ?? 'Sunucu moderasyon istegi reddedildi.';
      throw new Error(errorMessage);
    }
  };

  const performModeration = async (action: ModerationActionType) => {
    if (!selectedMessage || !sessionUser) return;
    const finalReason = actionForm.reason.trim() || 'Genel davranis politikasi ihlali';
    setActionError(null);
    setIsApplyingAction(true);

    try {
      if (action === 'delete') {
        updateMessageStatus(selectedMessage.id, 'deleted');
      } else {
        await persistChatSanction(action, selectedMessage, finalReason);
      }

      pushActionLog({
        action,
        detail: finalReason,
        moderator: sessionUser.name,
        userName: selectedMessage.playerName,
        userTag: selectedMessage.playerTag,
      });
    } catch (error) {
      console.error('[chat-moderation] perform action failed', error);
      const message = error instanceof Error ? error.message : 'Moderasyon islemi tamamlanamadi. Lutfen tekrar deneyin.';
      setActionError(message);
    } finally {
      setIsApplyingAction(false);
    }
  };

  const renderLogin = () => (
    <div className="min-h-screen bg-slate-950 px-4 py-16 text-white">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Game Ops</p>
          <h1 className="text-3xl font-semibold text-white">Chat Moderation Admin</h1>
          <p className="mt-2 text-base text-slate-400">Yetkili moderatorler icin guvenli erisim.</p>
        </div>

        <Card className="border-slate-800 bg-slate-900/80 backdrop-blur">
          <CardHeader>
            <CardTitle>Iki Adimli Giris</CardTitle>
            <CardDescription>Kurumsal kimlik bilgilerinizi ve tek kullanimlik kodu girin.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleLogin}>
              <div className="space-y-2">
                <Label htmlFor="email">Kurumsal E-posta</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={`moderator@${ADMIN_EMAIL_DOMAIN}`}
                  value={credentials.email}
                  onChange={(event) => setCredentials((prev) => ({ ...prev, email: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Parola</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="En az 8 karakter"
                  value={credentials.password}
                  onChange={(event) => setCredentials((prev) => ({ ...prev, password: event.target.value }))}
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="otp">Tek Kullanimlik Kod</Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={credentials.otp}
                  onChange={(event) => setCredentials((prev) => ({ ...prev, otp: event.target.value }))}
                  required
                />
                <p className="text-xs text-slate-500">Kod, guvenlik anahtariniz uzerinden uretilir.</p>
              </div>

              {loginError ? <p className="text-sm text-rose-400">{loginError}</p> : null}

              <Button type="submit" className="w-full">
                Guvenli Giris Yap
              </Button>
            </form>

            <Separator className="my-6 bg-slate-800" />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>Deneme icin: ops.lead@mgx.gg / SecureMod#42 / 842310</span>
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  if (!isAuthenticated || !sessionUser) {
    return renderLogin();
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-950 px-3 py-6 text-slate-100 sm:px-4 sm:py-7">
      <div className="mx-auto flex min-w-0 w-full max-w-[1280px] flex-col gap-4 lg:gap-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <BackButton
              fallbackPath="/"
              className="mt-1 border border-slate-800 bg-slate-900/80 text-slate-100 hover:bg-slate-800 hover:text-white"
            />
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Game Ops</p>
              <h1 className="text-2xl font-semibold text-white md:text-[28px]">Chat Moderation Admin Panel</h1>
              <p className="mt-1 text-xs text-slate-400 md:text-sm">
                Gercek zamanli mesaj akis, hizli aksiyon butonlari ve yaptirim kayitlari tek ekranda.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2.5">
            <div>
              <p className="text-xs text-slate-500">Aktif Operator</p>
              <p className="font-semibold text-white">{sessionUser.name}</p>
              <p className="text-xs text-slate-500">{sessionUser.email}</p>
            </div>
          </div>
        </header>

        {dataError ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{dataError}</div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Card className="border-slate-800 bg-slate-900/70">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-1 pt-4">
              <CardTitle className="text-sm font-medium text-slate-400">Aktif Mesaj</CardTitle>
              <MessageSquare className="h-4 w-4 text-slate-500" />
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="text-2xl font-semibold text-white">{isLoadingMessages ? '...' : totalActiveMessages}</div>
              <p className="text-xs text-slate-500">son {CHAT_RETENTION_DAYS} gun icinde</p>
            </CardContent>
          </Card>
          <Card className="border-slate-800 bg-slate-900/70">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-1 pt-4">
              <CardTitle className="text-sm font-medium text-slate-400">Isaretlenen Icerik</CardTitle>
              <AlertTriangle className="h-4 w-4 text-amber-300" />
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="text-2xl font-semibold text-amber-200">{isLoadingMessages ? '...' : flaggedCount}</div>
              <p className="text-xs text-slate-500">otomatik filtre + manuel flag</p>
            </CardContent>
          </Card>
          <Card className="border-slate-800 bg-slate-900/70">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-1 pt-4">
              <CardTitle className="text-sm font-medium text-slate-400">Aktif Yaptirim</CardTitle>
              <ShieldAlert className="h-4 w-4 text-sky-300" />
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="text-2xl font-semibold text-sky-100">{activeSanctions.length}</div>
              <p className="text-xs text-slate-500">mute + kalici ban toplami</p>
            </CardContent>
          </Card>
          <Card className="border-slate-800 bg-slate-900/70">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-1 pt-4">
              <CardTitle className="text-sm font-medium text-slate-400">Kayitli Oyuncu</CardTitle>
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="text-2xl font-semibold text-emerald-100">
                {isLoadingAudienceStats && registeredUsersCount === null ? '...' : registeredUsersCount ?? '-'}
              </div>
              <p className="text-xs text-slate-500">users koleksiyonundaki toplam hesap</p>
            </CardContent>
          </Card>
          <Card className="border-slate-800 bg-slate-900/70">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-1 pt-4">
              <CardTitle className="text-sm font-medium text-slate-400">Online Oyuncu</CardTitle>
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="text-2xl font-semibold text-emerald-200">
                {isLoadingAudienceStats && onlineUsersCount === null ? '...' : onlineUsersCount ?? '-'}
              </div>
              <p className="text-xs text-slate-500">
                son {onlineUsersTtlSec ?? 30} sn icinde heartbeat atan oyuncu
              </p>
            </CardContent>
          </Card>
        </section>

        {actionFeedback ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              <span>{actionFeedback}</span>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-3 md:gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
          <Card className="min-w-0 border-slate-800 bg-slate-900/70">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Gercek Zamanli Sohbet Akisi</CardTitle>
                  <CardDescription>Son {CHAT_RETENTION_DAYS} gunu filtrele, ara ve mesajlara tikla.</CardDescription>
                </div>
                <Badge variant="outline" className="border-emerald-500/50 text-emerald-300">
                  {new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} itibariyla canli
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="space-y-2">
                <Input
                  className="h-9 w-full"
                  placeholder="Oyuncu veya mesaj ara"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {(['all', 'low', 'medium', 'high'] as const).map((filterValue) => (
                      <Button
                        key={filterValue}
                        variant={severityFilter === filterValue ? 'default' : 'outline'}
                        className={cn(
                          'h-8 px-2.5 text-xs font-medium',
                          severityFilter === filterValue ? 'bg-slate-100 text-slate-900' : 'border-slate-700 text-slate-300',
                        )}
                        onClick={() => setSeverityFilter(filterValue)}
                      >
                        {filterValue === 'all' ? 'Tumu' : severityConfig[filterValue].label}
                      </Button>
                    ))}
                  </div>
                  <div className="flex h-8 shrink-0 items-center gap-2 rounded-xl border border-slate-800 px-2.5">
                    <Switch checked={flaggedOnly} onCheckedChange={setFlaggedOnly} id="flag-switch" />
                    <Label htmlFor="flag-switch" className="text-xs text-slate-400">
                      Sadece Flaglenenler
                    </Label>
                  </div>
                </div>
              </div>

              <ScrollArea className="h-[calc(100vh-280px)] min-h-[460px] pr-3">
                <div className="space-y-3">
                  {isLoadingMessages ? (
                    <div className="rounded-2xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">
                      Mesajlar yukleniyor...
                    </div>
                  ) : filteredMessages.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">
                      Kriterlere uyan mesaj bulunamadi.
                    </div>
                  ) : (
                    filteredMessages.map((message) => (
                      <button
                        key={message.id}
                        type="button"
                        onClick={() => setSelectedMessageId(message.id)}
                        className={cn(
                          'group flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all hover:border-slate-500/50 hover:bg-slate-800/40',
                          message.id === selectedMessageId
                            ? 'border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_15px_-3px_rgba(16,185,129,0.1)]'
                            : 'border-slate-800 bg-slate-900/40',
                        )}
                      >
                        <Avatar className="mt-0.5 h-7 w-7 border border-white/10 transition-colors group-hover:border-white/20">
                          <AvatarFallback className="bg-slate-800/80 text-[10px] font-medium text-slate-300">
                            {getInitials(message.playerName)}
                          </AvatarFallback>
                        </Avatar>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 overflow-hidden">
                              <span className="truncate text-sm font-semibold text-white group-hover:text-emerald-300 transition-colors">
                                {message.playerName}
                              </span>
                              <span className="text-[10px] text-slate-500">#{message.playerTag}</span>
                              <span className="text-[10px] text-slate-600">
                                • {formatTimeDistance(message.timestamp)}
                              </span>
                            </div>
                            <Badge
                              variant="outline"
                              className={cn('border text-[10px] px-1.5 py-0', severityConfig[message.severity].badgeClass)}
                            >
                              {severityConfig[message.severity].label}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-slate-300 leading-relaxed break-words group-hover:text-white transition-colors">
                            {message.text}
                          </p>
                          {message.flags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {message.flags.map((flag) => (
                                <Badge
                                  key={flag}
                                  variant="outline"
                                  className="border-rose-500/20 bg-rose-500/5 text-[10px] text-rose-300"
                                >
                                  {flag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                  {hasMoreMessages ? (
                    <div className="pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full border-slate-700 text-slate-300 hover:bg-slate-800"
                        onClick={() => void loadMoreMessages()}
                        disabled={isLoadingMoreMessages}
                      >
                        {isLoadingMoreMessages ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Yukleniyor...
                          </>
                        ) : (
                          'Daha Fazla Yükle'
                        )}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <div className="min-w-0 space-y-3 lg:sticky lg:top-4 lg:self-start">
            <Tabs defaultValue="actions" className="space-y-3">
              <TabsList className="grid h-9 w-full grid-cols-2 bg-slate-900/70">
                <TabsTrigger value="actions" className="text-xs">Moderasyon</TabsTrigger>
                <TabsTrigger value="watchlist" className="text-xs">Takip Listesi</TabsTrigger>
              </TabsList>

              <TabsContent value="actions">
                <Card className="border-slate-800 bg-slate-900/70">
                  <CardHeader className="pb-3">
                    <CardTitle>Hizli Aksiyon</CardTitle>
                    <CardDescription>Secili mesaj icin uygulanacak islem ve nedeni belirle.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    {selectedMessage ? (
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="bg-slate-800 text-slate-200">
                              {getInitials(selectedMessage.playerName)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-semibold text-white">
                              {selectedMessage.playerName}{' '}
                              <span className="text-xs text-slate-400">#{selectedMessage.playerTag}</span>
                            </p>
                            <p className="text-xs text-slate-500">
                              {selectedMessage.channel} - {formatTimeDistance(selectedMessage.timestamp)}
                            </p>
                          </div>
                        </div>
                        <p className="mt-2 text-sm text-slate-300">"{selectedMessage.text}"</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <Badge variant="outline" className={cn('border text-xs', severityConfig[selectedMessage.severity].badgeClass)}>
                            {severityConfig[selectedMessage.severity].label}
                          </Badge>
                          {selectedMessage.flags.map((flag) => (
                            <Badge key={`${selectedMessage.id}-${flag}`} variant="outline" className="border-rose-500/40 text-rose-200">
                              {flag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">Mesaj secmek icin tabloda bir kayda tiklayin.</p>
                    )}

                    <div className="space-y-2">
                      <Label>Gerekce</Label>
                      <Textarea
                        placeholder="Kisa ve net bir aciklama yazin"
                        value={actionForm.reason}
                        onChange={(event) => setActionForm((prev) => ({ ...prev, reason: event.target.value }))}
                        className="min-h-[72px]"
                      />
                    </div>

                    <div className="rounded-2xl border border-slate-800 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-white">Timeout Suresi</p>
                          <p className="text-xs text-slate-500">1 saat / 1 gun / 1 ay hazir secimler</p>
                        </div>
                        <Input
                          type="number"
                          min={5}
                          max={43200}
                          className="h-9 w-24"
                          value={actionForm.duration}
                          onChange={(event) =>
                            setActionForm((prev) => ({ ...prev, duration: Number(event.target.value) || prev.duration }))
                          }
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {timeoutDurationPresets.map((preset) => (
                          <Button
                            key={preset.minutes}
                            type="button"
                            size="sm"
                            variant={actionForm.duration === preset.minutes ? 'default' : 'outline'}
                            className={cn(
                              'h-8 text-xs',
                              actionForm.duration === preset.minutes
                                ? 'bg-slate-100 text-slate-900'
                                : 'border-slate-700 text-slate-300',
                            )}
                            onClick={() => setActionForm((prev) => ({ ...prev, duration: preset.minutes }))}
                          >
                            {preset.label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 rounded-2xl border border-slate-800 px-3 py-2">
                      <Switch
                        id="notify-player"
                        checked={actionForm.notifyPlayer}
                        onCheckedChange={(checked) => setActionForm((prev) => ({ ...prev, notifyPlayer: checked }))}
                      />
                      <div>
                        <Label htmlFor="notify-player" className="text-sm text-white">
                          Oyuncuya bildirim gonder
                        </Label>
                        <p className="text-xs text-slate-500">E-posta ve oyun ici inbox uyarisi tetiklenir.</p>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Button
                        variant="destructive"
                        disabled={!selectedMessage || isApplyingAction}
                        onClick={() => void performModeration('delete')}
                        className="h-9 text-sm"
                      >
                        Mesaji Sil
                      </Button>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="secondary"
                          disabled={!selectedMessage || isApplyingAction}
                          onClick={() => void performModeration('timeout')}
                          className="h-9 text-sm"
                        >
                          Timeout / Mute
                        </Button>
                        <Button
                          className="h-9 bg-rose-600 text-sm hover:bg-rose-500"
                          disabled={!selectedMessage || isApplyingAction}
                          onClick={() => void performModeration('ban')}
                        >
                          Kalici Ban
                        </Button>
                      </div>
                      {actionError ? <p className="text-sm text-rose-400">{actionError}</p> : null}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="watchlist">
                <Card className="border-slate-800 bg-slate-900/70">
                  <CardHeader className="pb-3">
                    <CardTitle>Aktif Yaptirimlar</CardTitle>
                    <CardDescription>Mute ve ban uygulanan oyuncular.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ScrollArea className="h-[220px] pr-2">
                      <div className="space-y-2.5">
                      {activeSanctions.length === 0 ? (
                        <p className="text-sm text-slate-500">Aktif yaptirim bulunmuyor.</p>
                      ) : (
                        activeSanctions.map((record) => (
                          <div key={record.userTag} className="rounded-xl border border-slate-800 p-2.5">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-semibold text-white">
                                  {record.userName}
                                  <span className="ml-2 text-xs text-slate-500">#{record.userTag}</span>
                                </p>
                                <p className="text-xs text-slate-500">{record.reason}</p>
                              </div>
                              <Badge variant="outline" className={record.type === 'ban' ? 'border-rose-400 text-rose-200' : 'border-sky-400 text-sky-200'}>
                                {record.type === 'ban'
                                  ? 'Kalici Ban'
                                  : `Mute - ${Math.max(1, Math.round(((record.expiresAt ?? 0) - Date.now()) / 60000))} dk`}
                              </Badge>
                            </div>
                          </div>
                        ))
                      )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <Card className="border-slate-800 bg-slate-900/70">
              <CardHeader className="pb-3">
                <CardTitle>Canli Oyuncu Listesi</CardTitle>
                <CardDescription>Son sohbet mesajlarina gore anlik katilimcilar.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {playersError ? (
                  <p className="text-sm text-rose-400">{playersError}</p>
                ) : isLoadingPlayers ? (
                  <p className="text-sm text-slate-500">Oyuncular yukleniyor...</p>
                ) : playerSummaries.length === 0 ? (
                  <p className="text-sm text-slate-500">Henuz sohbet verisi yok.</p>
                ) : (
                  <ScrollArea className="h-[220px] pr-2">
                    <div className="space-y-2.5">
                      {playerSummaries.map((player) => (
                        <div key={player.id} className="flex items-center justify-between rounded-xl border border-slate-800 px-3 py-2">
                          <div>
                            <p className="text-sm font-semibold text-white">{player.username}</p>
                            <p className="text-xs text-slate-500">#{player.teamLabel}</p>
                          </div>
                          <div className="text-right text-xs text-slate-400">
                            <p>{formatTimeDistance(player.lastSeen)}</p>
                            <p className="max-w-[150px] truncate italic text-slate-500">{player.lastMessage}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="border-slate-800 bg-slate-900/70">
          <CardHeader className="pb-3">
            <CardTitle>Moderasyon Gunlugu</CardTitle>
            <CardDescription>Son 20 islem otomatik olarak kaydedilir.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ScrollArea className="h-[260px] pr-2">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-800">
                      <TableHead>Kullanici</TableHead>
                      <TableHead>Islem</TableHead>
                      <TableHead>Aciklama</TableHead>
                      <TableHead>Moderasyon</TableHead>
                      <TableHead>Zaman</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {actionLog.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-slate-500">
                          Henuz islem yapilmadi.
                        </TableCell>
                      </TableRow>
                    ) : (
                      actionLog.map((entry) => (
                        <TableRow key={entry.id} className="border-slate-900">
                          <TableCell>
                            <div className="font-medium text-white">
                              {entry.userName}
                              <span className="ml-1 text-xs text-slate-500">#{entry.userTag}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {actionIcons[entry.action]}
                              <span>{actionLabels[entry.action]}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-slate-400">{entry.detail}</TableCell>
                          <TableCell className="text-sm text-slate-400">{entry.moderator}</TableCell>
                          <TableCell className="text-sm text-slate-400">{formatTimeDistance(entry.timestamp)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ChatModerationAdmin;
