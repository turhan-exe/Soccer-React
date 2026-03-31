import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BackButton } from '@/components/ui/back-button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PlayerStatusCard } from '@/components/ui/player-status-card';
import { trainings } from '@/lib/data';
import { getTrainingAttributeLabel } from '@/lib/trainingLabels';
import { calculateSessionDurationMinutes } from '@/lib/trainingDuration';
import {
  getTrainingResultLabel,
  getTrainingResultTone,
  type TrainingResult,
} from '@/lib/trainingResults';
import { cn } from '@/lib/utils';
import { formatRatingLabel, normalizeRatingTo100 } from '@/lib/player';
import { Player, Training } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { useInventory } from '@/contexts/InventoryContext';
import { getTeam } from '@/services/team';
import {
  ActiveTrainingSession,
  TRAINING_FINISH_COST,
  TRAINING_HISTORY_STORAGE_LIMIT,
  TRAINING_HISTORY_VISIBLE_LIMIT,
  TrainingHistoryRecord,
  completeTrainingSession,
  finishTrainingWithDiamonds,
  getActiveTraining,
  getTrainingHistory,
  markTrainingRecordsViewed,
  setActiveTraining,
} from '@/services/training';
import {
  addRewardedAdLifecycleListener,
  getRewardedAdFailureMessage,
  runRewardedAdFlow,
} from '@/services/rewardedAds';
import {
  Clapperboard,
  ClipboardList,
  Clock,
  Diamond,
  Dumbbell,
  History,
  Search,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

const EXTRA_ASSIGNMENT_DIAMOND_COST = 20;
const FINISH_COST_PER_ASSIGNMENT = 18;
const LAST_TRAINING_SELECTION_STORAGE_KEY = 'fm_training_last_selection_v1';

interface ActiveBulkSession {
  players: Player[];
  trainings: Training[];
  durationSeconds: number;
  startedAt: Timestamp;
}

interface PersistedTrainingSelection {
  playerIds: string[];
  trainingIds: string[];
}

type TrainingAccent = {
  badge: string;
  card: string;
  chip: string;
  glow: string;
  progress: string;
};

type DisplayMetricKey = 'overall' | 'health' | 'motivation' | 'condition';

type DisplayMetricOption = {
  key: DisplayMetricKey;
  label: string;
  activeClass: string;
  idleClass: string;
  badgeClass: string;
  barClass: string;
};

const DISPLAY_METRIC_OPTIONS: DisplayMetricOption[] = [
  {
    key: 'overall',
    label: 'Güç',
    activeClass: 'border-cyan-300/45 bg-cyan-500/14 text-cyan-100 shadow-[0_12px_28px_rgba(34,211,238,0.18)]',
    idleClass: 'border-white/10 bg-slate-950/80 text-slate-400 hover:border-cyan-300/25 hover:text-slate-200',
    badgeClass: '',
    barClass: 'bg-gradient-to-r from-cyan-400 to-sky-400',
  },
  {
    key: 'health',
    label: 'Sağlık',
    activeClass: 'border-rose-300/45 bg-rose-500/14 text-rose-100 shadow-[0_12px_28px_rgba(251,113,133,0.18)]',
    idleClass: 'border-white/10 bg-slate-950/80 text-slate-400 hover:border-rose-300/25 hover:text-slate-200',
    badgeClass: 'border border-rose-300/25 bg-rose-400 text-slate-950 shadow-[0_10px_25px_rgba(251,113,133,0.25)]',
    barClass: 'bg-gradient-to-r from-rose-400 to-pink-400',
  },
  {
    key: 'motivation',
    label: 'Motivasyon',
    activeClass: 'border-emerald-300/45 bg-emerald-500/14 text-emerald-100 shadow-[0_12px_28px_rgba(74,222,128,0.18)]',
    idleClass: 'border-white/10 bg-slate-950/80 text-slate-400 hover:border-emerald-300/25 hover:text-slate-200',
    badgeClass: 'border border-emerald-300/25 bg-emerald-400 text-slate-950 shadow-[0_10px_25px_rgba(74,222,128,0.25)]',
    barClass: 'bg-gradient-to-r from-emerald-400 to-lime-400',
  },
  {
    key: 'condition',
    label: 'Enerji',
    activeClass: 'border-amber-300/45 bg-amber-500/14 text-amber-100 shadow-[0_12px_28px_rgba(251,191,36,0.18)]',
    idleClass: 'border-white/10 bg-slate-950/80 text-slate-400 hover:border-amber-300/25 hover:text-slate-200',
    badgeClass: 'border border-amber-300/25 bg-amber-400 text-slate-950 shadow-[0_10px_25px_rgba(251,191,36,0.25)]',
    barClass: 'bg-gradient-to-r from-amber-400 to-orange-400',
  },
];

const TRAINING_DESCRIPTION_OVERRIDES: Record<keyof Player['attributes'], string> = {
  strength: 'Fiziksel gücü artırır',
  acceleration: 'Hızlanmayı geliştirir',
  topSpeed: 'Maksimum hızı artırır',
  dribbleSpeed: 'Top sürme hızını geliştirir',
  jump: 'Sıçrama yeteneğini geliştirir',
  tackling: 'Savunma müdahalelerini geliştirir',
  ballKeeping: 'Top saklama becerisini geliştirir',
  passing: 'Pas doğruluğunu artırır',
  longBall: 'Uzun top becerisini geliştirir',
  agility: 'Çevikliği artırır',
  shooting: 'Şut isabetini geliştirir',
  shootPower: 'Şut gücünü artırır',
  positioning: 'Pozisyon alma becerisini geliştirir',
  reaction: 'Refleksleri geliştirir',
  ballControl: 'Top kontrolünü geliştirir',
};

const sortTrainingHistoryByLatest = (
  records: TrainingHistoryRecord[],
): TrainingHistoryRecord[] =>
  [...records].sort((left, right) => {
    const leftMs = left.completedAt?.toMillis?.() ?? 0;
    const rightMs = right.completedAt?.toMillis?.() ?? 0;
    return rightMs - leftMs;
  });

const normalizeTrainingHistory = (
  records: TrainingHistoryRecord[],
): TrainingHistoryRecord[] =>
  sortTrainingHistoryByLatest(records).slice(0, TRAINING_HISTORY_STORAGE_LIMIT);

const normalizeSelectionIds = (ids: string[]): string[] =>
  Array.from(new Set(ids.filter(Boolean)));

const getTrainingSelectionStorageKey = (uid: string): string =>
  `${LAST_TRAINING_SELECTION_STORAGE_KEY}:${uid}`;

const buildPersistedTrainingSelection = (
  players: Player[],
  selectedTrainings: Training[],
): PersistedTrainingSelection => ({
  playerIds: normalizeSelectionIds(players.map(player => player.id)),
  trainingIds: normalizeSelectionIds(selectedTrainings.map(training => training.id)),
});

const readPersistedTrainingSelection = (
  uid: string,
): PersistedTrainingSelection | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getTrainingSelectionStorageKey(uid));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedTrainingSelection> | null;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return {
      playerIds: normalizeSelectionIds(
        Array.isArray(parsed.playerIds)
          ? parsed.playerIds.filter((value): value is string => typeof value === 'string')
          : [],
      ),
      trainingIds: normalizeSelectionIds(
        Array.isArray(parsed.trainingIds)
          ? parsed.trainingIds.filter((value): value is string => typeof value === 'string')
          : [],
      ),
    };
  } catch (error) {
    console.warn('[TrainingPage] persisted selection could not be read', error);
    return null;
  }
};

const persistTrainingSelection = (
  uid: string,
  selection: PersistedTrainingSelection,
): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      getTrainingSelectionStorageKey(uid),
      JSON.stringify(selection),
    );
  } catch (error) {
    console.warn('[TrainingPage] persisted selection could not be written', error);
  }
};

const resolvePersistedTrainingSelection = (
  selection: PersistedTrainingSelection,
  players: Player[],
  availableTrainings: Training[],
): { players: Player[]; trainings: Training[] } => ({
  players: selection.playerIds
    .map(id => players.find(player => player.id === id))
    .filter((player): player is Player => Boolean(player)),
  trainings: selection.trainingIds
    .map(id => availableTrainings.find(training => training.id === id))
    .filter((training): training is Training => Boolean(training)),
});

const toFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const getTrainingHistoryCardClass = (result: TrainingResult): string => {
  switch (getTrainingResultTone(result)) {
    case 'low':
      return 'border-amber-400/20 bg-amber-500/10';
    case 'medium':
      return 'border-sky-400/20 bg-sky-500/10';
    case 'high':
      return 'border-emerald-400/20 bg-emerald-500/10';
    case 'full':
      return 'border-cyan-400/20 bg-cyan-500/10';
    case 'fail':
    default:
      return 'border-red-400/20 bg-red-500/10';
  }
};

const getTrainingHistoryBadgeClass = (result: TrainingResult): string => {
  switch (getTrainingResultTone(result)) {
    case 'low':
      return 'bg-amber-500/15 text-amber-300';
    case 'medium':
      return 'bg-sky-500/15 text-sky-300';
    case 'high':
      return 'bg-emerald-500/15 text-emerald-300';
    case 'full':
      return 'bg-cyan-500/15 text-cyan-300';
    case 'fail':
    default:
      return 'bg-red-500/15 text-red-300';
  }
};

const getTrainingAccent = (attribute: keyof Player['attributes']): TrainingAccent => {
  if (attribute === 'strength' || attribute === 'ballKeeping') {
    return {
      badge: 'border-emerald-400/40 bg-emerald-500/12 text-emerald-100',
      card: 'border-emerald-400/18 bg-emerald-500/6',
      chip: 'border-emerald-400/25 bg-emerald-500/12 text-emerald-100',
      glow: 'border-emerald-400/45 shadow-[0_0_0_1px_rgba(74,222,128,0.18),0_18px_40px_rgba(16,185,129,0.18)]',
      progress: 'from-emerald-400 via-cyan-400 to-sky-500',
    };
  }

  if (attribute === 'tackling') {
    return {
      badge: 'border-rose-400/40 bg-rose-500/12 text-rose-100',
      card: 'border-rose-400/18 bg-rose-500/6',
      chip: 'border-rose-400/25 bg-rose-500/12 text-rose-100',
      glow: 'border-rose-400/45 shadow-[0_0_0_1px_rgba(251,113,133,0.18),0_18px_40px_rgba(225,29,72,0.18)]',
      progress: 'from-rose-400 via-orange-400 to-amber-300',
    };
  }

  if (attribute === 'topSpeed' || attribute === 'shooting' || attribute === 'shootPower') {
    return {
      badge: 'border-amber-400/40 bg-amber-500/12 text-amber-100',
      card: 'border-amber-400/18 bg-amber-500/6',
      chip: 'border-amber-400/25 bg-amber-500/12 text-amber-100',
      glow: 'border-amber-400/45 shadow-[0_0_0_1px_rgba(251,191,36,0.18),0_18px_40px_rgba(245,158,11,0.18)]',
      progress: 'from-amber-400 via-orange-400 to-yellow-300',
    };
  }

  if (attribute === 'acceleration' || attribute === 'longBall' || attribute === 'reaction') {
    return {
      badge: 'border-violet-400/40 bg-violet-500/12 text-violet-100',
      card: 'border-violet-400/18 bg-violet-500/6',
      chip: 'border-violet-400/25 bg-violet-500/12 text-violet-100',
      glow: 'border-violet-400/45 shadow-[0_0_0_1px_rgba(167,139,250,0.18),0_18px_40px_rgba(124,58,237,0.18)]',
      progress: 'from-violet-400 via-fuchsia-400 to-sky-400',
    };
  }

  return {
    badge: 'border-cyan-400/35 bg-cyan-500/12 text-cyan-100',
    card: 'border-cyan-400/18 bg-cyan-500/6',
    chip: 'border-cyan-400/20 bg-cyan-500/12 text-cyan-100',
    glow: 'border-cyan-400/45 shadow-[0_0_0_1px_rgba(34,211,238,0.16),0_18px_40px_rgba(34,211,238,0.18)]',
    progress: 'from-cyan-400 via-sky-400 to-emerald-400',
  };
};

const getTrainingMonogram = (attribute: keyof Player['attributes']): string =>
  getTrainingAttributeLabel(attribute)
    .split(' ')
    .map(part => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

const getPlayerInitials = (name: string): string =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0] ?? '')
    .join('')
    .toUpperCase();

const getOverallBadgeClass = (overall: number): string => {
  if (overall >= 90) {
    return 'border border-emerald-300/30 bg-emerald-400 text-slate-950 shadow-[0_10px_25px_rgba(74,222,128,0.3)]';
  }

  if (overall >= 75) {
    return 'border border-cyan-300/30 bg-cyan-400 text-slate-950 shadow-[0_10px_25px_rgba(34,211,238,0.28)]';
  }

  return 'border border-amber-300/30 bg-amber-400 text-slate-950 shadow-[0_10px_25px_rgba(251,191,36,0.24)]';
};

const getMotivationBarClass = (motivation: number): string => {
  const percent = Math.round(motivation * 100);
  if (percent >= 90) {
    return 'bg-gradient-to-r from-emerald-400 to-lime-400';
  }

  if (percent >= 70) {
    return 'bg-gradient-to-r from-cyan-400 to-emerald-400';
  }

  return 'bg-gradient-to-r from-amber-400 to-orange-400';
};

const clampMetricValue = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value)));

const getDisplayMetricValue = (
  player: Player,
  metric: DisplayMetricKey,
): number => {
  switch (metric) {
    case 'health':
      return clampMetricValue((player.health ?? 0) * 100);
    case 'motivation':
      return clampMetricValue((player.motivation ?? 0) * 100);
    case 'condition':
      return clampMetricValue((player.condition ?? 0) * 100);
    case 'overall':
    default:
      return normalizeRatingTo100(player.overall ?? 0);
  }
};

const getDisplayMetricOption = (
  metric: DisplayMetricKey,
): DisplayMetricOption =>
  DISPLAY_METRIC_OPTIONS.find(option => option.key === metric) ??
  DISPLAY_METRIC_OPTIONS[0];

export default function TrainingPage() {
  const { user } = useAuth();
  const { balance, spend } = useDiamonds();
  const { vipDurationMultiplier } = useInventory();

  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<Player[]>([]);
  const [selectedTrainings, setSelectedTrainings] = useState<Training[]>([]);
  const [draggingType, setDraggingType] = useState<'player' | 'training' | null>(null);
  const [displayMetric, setDisplayMetric] = useState<DisplayMetricKey>('motivation');
  const [playerSearch, setPlayerSearch] = useState('');
  const [trainingSearch, setTrainingSearch] = useState('');
  const [isTraining, setIsTraining] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [activeSession, setActiveSessionState] = useState<ActiveBulkSession | null>(null);
  const [pendingActiveSession, setPendingActiveSession] = useState<ActiveTrainingSession | null>(null);
  const [history, setHistory] = useState<TrainingHistoryRecord[]>([]);
  const [isFinishingWithDiamonds, setIsFinishingWithDiamonds] = useState(false);
  const [isWatchingAd, setIsWatchingAd] = useState(false);
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);
  const [playerDetail, setPlayerDetail] = useState<Player | null>(null);
  const [squadAssignments, setSquadAssignments] = useState({
    starters: [] as string[],
    bench: [] as string[],
    reserves: [] as string[],
  });

  const intervalRef = useRef<number | null>(null);
  const completionTriggeredRef = useRef(false);
  const completeSessionRef = useRef<(() => Promise<void>) | null>(null);
  const activeSessionRef = useRef<ActiveBulkSession | null>(null);
  const timeLeftRef = useRef(0);
  const hasRestoredLastSelectionRef = useRef(false);

  const trainingCatalog = useMemo(
    () =>
      trainings.map(training => ({
        ...training,
        name: `${getTrainingAttributeLabel(training.type)} Antrenmanı`,
        description: TRAINING_DESCRIPTION_OVERRIDES[training.type] ?? training.description,
      })),
    [],
  );

  const restoreLastTrainingSelection = useCallback(
    (availablePlayers: Player[], selection?: PersistedTrainingSelection | null) => {
      if (!user) {
        return;
      }

      const nextSelection = selection ?? readPersistedTrainingSelection(user.id);
      if (!nextSelection) {
        return;
      }

      const resolved = resolvePersistedTrainingSelection(
        nextSelection,
        availablePlayers,
        trainingCatalog,
      );
      setSelectedPlayers(resolved.players);
      setSelectedTrainings(resolved.trainings);
    },
    [trainingCatalog, user],
  );

  const triggerCompletion = useCallback(() => {
    if (completionTriggeredRef.current) {
      return;
    }

    completionTriggeredRef.current = true;
    setTimeout(() => {
      const handler = completeSessionRef.current;
      if (handler) {
        void handler();
      }
    }, 0);
  }, []);

  const startCountdown = useCallback(
    (initialSeconds: number) => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      completionTriggeredRef.current = false;

      if (initialSeconds <= 0) {
        setTimeLeft(0);
        triggerCompletion();
        return;
      }

      setTimeLeft(initialSeconds);
      intervalRef.current = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            triggerCompletion();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    },
    [triggerCompletion],
  );

  const setActiveSessionSafe = useCallback((session: ActiveBulkSession | null) => {
    activeSessionRef.current = session;
    setActiveSessionState(session);
  }, []);

  useEffect(() => {
    hasRestoredLastSelectionRef.current = false;
  }, [user?.id]);

  useEffect(() => {
    const fetchPlayers = async () => {
      if (!user) {
        return;
      }

      const team = await getTeam(user.id);
      setPlayers(team?.players ?? []);

      if (!team) {
        return;
      }

      const plan = (team.plan ?? team.lineup) as {
        starters?: string[];
        bench?: string[];
        subs?: string[];
        reserves?: string[];
      } | undefined;

      setSquadAssignments({
        starters:
          (plan?.starters && plan.starters.filter(Boolean)) ||
          team.players.filter(player => player.squadRole === 'starting').map(player => player.id),
        bench:
          (plan?.bench && plan.bench.filter(Boolean)) ||
          (plan?.subs && plan.subs.filter(Boolean)) ||
          team.players.filter(player => player.squadRole === 'bench').map(player => player.id),
        reserves:
          (plan?.reserves && plan.reserves.filter(Boolean)) ||
          team.players.filter(player => player.squadRole === 'reserve').map(player => player.id),
      });
    };

    void fetchPlayers();
  }, [user]);

  useEffect(() => {
    if (!user || isTraining || pendingActiveSession || hasRestoredLastSelectionRef.current) {
      return;
    }

    if (players.length === 0) {
      return;
    }

    restoreLastTrainingSelection(players);
    hasRestoredLastSelectionRef.current = true;
  }, [isTraining, pendingActiveSession, players, restoreLastTrainingSelection, user]);

  useEffect(() => {
    const loadHistory = async () => {
      if (!user) {
        return;
      }

      try {
        const records = await getTrainingHistory(user.id);
        let finalRecords = records;
        const unseenIds = records
          .filter(record => !record.viewed && Boolean(record.id))
          .map(record => record.id!)
          .filter(Boolean);

        if (unseenIds.length > 0) {
          try {
            await markTrainingRecordsViewed(user.id, unseenIds);
            const unseenSet = new Set(unseenIds);
            finalRecords = records.map(record =>
              unseenSet.has(record.id ?? '') ? { ...record, viewed: true } : record,
            );
          } catch (error) {
            console.warn('Antrenman kayıtları görüldü olarak işaretlenemedi', error);
          }
        }

        setHistory(normalizeTrainingHistory(finalRecords));
      } catch (error) {
        console.warn('Antrenman geçmişi yüklenemedi', error);
      }
    };

    void loadHistory();
  }, [user]);

  useEffect(() => {
    if (expandedPlayerId && !players.some(player => player.id === expandedPlayerId)) {
      setExpandedPlayerId(null);
      setPlayerDetail(null);
    }
  }, [expandedPlayerId, players]);

  useEffect(() => {
    if (isTraining) {
      setExpandedPlayerId(null);
      setPlayerDetail(null);
    }
  }, [isTraining]);

  useEffect(() => {
    if (!playerDetail) {
      setExpandedPlayerId(null);
    }
  }, [playerDetail]);

  useEffect(() => {
    const loadActive = async () => {
      if (!user) {
        return;
      }

      try {
        const session = await getActiveTraining(user.id);
        if (session) {
          setPendingActiveSession(session);
        }
      } catch (error) {
        console.warn('Aktif antrenman yüklenemedi', error);
      }
    };

    void loadActive();
  }, [user]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    timeLeftRef.current = timeLeft;
  }, [timeLeft]);

  const completeSession = useCallback(async () => {
    completionTriggeredRef.current = true;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const session = activeSessionRef.current;
    if (!user || !session) {
      setIsTraining(false);
      setTimeLeft(0);
      setActiveSessionSafe(null);
      setPendingActiveSession(null);
      return;
    }

    try {
      const persistedSession = await getActiveTraining(user.id);
      if (!persistedSession) {
        const [team, records] = await Promise.all([
          getTeam(user.id),
          getTrainingHistory(user.id),
        ]);
        const nextPlayers = team?.players ?? [];
        setPlayers(nextPlayers);
        setHistory(normalizeTrainingHistory(records));
        setIsTraining(false);
        setTimeLeft(0);
        setActiveSessionSafe(null);
        setPendingActiveSession(null);
        restoreLastTrainingSelection(nextPlayers);
        toast.success('Antrenman tamamlandı');
        return;
      }
    } catch (error) {
      console.warn('Sunucu antrenman durumu kontrol edilemedi', error);
    }

    try {
      const result = await completeTrainingSession(user.id, { viewed: true });
      setPlayers(result.players);
      setHistory(prev => normalizeTrainingHistory([...result.records, ...prev]));
      setIsTraining(false);
      setTimeLeft(0);
      setActiveSessionSafe(null);
      setPendingActiveSession(null);
      restoreLastTrainingSelection(result.players);
      toast.success(`Antrenman tamamlandı (${result.records.length} işlem)`);
    } catch (error) {
      console.warn('Antrenman tamamlanamadı', error);
      const [team, records] = await Promise.all([
        getTeam(user.id),
        getTrainingHistory(user.id),
      ]);
      const nextPlayers = team?.players ?? [];
      setPlayers(nextPlayers);
      setHistory(normalizeTrainingHistory(records));
      setIsTraining(false);
      setTimeLeft(0);
      setActiveSessionSafe(null);
      setPendingActiveSession(null);
      restoreLastTrainingSelection(nextPlayers);
      toast.error('Antrenman sonucu kaydedilemedi');
    }
  }, [restoreLastTrainingSelection, setActiveSessionSafe, user]);

  useEffect(() => {
    completeSessionRef.current = completeSession;
  }, [completeSession]);

  useEffect(() => {
    if (!pendingActiveSession) {
      return;
    }

    const sessionPlayers = pendingActiveSession.playerIds
      .map(id => players.find(player => player.id === id))
      .filter((player): player is Player => Boolean(player));

    const sessionTrainings = pendingActiveSession.trainingIds
      .map(id => trainingCatalog.find(training => training.id === id))
      .filter((training): training is Training => Boolean(training));

    if (sessionPlayers.length === 0 || sessionTrainings.length === 0) {
      return;
    }

    const { durationSeconds, startAt } = pendingActiveSession;
    const elapsedSeconds = Math.floor((Date.now() - startAt.toDate().getTime()) / 1000);
    const remaining = Math.max(durationSeconds - elapsedSeconds, 0);

    setSelectedPlayers(sessionPlayers);
    setSelectedTrainings(sessionTrainings);
    if (user) {
      persistTrainingSelection(
        user.id,
        buildPersistedTrainingSelection(sessionPlayers, sessionTrainings),
      );
    }
    setActiveSessionSafe({
      players: sessionPlayers,
      trainings: sessionTrainings,
      durationSeconds,
      startedAt: startAt,
    });
    setIsTraining(true);
    startCountdown(remaining);
    setPendingActiveSession(null);
  }, [pendingActiveSession, players, setActiveSessionSafe, startCountdown, trainingCatalog, user]);

  const filteredPlayers = useMemo(() => {
    const query = playerSearch.toLowerCase();
    return players
      .filter(player =>
        player.name.toLowerCase().includes(query) ||
        player.position.toLowerCase().includes(query),
      )
      .sort((left, right) => {
        const leftLastTrainedAt = left.lastTrainedAt ? Date.parse(left.lastTrainedAt) : 0;
        const rightLastTrainedAt = right.lastTrainedAt ? Date.parse(right.lastTrainedAt) : 0;

        if (leftLastTrainedAt !== rightLastTrainedAt) {
          return rightLastTrainedAt - leftLastTrainedAt;
        }

        return right.overall - left.overall;
      });
  }, [playerSearch, players]);

  const filteredTrainings = useMemo(() => {
    const query = trainingSearch.toLowerCase();
    return trainingCatalog.filter(training =>
      training.name.toLowerCase().includes(query) ||
      training.type.toLowerCase().includes(query) ||
      getTrainingAttributeLabel(training.type).toLowerCase().includes(query),
    );
  }, [trainingCatalog, trainingSearch]);

  const sessionDurationMinutes = useMemo(
    () =>
      calculateSessionDurationMinutes({
        playersCount: selectedPlayers.length,
        trainings: selectedTrainings,
        vipDurationMultiplier,
      }),
    [selectedPlayers.length, selectedTrainings, vipDurationMultiplier],
  );

  const diamondCost = useMemo(() => {
    const totalCombos = selectedPlayers.length * selectedTrainings.length;
    return totalCombos <= 1 ? 0 : (totalCombos - 1) * EXTRA_ASSIGNMENT_DIAMOND_COST;
  }, [selectedPlayers.length, selectedTrainings.length]);

  const totalAssignments = useMemo(
    () => selectedPlayers.length * selectedTrainings.length,
    [selectedPlayers.length, selectedTrainings.length],
  );

  const finishDiamondCost = useMemo(() => {
    const sessionPlayersCount = activeSession?.players.length ?? selectedPlayers.length;
    const sessionTrainingsCount = activeSession?.trainings.length ?? selectedTrainings.length;
    const totalCombos = sessionPlayersCount * sessionTrainingsCount;
    return totalCombos === 0
      ? TRAINING_FINISH_COST
      : TRAINING_FINISH_COST + Math.max(0, totalCombos - 1) * FINISH_COST_PER_ASSIGNMENT;
  }, [activeSession, selectedPlayers.length, selectedTrainings.length]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const handleDragStart = (
    event: React.DragEvent<HTMLDivElement>,
    type: 'player' | 'training',
    id: string,
  ) => {
    if (isTraining) {
      return;
    }

    setDraggingType(type);
    const payload = JSON.stringify({ type, id });
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/json', payload);
    event.dataTransfer.setData('text/plain', payload);
  };

  const handleDragEnd = () => {
    setDraggingType(null);
  };

  const handleDragOver = (
    event: React.DragEvent<HTMLDivElement>,
    type: 'player' | 'training',
  ) => {
    if (!isTraining && draggingType === type) {
      event.preventDefault();
    }
  };

  const handleDrop = (
    event: React.DragEvent<HTMLDivElement>,
    type: 'player' | 'training',
  ) => {
    if (isTraining) {
      return;
    }

    event.preventDefault();
    setDraggingType(null);

    const raw =
      event.dataTransfer.getData('application/json') ||
      event.dataTransfer.getData('text/plain');

    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as { type: 'player' | 'training'; id: string };
      if (parsed.type !== type) {
        return;
      }

      if (type === 'player') {
        const player = players.find(item => item.id === parsed.id);
        if (player) {
          setSelectedPlayers(prev =>
            prev.some(item => item.id === player.id) ? prev : [...prev, player],
          );
        }
        return;
      }

      const training = trainingCatalog.find(item => item.id === parsed.id);
      if (training) {
        setSelectedTrainings(prev =>
          prev.some(item => item.id === training.id) ? prev : [...prev, training],
        );
      }
    } catch (error) {
      console.warn('Drag & drop verisi ayrıştırılamadı', error);
    }
  };

  const removeSelectedPlayer = (id: string) => {
    if (!isTraining) {
      setSelectedPlayers(prev => prev.filter(player => player.id !== id));
    }
  };

  const removeSelectedTraining = (id: string) => {
    if (!isTraining) {
      setSelectedTrainings(prev => prev.filter(training => training.id !== id));
    }
  };

  const handleStartTraining = async () => {
    if (!user) {
      toast.error('Lütfen giriş yapın');
      return;
    }

    if (selectedPlayers.length === 0 || selectedTrainings.length === 0) {
      toast.error('En az bir oyuncu ve antrenman seçin');
      return;
    }

    if (isTraining) {
      toast.info('Devam eden bir antrenman var');
      return;
    }

    if (diamondCost > 0) {
      if (balance < diamondCost) {
        toast.error('Yetersiz elmas bakiyesi');
        return;
      }

      try {
        await spend(diamondCost);
      } catch (error) {
        toast.error('Elmas işlemi tamamlanamadı');
        return;
      }
    }

    const durationSeconds = sessionDurationMinutes * 60;
    if (durationSeconds <= 0) {
      toast.error('Geçerli bir süre hesaplanamadı');
      return;
    }

    const sessionPlayers = [...selectedPlayers];
    const sessionTrainings = [...selectedTrainings];
    const startedAt = Timestamp.now();

    try {
      await setActiveTraining(user.id, {
        playerIds: sessionPlayers.map(player => player.id),
        trainingIds: sessionTrainings.map(training => training.id),
        startAt: startedAt,
        durationSeconds,
      });
    } catch (error) {
      console.warn('Aktif antrenman kaydedilemedi', error);
      toast.error('Antrenman başlatılamadı');
      return;
    }

    persistTrainingSelection(
      user.id,
      buildPersistedTrainingSelection(sessionPlayers, sessionTrainings),
    );
    setActiveSessionSafe({
      players: sessionPlayers,
      trainings: sessionTrainings,
      durationSeconds,
      startedAt,
    });
    setIsTraining(true);
    startCountdown(durationSeconds);
    toast.success('Antrenman başlatıldı');
  };

  const handleFinishWithDiamonds = async () => {
    if (!user || !activeSession || isFinishingWithDiamonds) {
      return;
    }

    if (timeLeft <= 0) {
      toast.info('Antrenman zaten tamamlanmış');
      return;
    }

    if (balance < finishDiamondCost) {
      toast.error('Yetersiz elmas bakiyesi');
      return;
    }

    const remainingBeforeFinish = timeLeft;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setIsFinishingWithDiamonds(true);
    try {
      const session = await finishTrainingWithDiamonds(user.id, finishDiamondCost);
      const result = await completeTrainingSession(user.id, {
        session,
        viewed: true,
        consumeActive: false,
      });
      setPlayers(result.players);
      setHistory(prev => normalizeTrainingHistory([...result.records, ...prev]));
      setIsTraining(false);
      setTimeLeft(0);
      setActiveSessionSafe(null);
      setPendingActiveSession(null);
      restoreLastTrainingSelection(result.players);
      toast.success(`Antrenman tamamlandı (${result.records.length} işlem)`);
    } catch (error) {
      console.warn('Antrenman elmasla tamamlanamadı', error);
      toast.error('Elmasla bitirme başarısız');
      if (remainingBeforeFinish > 0) {
        startCountdown(remainingBeforeFinish);
      }
    } finally {
      setIsFinishingWithDiamonds(false);
    }
  };

  const handleWatchAd = async () => {
    if (!user || !activeSession || isWatchingAd) {
      return;
    }

    if (timeLeft <= 0) {
      toast.info('Antrenman zaten tamamlanmış');
      return;
    }

    let adWasShown = false;
    let pausedRemaining = timeLeftRef.current;
    const resumeCountdownIfNeeded = () => {
      if (!adWasShown) {
        return;
      }

      if (pausedRemaining > 0) {
        startCountdown(pausedRemaining);
        return;
      }

      if (isTraining) {
        triggerCompletion();
      }
    };

    setIsWatchingAd(true);
    const lifecycleHandle = await addRewardedAdLifecycleListener(event => {
      if (event.status !== 'showing' || adWasShown) {
        return;
      }

      adWasShown = true;
      pausedRemaining = Math.max(timeLeftRef.current, 0);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    });

    try {
      const result = await runRewardedAdFlow({
        userId: user.id,
        placement: 'training_finish',
        context: {
          surface: 'training',
          playerIds: activeSession.players.map(player => player.id),
          trainingIds: activeSession.trainings.map(training => training.id),
        },
      });

      setActiveSessionState(prev => {
        activeSessionRef.current = prev;
        return prev;
      });

      if (result.outcome === 'claimed' || result.outcome === 'already_claimed') {
        const reducedDurationSeconds = toFiniteNumber(result.claim.reward.durationSeconds);
        if (activeSessionRef.current && reducedDurationSeconds !== null) {
          setActiveSessionSafe({
            ...activeSessionRef.current,
            durationSeconds: reducedDurationSeconds,
          });
        }
        setTimeLeft(0);
        await completeSession();
        return;
      }

      if (result.outcome === 'dismissed') {
        toast.info('Reklam tamamlanmadı, antrenman devam ediyor.');
        resumeCountdownIfNeeded();
        return;
      }

      if (result.outcome === 'pending_verification') {
        toast.info('Reklam doğrulanıyor. Biraz sonra yeniden deneyin.');
        resumeCountdownIfNeeded();
        return;
      }

      toast.error(getRewardedAdFailureMessage(result.ad));
      resumeCountdownIfNeeded();
    } catch (error) {
      console.warn('Antrenman reklamla bitirilemedi', error);
      toast.error(getRewardedAdFailureMessage(error));
      resumeCountdownIfNeeded();
    } finally {
      await lifecycleHandle?.remove();
      setIsWatchingAd(false);
    }
  };

  useEffect(() => {
    if (isTraining && timeLeft <= 0) {
      triggerCompletion();
    }
  }, [isTraining, timeLeft, triggerCompletion]);

  const visibleHistory = useMemo(
    () => history.slice(0, TRAINING_HISTORY_VISIBLE_LIMIT),
    [history],
  );

  const canStart = selectedPlayers.length > 0 && selectedTrainings.length > 0 && !isTraining;

  const squadRoleSelections = useMemo(() => {
    if (players.length === 0) {
      return {
        starters: [] as Player[],
        bench: [] as Player[],
        reserves: [] as Player[],
      };
    }

    const playerMap = new Map(players.map(player => [player.id, player]));
    const resolveIds = (ids: string[]) =>
      ids
        .map(id => playerMap.get(id))
        .filter((player): player is Player => Boolean(player));

    return {
      starters:
        squadAssignments.starters.length > 0
          ? resolveIds(squadAssignments.starters)
          : players.filter(player => player.squadRole === 'starting'),
      bench:
        squadAssignments.bench.length > 0
          ? resolveIds(squadAssignments.bench)
          : players.filter(player => player.squadRole === 'bench'),
      reserves:
        squadAssignments.reserves.length > 0
          ? resolveIds(squadAssignments.reserves)
          : players.filter(player => player.squadRole === 'reserve'),
    };
  }, [players, squadAssignments]);

  const handleSquadSelection = useCallback(
    (group: 'starters' | 'bench' | 'reserves') => {
      if (isTraining) {
        return;
      }

      const groupPlayers = squadRoleSelections[group];
      if (groupPlayers.length === 0) {
        toast.info('Bu grupta oyuncu bulunmuyor');
        return;
      }

      setSelectedPlayers(groupPlayers);
      setExpandedPlayerId(null);
      setPlayerDetail(null);
    },
    [isTraining, squadRoleSelections],
  );

  const selectedPlayerIds = useMemo(
    () => new Set(selectedPlayers.map(player => player.id)),
    [selectedPlayers],
  );
  const selectedTrainingIds = useMemo(
    () => new Set(selectedTrainings.map(training => training.id)),
    [selectedTrainings],
  );
  const activeDisplayMetric = useMemo(
    () => getDisplayMetricOption(displayMetric),
    [displayMetric],
  );
  const leadTraining = activeSession?.trainings[0] ?? selectedTrainings[0] ?? null;
  const leadAccent = leadTraining
    ? getTrainingAccent(leadTraining.type)
    : getTrainingAccent('passing');
  const activeDurationSeconds = activeSession?.durationSeconds ?? sessionDurationMinutes * 60;
  const progressPercent =
    isTraining && activeDurationSeconds > 0
      ? Math.max(
          0,
          Math.min(100, ((activeDurationSeconds - Math.max(timeLeft, 0)) / activeDurationSeconds) * 100),
        )
      : canStart
        ? 18
        : 6;

  const panelClass =
    'overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,15,31,0.96),rgba(3,7,18,0.94))] text-slate-100 shadow-[0_22px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl';
  const sectionTitleClass =
    'flex items-center gap-3 text-[15px] font-semibold uppercase tracking-[0.18em] text-slate-100';
  const searchInputClass =
    'h-12 rounded-2xl border border-white/10 bg-[#060d1f]/90 pl-10 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-cyan-400/35 focus-visible:ring-offset-0';

  const renderPlayerCard = (player: Player) => {
    const isExpanded = expandedPlayerId === player.id;
    const isSelected = selectedPlayerIds.has(player.id);
    const metricValue = getDisplayMetricValue(player, displayMetric);
    const metricLabel = activeDisplayMetric.label;
    const metricBadgeClass =
      displayMetric === 'overall'
        ? getOverallBadgeClass(player.overall)
        : activeDisplayMetric.badgeClass;

    return (
      <Card
        key={player.id}
        draggable={!isTraining}
        onDragStart={event => {
          setExpandedPlayerId(null);
          setPlayerDetail(null);
          handleDragStart(event, 'player', player.id);
        }}
        onDragEnd={handleDragEnd}
        onClick={() => {
          if (isTraining) return;
          setExpandedPlayerId(prev => {
            const next = prev === player.id ? null : player.id;
            setPlayerDetail(next ? player : null);
            return next;
          });
        }}
        onDoubleClick={() => {
          if (!isTraining) {
            setSelectedPlayers(prev =>
              prev.some(item => item.id === player.id) ? prev : [...prev, player],
            );
          }
          setExpandedPlayerId(null);
          setPlayerDetail(null);
        }}
        className={cn(
          'overflow-hidden rounded-[24px] border bg-[linear-gradient(135deg,rgba(8,15,33,0.96),rgba(5,12,24,0.96))] transition duration-200',
          isTraining ? 'pointer-events-none opacity-50' : 'cursor-pointer hover:border-cyan-300/30 hover:shadow-[0_18px_40px_rgba(8,145,178,0.16)]',
          isExpanded && 'border-cyan-300/45 shadow-[0_0_0_1px_rgba(34,211,238,0.16),0_18px_40px_rgba(8,145,178,0.18)]',
          isSelected && 'border-emerald-400/35 shadow-[0_18px_40px_rgba(16,185,129,0.16)]',
        )}
      >
        <CardContent className="p-4">
          <div className="flex gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_55%),rgba(255,255,255,0.04)] text-lg font-black uppercase tracking-[0.2em] text-slate-100">
              {getPlayerInitials(player.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-white">{player.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 font-semibold text-cyan-100">
                      {player.position}
                    </span>
                    <span>Genel {formatRatingLabel(player.overall)}</span>
                  </div>
                </div>
                <div className={cn('flex min-w-[58px] items-center justify-center rounded-[18px] px-3 py-2 text-lg font-black leading-none', metricBadgeClass)}>
                  {displayMetric === 'overall' ? formatRatingLabel(player.overall) : metricValue}
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-slate-500">
                <span>{metricLabel}</span>
                <span className="text-slate-300">{metricValue}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-950/90">
                <div className={cn('h-full rounded-full', activeDisplayMetric.barClass)} style={{ width: `${metricValue}%` }} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderTrainingCard = (training: Training) => {
    const accent = getTrainingAccent(training.type);
    const isSelected = selectedTrainingIds.has(training.id);
    return (
      <Card
        key={training.id}
        draggable={!isTraining}
        onDragStart={event => handleDragStart(event, 'training', training.id)}
        onDragEnd={handleDragEnd}
        onDoubleClick={() => {
          if (!isTraining) {
            setSelectedTrainings(prev =>
              prev.some(item => item.id === training.id) ? prev : [...prev, training],
            );
          }
        }}
        className={cn(
          'overflow-hidden rounded-[24px] border bg-[linear-gradient(135deg,rgba(8,15,33,0.96),rgba(5,12,24,0.96))] transition duration-200',
          accent.card,
          isTraining ? 'pointer-events-none opacity-50' : 'cursor-pointer hover:brightness-110',
          isSelected && accent.glow,
        )}
      >
        <CardContent className="p-4">
          <div className="flex gap-4">
            <div className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] border text-sm font-black uppercase tracking-[0.18em]', accent.badge)}>
              {getTrainingMonogram(training.type)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-white">{training.name}</p>
                  <p className="mt-1 text-sm text-slate-400">{training.description}</p>
                </div>
                <div className="min-w-[92px] text-right">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Odak</p>
                  <span className={cn('mt-1 inline-flex max-w-full rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]', accent.chip)}>
                    {getTrainingAttributeLabel(training.type)}
                  </span>
                  <p className="mt-2 text-sm font-semibold text-slate-300">{training.duration} dk</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderPlayersPanel = (panelHeightClass?: string) => (
    <Card className={cn(panelClass, 'flex min-h-0 flex-col', panelHeightClass)}>
      <CardHeader className="space-y-4 p-5 pb-4">
        <CardTitle className={sectionTitleClass}>
          <Users className="h-5 w-5 text-cyan-300" />
          Oyuncular
        </CardTitle>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={playerSearch} onChange={event => setPlayerSearch(event.target.value)} placeholder="Oyuncu ara..." className={searchInputClass} />
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 p-4 pt-0">
        <ScrollArea className="h-full pr-2">
          <div className="space-y-3">
            {filteredPlayers.length === 0 ? (
              <div className="flex min-h-[200px] items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-slate-950/60 px-4 text-center text-sm text-slate-400">
                Eşleşen oyuncu bulunamadı.
              </div>
            ) : filteredPlayers.map(renderPlayerCard)}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );

  const renderTrainingsPanel = (panelHeightClass?: string) => (
    <Card className={cn(panelClass, 'flex min-h-0 flex-col', panelHeightClass)}>
      <CardHeader className="space-y-4 p-5 pb-4">
        <CardTitle className={sectionTitleClass}>
          <Dumbbell className="h-5 w-5 text-emerald-300" />
          Antrenmanlar
        </CardTitle>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={trainingSearch} onChange={event => setTrainingSearch(event.target.value)} placeholder="Antrenman ara..." className={searchInputClass} />
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 p-4 pt-0">
        <ScrollArea className="h-full pr-2">
          <div className="space-y-3">
            {filteredTrainings.length === 0 ? (
              <div className="flex min-h-[200px] items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-slate-950/60 px-4 text-center text-sm text-slate-400">
                Uygun antrenman bulunamadı.
              </div>
            ) : filteredTrainings.map(renderTrainingCard)}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[#020617] text-slate-100">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.14),transparent_26%),radial-gradient(circle_at_bottom,rgba(16,185,129,0.14),transparent_30%),linear-gradient(180deg,rgba(2,6,23,0.96),rgba(2,6,23,1))]" />
      <div className="relative z-20 shrink-0 border-b border-cyan-400/10 bg-[#030712]/90 px-3 py-3 shadow-[0_24px_60px_rgba(0,0,0,0.52)] backdrop-blur-2xl sm:px-4">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <BackButton className="h-11 w-11 rounded-2xl border border-white/10 bg-slate-950/80 text-slate-100 hover:border-cyan-300/35 hover:bg-slate-900/90" />
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-300">Training Hub</p>
              <h1 className="text-2xl font-black uppercase tracking-[0.08em] text-white">Antrenman Merkezi</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Button variant="secondary" size="sm" className="h-11 shrink-0 rounded-2xl border border-white/10 bg-slate-950/80 px-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-100 transition hover:border-cyan-300/35 hover:bg-slate-900/90 disabled:opacity-40" disabled={isTraining || squadRoleSelections.starters.length === 0} onClick={() => handleSquadSelection('starters')}>İlk 11</Button>
            <Button variant="secondary" size="sm" className="h-11 shrink-0 rounded-2xl border border-white/10 bg-slate-950/80 px-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-100 transition hover:border-cyan-300/35 hover:bg-slate-900/90 disabled:opacity-40" disabled={isTraining || squadRoleSelections.bench.length === 0} onClick={() => handleSquadSelection('bench')}>Yedekler</Button>
            <Button variant="secondary" size="sm" className="h-11 shrink-0 rounded-2xl border border-white/10 bg-slate-950/80 px-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-100 transition hover:border-cyan-300/35 hover:bg-slate-900/90 disabled:opacity-40" disabled={isTraining || squadRoleSelections.reserves.length === 0} onClick={() => handleSquadSelection('reserves')}>Kadro Dışı</Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="h-11 shrink-0 rounded-2xl border border-white/10 bg-slate-950/80 px-4 text-sm font-semibold text-slate-100 hover:border-cyan-300/35 hover:bg-slate-900/90">
                  <History className="mr-2 h-4 w-4" />
                  Geçmiş
                </Button>
              </SheetTrigger>
              <SheetContent className="flex h-full flex-col gap-4 border-l border-cyan-400/10 bg-[#020617]/98 px-5 py-5 text-slate-100 sm:max-w-lg">
                <SheetHeader className="space-y-2 text-left">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-300">Sonuçlar</p>
                  <SheetTitle className="text-left text-xl font-semibold text-white">Antrenman Geçmişi</SheetTitle>
                </SheetHeader>
                <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                  En yeni 5 kayıt gösteriliyor. Sistem yalnızca son 10 kaydı saklar.
                </div>
                <div className="min-h-0 flex-1">
                  <ScrollArea className="h-full pr-2">
                    {visibleHistory.length === 0 ? (
                      <div className="flex min-h-[320px] items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-slate-950/60 px-4 text-center text-sm text-slate-400">Henüz antrenman kaydı bulunmuyor.</div>
                    ) : (
                      <div className="space-y-3">
                        {visibleHistory.map(record => {
                          const player = players.find(item => item.id === record.playerId);
                          const training = trainingCatalog.find(item => item.id === record.trainingId);
                          return (
                            <div key={record.id} className={cn('rounded-[22px] border p-4 text-sm shadow-[0_18px_40px_rgba(0,0,0,0.18)]', getTrainingHistoryCardClass(record.result))}>
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                  <p className="font-semibold text-white">{player?.name ?? 'Bilinmeyen Oyuncu'}</p>
                                  <p className="text-xs text-slate-400">{training?.name ?? 'Bilinmeyen Antrenman'}</p>
                                </div>
                                <span className="text-xs text-slate-400">{record.completedAt?.toDate().toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  {record.gain > 0 ? (
                                    <span className="text-xs font-medium text-emerald-300">
                                      {training?.type ? `${getTrainingAttributeLabel(training.type)}: +${(record.gain * 100).toFixed(1)}` : `Gelişim: +${(record.gain * 100).toFixed(1)}`}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-slate-500">Bu çalışmada gelişim oluşmadı.</span>
                                  )}
                                </div>
                                <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', getTrainingHistoryBadgeClass(record.result))}>{getTrainingResultLabel(record.result)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>

      <div className="relative z-10 min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-3 p-3 sm:p-4">
          <div className="w-full max-w-[460px]">
            <div className="grid grid-cols-2 gap-2 rounded-[24px] border border-white/10 bg-[#040b1d]/85 p-2 md:grid-cols-4">
              {DISPLAY_METRIC_OPTIONS.map(option => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setDisplayMetric(option.key)}
                  className={cn(
                    'min-w-0 rounded-[18px] border px-2.5 py-2 text-center text-[10px] font-semibold uppercase leading-tight tracking-[0.12em] whitespace-nowrap transition sm:text-[11px] sm:tracking-[0.14em]',
                    displayMetric === option.key ? option.activeClass : option.idleClass,
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[320px_minmax(0,1.35fr)_340px] xl:grid-cols-[340px_minmax(0,1.45fr)_360px]">
            <div className="order-2 hidden min-h-0 lg:flex lg:order-1">{renderPlayersPanel('h-full w-full')}</div>

            <div className="order-1 min-h-0 flex flex-col gap-3 lg:order-2">
              <div className="grid gap-3 md:grid-cols-2">
                <Card onDragOver={event => handleDragOver(event, 'player')} onDrop={event => handleDrop(event, 'player')} className={cn(panelClass, 'rounded-[28px] border border-dashed border-white/10 bg-[#040b1d]/70', draggingType === 'player' && 'border-cyan-300/45 shadow-[0_0_0_1px_rgba(34,211,238,0.16),0_18px_40px_rgba(34,211,238,0.18)]', isTraining && 'opacity-70')}>
                  <CardHeader className="space-y-4 p-5 pb-4">
                    <CardTitle className={sectionTitleClass}><Users className="h-5 w-5 text-cyan-300" />Seçilen Oyuncular ({selectedPlayers.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="min-h-[220px] p-4 pt-0">
                    {selectedPlayers.length === 0 ? (
                      <div className="flex min-h-[150px] items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-slate-950/60 px-4 text-center text-sm text-slate-400">Oyuncuları sürükleyip bırakın veya çift tıklayın.</div>
                    ) : (
                      <div className="space-y-3">
                        {selectedPlayers.map(player => {
                          const metricValue = getDisplayMetricValue(player, displayMetric);
                          const metricBadgeClass =
                            displayMetric === 'overall'
                              ? getOverallBadgeClass(player.overall)
                              : activeDisplayMetric.badgeClass;

                          return (
                            <div key={player.id} className="flex items-center gap-3 rounded-[22px] border border-cyan-400/20 bg-cyan-500/10 p-3 shadow-[0_18px_36px_rgba(8,145,178,0.14)]">
                              <div className="flex h-14 w-14 items-center justify-center rounded-[18px] border border-cyan-400/25 bg-cyan-400/10 text-sm font-black uppercase tracking-[0.18em] text-cyan-100">{getPlayerInitials(player.name)}</div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-semibold text-white">{player.name}</p>
                                <p className="text-sm text-slate-400">{player.position} • Genel {formatRatingLabel(player.overall)}</p>
                                <div className="mt-2 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-500">
                                  <span>{activeDisplayMetric.label}</span>
                                  <span className="text-slate-300">{metricValue}</span>
                                </div>
                                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-950/80">
                                  <div className={cn('h-full rounded-full', activeDisplayMetric.barClass)} style={{ width: `${metricValue}%` }} />
                                </div>
                              </div>
                              <div className={cn('flex h-11 min-w-[50px] items-center justify-center rounded-[16px] px-3 text-lg font-black', metricBadgeClass)}>{displayMetric === 'overall' ? formatRatingLabel(player.overall) : metricValue}</div>
                              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => removeSelectedPlayer(player.id)}><X className="h-4 w-4" /></Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card onDragOver={event => handleDragOver(event, 'training')} onDrop={event => handleDrop(event, 'training')} className={cn(panelClass, 'rounded-[28px] border border-dashed border-white/10 bg-[#040b1d]/70', draggingType === 'training' && 'border-emerald-300/45 shadow-[0_0_0_1px_rgba(74,222,128,0.16),0_18px_40px_rgba(16,185,129,0.18)]', isTraining && 'opacity-70')}>
                  <CardHeader className="space-y-4 p-5 pb-4">
                    <CardTitle className={sectionTitleClass}><Dumbbell className="h-5 w-5 text-emerald-300" />Seçilen Antrenmanlar ({selectedTrainings.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="min-h-[220px] p-4 pt-0">
                    {selectedTrainings.length === 0 ? (
                      <div className="flex min-h-[150px] items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-slate-950/60 px-4 text-center text-sm text-slate-400">Antrenman kartlarını bu alana bırakın.</div>
                    ) : (
                      <div className="space-y-3">
                        {selectedTrainings.map(training => {
                          const accent = getTrainingAccent(training.type);
                          return (
                            <div key={training.id} className={cn('flex items-center gap-3 rounded-[22px] border p-3 shadow-[0_18px_36px_rgba(0,0,0,0.14)]', accent.card, accent.glow)}>
                              <div className={cn('flex h-14 w-14 items-center justify-center rounded-[18px] border text-sm font-black uppercase tracking-[0.18em]', accent.badge)}>{getTrainingMonogram(training.type)}</div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-semibold text-white">{training.name}</p>
                                <p className="text-sm text-slate-400">{getTrainingAttributeLabel(training.type)} • {training.duration} dk</p>
                              </div>
                              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => removeSelectedTraining(training.id)}><X className="h-4 w-4" /></Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className={panelClass}>
                <CardHeader className="space-y-4 p-5 pb-4">
                  <CardTitle className={sectionTitleClass}><ClipboardList className="h-5 w-5 text-sky-300" />Antrenman Kontrolü</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 p-5 pt-0">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4"><p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Oyuncu Sayısı</p><p className="mt-2 text-3xl font-black text-white">{selectedPlayers.length}</p></div>
                    <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4"><p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Antrenman Sayısı</p><p className="mt-2 text-3xl font-black text-white">{selectedTrainings.length}</p></div>
                    <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4"><p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Toplam Kombinasyon</p><p className="mt-2 text-3xl font-black text-white">{totalAssignments}</p></div>
                    <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4"><p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Beklenen Süre</p><p className="mt-2 text-3xl font-black text-white">{sessionDurationMinutes} dk</p></div>
                  </div>

                  <div className={cn('rounded-[26px] border p-5 shadow-[0_0_0_1px_rgba(16,185,129,0.08),0_18px_48px_rgba(16,185,129,0.14)]', leadAccent.card, leadAccent.glow)}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">{isTraining ? 'Antrenman Başladı!' : 'Antrenman Kontrolü'}</p>
                        <h3 className="mt-2 text-2xl font-black text-white">
                          {isTraining ? `${formatTime(Math.max(timeLeft, 0))} / ${formatTime(activeDurationSeconds)}` : canStart ? 'Kadroyu hazırladın, başlatabilirsin.' : 'Oyuncu ve antrenman seçerek oturumu hazırla.'}
                        </h3>
                      </div>
                      <div className="rounded-[18px] border border-white/10 bg-slate-950/70 px-4 py-3 text-right">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Süre</p>
                        <p className="mt-1 text-2xl font-black text-white">{isTraining ? formatTime(timeLeft) : `${sessionDurationMinutes} dk`}</p>
                      </div>
                    </div>
                    <div className="mt-5 h-4 overflow-hidden rounded-full bg-slate-950/80">
                      <div className={cn('h-full rounded-full bg-gradient-to-r', leadAccent.progress)} style={{ width: `${progressPercent}%` }} />
                    </div>
                    <div className="mt-5 space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-slate-400"><Clock className="h-4 w-4" /><span>Süre</span></div><span className="font-semibold text-white">{isTraining ? formatTime(timeLeft) : `${sessionDurationMinutes} dakika`}</span></div>
                      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-slate-400"><Diamond className="h-4 w-4" /><span>Elmas Maliyeti</span></div><span className="font-semibold text-white">{diamondCost}</span></div>
                      {isTraining && <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-slate-400"><Diamond className="h-4 w-4" /><span>Erken Bitirme Ücreti</span></div><span className="font-semibold text-white">{finishDiamondCost}</span></div>}
                      {diamondCost === 0 && <p className="pt-2 text-xs text-slate-400">Bir oyuncu + bir antrenman kombinasyonu ücretsizdir.</p>}
                    </div>
                  </div>

                  {!isTraining ? (
                    <Button onClick={handleStartTraining} disabled={!canStart} className="h-14 w-full rounded-[22px] border border-cyan-300/20 bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400 text-base font-black uppercase tracking-[0.14em] text-slate-950 shadow-[0_18px_42px_rgba(34,211,238,0.28)] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-900 disabled:text-slate-500">Antrenmanı Başlat</Button>
                  ) : (
                    <div className="space-y-3">
                      {timeLeft > 0 && (
                        <>
                          <Button onClick={handleFinishWithDiamonds} variant="outline" className="h-12 w-full rounded-[18px] border border-amber-400/25 bg-amber-500/10 text-amber-100 hover:bg-amber-500/16" disabled={isFinishingWithDiamonds}><Diamond className="mr-2 h-4 w-4" />Elmasla Bitir ({finishDiamondCost})</Button>
                          <Button onClick={handleWatchAd} variant="secondary" className="h-14 w-full rounded-[22px] border border-fuchsia-300/30 bg-gradient-to-r from-fuchsia-500 via-violet-500 to-purple-500 text-base font-black text-white shadow-[0_18px_45px_rgba(168,85,247,0.32)] hover:brightness-110 disabled:opacity-60" disabled={isWatchingAd}><Clapperboard className="mr-2 h-5 w-5" />{isWatchingAd ? 'Video Yükleniyor...' : 'Hemen Bitir (Reklam İzle)'}</Button>
                        </>
                      )}
                      <p className="text-center text-xs text-slate-400">Antrenman devam ederken seçimler kilitlenir.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="order-3 hidden min-h-0 lg:flex">{renderTrainingsPanel('h-full w-full')}</div>

            <div className="order-2 min-h-0 lg:hidden">
              <Tabs defaultValue="players" className="space-y-3">
                <TabsList className="grid h-auto w-full grid-cols-2 rounded-[22px] border border-white/10 bg-[#030b1b]/80 p-1">
                  <TabsTrigger value="players" className="rounded-[18px] py-3 text-sm font-semibold text-slate-400 data-[state=active]:bg-cyan-500/12 data-[state=active]:text-cyan-100 data-[state=active]:shadow-none">Oyuncular</TabsTrigger>
                  <TabsTrigger value="trainings" className="rounded-[18px] py-3 text-sm font-semibold text-slate-400 data-[state=active]:bg-emerald-500/12 data-[state=active]:text-emerald-100 data-[state=active]:shadow-none">Antrenmanlar</TabsTrigger>
                </TabsList>
                <TabsContent value="players" className="mt-0">{renderPlayersPanel('min-h-[440px]')}</TabsContent>
                <TabsContent value="trainings" className="mt-0">{renderTrainingsPanel('min-h-[440px]')}</TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(playerDetail)} onOpenChange={open => { if (!open) setPlayerDetail(null); }}>
        <DialogContent className="max-w-md border-none bg-transparent p-0 shadow-none">
          {playerDetail ? <PlayerStatusCard player={playerDetail} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
