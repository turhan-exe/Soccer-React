import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
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
import { useTranslation } from '@/contexts/LanguageContext';
import { getTeam } from '@/services/team';
import {
  ActiveTrainingSession,
  TRAINING_FINISH_COST,
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
const TRAINING_HISTORY_STORAGE_LIMIT = 10;
const TRAINING_HISTORY_VISIBLE_LIMIT = 5;

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
  compactGlow: string;
  selectionOverlay: string;
  progress: string;
};

type DisplayMetricKey = 'overall' | 'health' | 'motivation' | 'condition';

type DisplayMetricOption = {
  key: DisplayMetricKey;
  labelKey: string;
  label?: string;
  activeClass: string;
  idleClass: string;
  badgeClass: string;
  barClass: string;
};

const DISPLAY_METRIC_OPTIONS: DisplayMetricOption[] = [
  {
    key: 'overall',
    labelKey: 'training.metrics.overall',
    activeClass: 'border-cyan-300/45 bg-cyan-500/14 text-cyan-100 shadow-[0_12px_28px_rgba(34,211,238,0.18)]',
    idleClass: 'border-white/10 bg-slate-950/80 text-slate-400 hover:border-cyan-300/25 hover:text-slate-200',
    badgeClass: '',
    barClass: 'bg-gradient-to-r from-cyan-400 to-sky-400',
  },
  {
    key: 'health',
    labelKey: 'training.metrics.health',
    activeClass: 'border-rose-300/45 bg-rose-500/14 text-rose-100 shadow-[0_12px_28px_rgba(251,113,133,0.18)]',
    idleClass: 'border-white/10 bg-slate-950/80 text-slate-400 hover:border-rose-300/25 hover:text-slate-200',
    badgeClass: 'border border-rose-300/25 bg-rose-400 text-slate-950 shadow-[0_10px_25px_rgba(251,113,133,0.25)]',
    barClass: 'bg-gradient-to-r from-rose-400 to-pink-400',
  },
  {
    key: 'motivation',
    labelKey: 'training.metrics.motivation',
    activeClass: 'border-emerald-300/45 bg-emerald-500/14 text-emerald-100 shadow-[0_12px_28px_rgba(74,222,128,0.18)]',
    idleClass: 'border-white/10 bg-slate-950/80 text-slate-400 hover:border-emerald-300/25 hover:text-slate-200',
    badgeClass: 'border border-emerald-300/25 bg-emerald-400 text-slate-950 shadow-[0_10px_25px_rgba(74,222,128,0.25)]',
    barClass: 'bg-gradient-to-r from-emerald-400 to-lime-400',
  },
  {
    key: 'condition',
    labelKey: 'training.metrics.condition',
    activeClass: 'border-amber-300/45 bg-amber-500/14 text-amber-100 shadow-[0_12px_28px_rgba(251,191,36,0.18)]',
    idleClass: 'border-white/10 bg-slate-950/80 text-slate-400 hover:border-amber-300/25 hover:text-slate-200',
    badgeClass: 'border border-amber-300/25 bg-amber-400 text-slate-950 shadow-[0_10px_25px_rgba(251,191,36,0.25)]',
    barClass: 'bg-gradient-to-r from-amber-400 to-orange-400',
  },
];

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
      glow: 'border-emerald-400/45 ring-1 ring-inset ring-emerald-300/35 shadow-[0_18px_40px_rgba(16,185,129,0.18)]',
      compactGlow: 'shadow-none',
      selectionOverlay: 'bg-emerald-400/[0.03] ring-1 ring-inset ring-emerald-300/55 shadow-[inset_0_0_18px_rgba(16,185,129,0.12)]',
      progress: 'from-emerald-400 via-cyan-400 to-sky-500',
    };
  }

  if (attribute === 'tackling') {
    return {
      badge: 'border-rose-400/40 bg-rose-500/12 text-rose-100',
      card: 'border-rose-400/18 bg-rose-500/6',
      chip: 'border-rose-400/25 bg-rose-500/12 text-rose-100',
      glow: 'border-rose-400/45 ring-1 ring-inset ring-rose-300/35 shadow-[0_18px_40px_rgba(225,29,72,0.18)]',
      compactGlow: 'shadow-none',
      selectionOverlay: 'bg-rose-400/[0.03] ring-1 ring-inset ring-rose-300/55 shadow-[inset_0_0_18px_rgba(225,29,72,0.12)]',
      progress: 'from-rose-400 via-orange-400 to-amber-300',
    };
  }

  if (attribute === 'topSpeed' || attribute === 'shooting' || attribute === 'shootPower') {
    return {
      badge: 'border-amber-400/40 bg-amber-500/12 text-amber-100',
      card: 'border-amber-400/18 bg-amber-500/6',
      chip: 'border-amber-400/25 bg-amber-500/12 text-amber-100',
      glow: 'border-amber-400/45 ring-1 ring-inset ring-amber-300/35 shadow-[0_18px_40px_rgba(245,158,11,0.18)]',
      compactGlow: 'shadow-none',
      selectionOverlay: 'bg-amber-400/[0.03] ring-1 ring-inset ring-amber-300/55 shadow-[inset_0_0_18px_rgba(245,158,11,0.12)]',
      progress: 'from-amber-400 via-orange-400 to-yellow-300',
    };
  }

  if (attribute === 'acceleration' || attribute === 'longBall' || attribute === 'reaction') {
    return {
      badge: 'border-violet-400/40 bg-violet-500/12 text-violet-100',
      card: 'border-violet-400/18 bg-violet-500/6',
      chip: 'border-violet-400/25 bg-violet-500/12 text-violet-100',
      glow: 'border-violet-400/45 ring-1 ring-inset ring-violet-300/35 shadow-[0_18px_40px_rgba(124,58,237,0.18)]',
      compactGlow: 'shadow-none',
      selectionOverlay: 'bg-violet-400/[0.03] ring-1 ring-inset ring-violet-300/55 shadow-[inset_0_0_18px_rgba(124,58,237,0.12)]',
      progress: 'from-violet-400 via-fuchsia-400 to-sky-400',
    };
  }

  return {
    badge: 'border-cyan-400/35 bg-cyan-500/12 text-cyan-100',
    card: 'border-cyan-400/18 bg-cyan-500/6',
    chip: 'border-cyan-400/20 bg-cyan-500/12 text-cyan-100',
    glow: 'border-cyan-400/45 ring-1 ring-inset ring-cyan-300/35 shadow-[0_18px_40px_rgba(34,211,238,0.18)]',
    compactGlow: 'shadow-none',
    selectionOverlay: 'bg-cyan-400/[0.03] ring-1 ring-inset ring-cyan-300/55 shadow-[inset_0_0_18px_rgba(34,211,238,0.12)]',
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
  const { t, formatDate } = useTranslation();

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
  const [isCompactLandscape, setIsCompactLandscape] = useState(false);
  const [mobileLibraryView, setMobileLibraryView] = useState<'players' | 'trainings'>('players');
  const [touchDragPayload, setTouchDragPayload] = useState<{ type: 'player' | 'training'; id: string } | null>(null);
  const [touchDragPoint, setTouchDragPoint] = useState<{ x: number; y: number } | null>(null);
  const [touchDropTarget, setTouchDropTarget] = useState<'player' | 'training' | null>(null);
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
  const touchDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchDragMovedRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const suppressNextPlayerTapRef = useRef(false);
  const selectedPlayersDropzoneRef = useRef<HTMLDivElement | null>(null);
  const selectedTrainingsDropzoneRef = useRef<HTMLDivElement | null>(null);

  const trainingCatalog = useMemo(
    () =>
      trainings.map(training => ({
        ...training,
        name: t('training.labels.trainingName', {
          attribute: getTrainingAttributeLabel(training.type),
        }),
        description: t(`training.descriptions.${training.type}`),
      })),
    [t],
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
              record.id && unseenSet.has(record.id) ? { ...record, viewed: true } : record,
            );
          } catch (error) {
            console.warn('Antrenman kayÄ±tlarÄ± gÃ¶rÃ¼ldÃ¼ olarak iÅŸaretlenemedi', error);
          }
        }

        setHistory(normalizeTrainingHistory(finalRecords));
      } catch (error) {
        console.warn('Antrenman geÃ§miÅŸi yÃ¼klenemedi', error);
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
        console.warn('Aktif antrenman yÃ¼klenemedi', error);
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
        toast.success(t('training.toasts.completeSuccess'));
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
      toast.success(t('training.toasts.completeWithCount', { count: result.records.length }));
    } catch (error) {
      console.warn('Antrenman tamamlanamadÄ±', error);
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
      toast.error(t('training.toasts.resultSaveFailed')); 
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

  const formatMinutesShort = useCallback(
    (value: number) => t('common.minutesShort', { value }),
    [t],
  );

  const formatMinutesLong = useCallback(
    (value: number) => t('common.minutesLong', { value }),
    [t],
  );

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

  const commitSelectionDrop = useCallback(
    (type: 'player' | 'training', id: string) => {
      if (isTraining) {
        return false;
      }

      if (type === 'player') {
        const player = players.find(item => item.id === id);
        if (!player) {
          return false;
        }

        setSelectedPlayers(prev =>
          prev.some(item => item.id === player.id) ? prev : [...prev, player],
        );
        setExpandedPlayerId(null);
        setPlayerDetail(null);
        return true;
      }

      const training = trainingCatalog.find(item => item.id === id);
      if (!training) {
        return false;
      }

      setSelectedTrainings(prev =>
        prev.some(item => item.id === training.id) ? prev : [...prev, training],
      );
      return true;
    },
    [isTraining, players, trainingCatalog],
  );

  const clearTouchDragState = useCallback(() => {
    touchDragStartRef.current = null;
    touchDragMovedRef.current = false;
    activePointerIdRef.current = null;
    setTouchDragPayload(null);
    setTouchDragPoint(null);
    setTouchDropTarget(null);
  }, []);

  const resolveTouchDropTarget = useCallback(
    (clientX: number, clientY: number): 'player' | 'training' | null => {
      const isInsideRect = (element: HTMLElement | null) => {
        if (!element) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        );
      };

      if (isInsideRect(selectedPlayersDropzoneRef.current)) {
        return 'player';
      }
      if (isInsideRect(selectedTrainingsDropzoneRef.current)) {
        return 'training';
      }

      if (typeof document === 'undefined') {
        return null;
      }

      const target = document.elementFromPoint(clientX, clientY);
      if (!(target instanceof HTMLElement)) {
        return null;
      }

      const dropzone = target.closest<HTMLElement>('[data-training-dropzone]');
      const value = dropzone?.dataset.trainingDropzone;
      return value === 'player' || value === 'training' ? value : null;
    },
    [],
  );

  const handlePointerDragStart = useCallback(
    (
      event: React.PointerEvent<HTMLDivElement>,
      type: 'player' | 'training',
      id: string,
    ) => {
      if (isTraining) {
        return;
      }

      const nativeHtmlDragAllowed =
        typeof window !== 'undefined' &&
        !Capacitor.isNativePlatform() &&
        !window.matchMedia('(pointer: coarse)').matches;

      if (nativeHtmlDragAllowed && event.pointerType === 'mouse') {
        return;
      }

      activePointerIdRef.current = event.pointerId;
      touchDragStartRef.current = { x: event.clientX, y: event.clientY };
      touchDragMovedRef.current = false;
      setTouchDragPayload({ type, id });
      setTouchDragPoint({ x: event.clientX, y: event.clientY });
      setTouchDropTarget(null);
    },
    [isTraining],
  );

  useEffect(() => {
    if (!touchDragPayload || activePointerIdRef.current === null) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (activePointerIdRef.current !== event.pointerId) {
        return;
      }

      const start = touchDragStartRef.current;
      if (!start) {
        return;
      }

      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      const distance = Math.hypot(deltaX, deltaY);

      if (!touchDragMovedRef.current && distance < 10) {
        return;
      }

      touchDragMovedRef.current = true;
      event.preventDefault();
      setTouchDragPoint({ x: event.clientX, y: event.clientY });
      setTouchDropTarget(resolveTouchDropTarget(event.clientX, event.clientY));
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (activePointerIdRef.current !== event.pointerId) {
        return;
      }

      const dropTarget = resolveTouchDropTarget(event.clientX, event.clientY);
      if (
        touchDragMovedRef.current &&
        dropTarget &&
        dropTarget === touchDragPayload.type
      ) {
        void commitSelectionDrop(touchDragPayload.type, touchDragPayload.id);
        if (touchDragPayload.type === 'player') {
          suppressNextPlayerTapRef.current = true;
        }
      }

      clearTouchDragState();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (activePointerIdRef.current !== event.pointerId) {
        return;
      }
      clearTouchDragState();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [clearTouchDragState, commitSelectionDrop, resolveTouchDropTarget, touchDragPayload]);

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

      void commitSelectionDrop(type, parsed.id);
    } catch (error) {
      console.warn('Drag & drop verisi ayrÄ±ÅŸtÄ±rÄ±lamadÄ±', error);
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
      toast.error(t('training.toasts.loginRequired'));
      return;
    }

    if (selectedPlayers.length === 0 || selectedTrainings.length === 0) {
      toast.error(t('training.toasts.selectionRequired'));
      return;
    }

    if (isTraining) {
      toast.info(t('training.toasts.activeExists'));
      return;
    }

    if (diamondCost > 0) {
      if (balance < diamondCost) {
        toast.error(t('training.toasts.insufficientDiamonds'));
        return;
      }

      try {
        await spend(diamondCost);
      } catch (error) {
        toast.error(t('training.toasts.diamondFinishFailed'));
        return;
      }
    }

    const durationSeconds = sessionDurationMinutes * 60;
    if (durationSeconds <= 0) {
      toast.error(t('training.toasts.invalidDuration'));
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
      console.warn('[TrainingPage] active training could not be saved', error);
      toast.error(t('training.toasts.startFailed'));
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
    toast.success(t('training.toasts.startSuccess'));
  };

  const handleFinishWithDiamonds = async () => {
    if (!user || !activeSession || isFinishingWithDiamonds) {
      return;
    }

    if (timeLeft <= 0) {
      toast.info(t('training.toasts.alreadyCompleted'));
      return;
    }

    if (balance < finishDiamondCost) {
      toast.error(t('training.toasts.insufficientDiamonds'));
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
      toast.success(t('training.toasts.completeWithCount', { count: result.records.length }));
    } catch (error) {
      console.warn('[TrainingPage] diamond finish failed', error);
      toast.error(t('training.toasts.finishWithDiamondsFailed'));
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
      toast.info(t('training.toasts.alreadyCompleted'));
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
        toast.info(t('training.toasts.adDismissed'));
        resumeCountdownIfNeeded();
        return;
      }

      if (result.outcome === 'pending_verification') {
        toast.info(t('training.toasts.adPending'));
        resumeCountdownIfNeeded();
        return;
      }

      toast.error(getRewardedAdFailureMessage(result.ad));
      resumeCountdownIfNeeded();
    } catch (error) {
      console.warn('[TrainingPage] ad finish failed', error);
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
        toast.info(t('training.empty.emptyGroup'));
        return;
      }

      setSelectedPlayers(groupPlayers);
      setExpandedPlayerId(null);
      setPlayerDetail(null);
    },
    [isTraining, squadRoleSelections, t],
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
    () => ({
      ...(getDisplayMetricOption(displayMetric) ?? DISPLAY_METRIC_OPTIONS[0]),
      label: t(
        (getDisplayMetricOption(displayMetric) ?? DISPLAY_METRIC_OPTIONS[0]).labelKey,
      ),
    }),
    [displayMetric, t],
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
  const useTightLandscapeColumns =
    typeof window !== 'undefined' &&
    window.innerWidth > window.innerHeight &&
    (Capacitor.isNativePlatform() ||
      window.matchMedia('(pointer: coarse)').matches ||
      window.innerHeight <= 1100);
  const supportsNativeHtmlDrag =
    typeof window !== 'undefined' &&
    !Capacitor.isNativePlatform() &&
    !window.matchMedia('(pointer: coarse)').matches;
  const isTouchSelectionMode = !supportsNativeHtmlDrag;
  const panelClass =
    'overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,15,31,0.96),rgba(3,7,18,0.94))] text-slate-100 shadow-[0_22px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl';
  const sectionTitleClass =
    'flex items-center gap-2.5 text-[13px] font-semibold uppercase tracking-[0.16em] text-slate-100 sm:gap-3 sm:text-[15px] sm:tracking-[0.18em]';
  const searchInputClass =
    'h-10 rounded-2xl border border-white/10 bg-[#060d1f]/90 pl-10 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-cyan-400/35 focus-visible:ring-offset-0 sm:h-12';

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateCompactLandscape = () => {
      const isLandscape = window.innerWidth > window.innerHeight;
      const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
      const isNativeMobile = Capacitor.isNativePlatform() && ['android', 'ios'].includes(Capacitor.getPlatform());
      const isMobileLike = isNativeMobile || hasCoarsePointer || /Android|iPhone|iPad|Mobile/i.test(window.navigator.userAgent);
      const hasShortViewport = window.innerHeight <= 720;
      const isCompact = isLandscape && (isMobileLike || hasShortViewport);
      setIsCompactLandscape(isCompact);
    };

    updateCompactLandscape();
    window.addEventListener('resize', updateCompactLandscape);
    return () => window.removeEventListener('resize', updateCompactLandscape);
  }, []);

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
        draggable={!isTraining && supportsNativeHtmlDrag}
        data-training-source="player"
        onPointerDown={event => handlePointerDragStart(event, 'player', player.id)}
        onDragStart={event => {
          setExpandedPlayerId(null);
          setPlayerDetail(null);
          handleDragStart(event, 'player', player.id);
        }}
        onDragEnd={handleDragEnd}
        onClick={() => {
          if (suppressNextPlayerTapRef.current) {
            suppressNextPlayerTapRef.current = false;
            return;
          }
          if (isTraining) return;
          if (isTouchSelectionMode) {
            void commitSelectionDrop('player', player.id);
            return;
          }
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
          isTouchSelectionMode && 'touch-none',
          isExpanded && 'border-cyan-300/45 shadow-[0_0_0_1px_rgba(34,211,238,0.16),0_18px_40px_rgba(8,145,178,0.18)]',
          isSelected && 'border-emerald-400/35 shadow-[0_18px_40px_rgba(16,185,129,0.16)]',
        )}
      >
        <CardContent className={cn('p-3 sm:p-4', isCompactLandscape && 'p-2')}>
          <div className={cn('flex gap-3 sm:gap-4', isCompactLandscape && 'gap-2')}>
            <div className={cn('flex shrink-0 items-center justify-center rounded-[18px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_55%),rgba(255,255,255,0.04)] font-black uppercase text-slate-100 sm:rounded-[20px] sm:text-lg sm:tracking-[0.2em]', isCompactLandscape ? 'h-10 w-10 text-sm tracking-[0.12em]' : 'h-12 w-12 text-base tracking-[0.16em] sm:h-16 sm:w-16')}>
              {getPlayerInitials(player.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn('truncate font-semibold text-white sm:text-base', isCompactLandscape ? 'text-[11px] leading-tight' : 'text-sm')}>{player.name}</p>
                  <div className={cn('mt-1 flex items-center gap-2 text-slate-400', isCompactLandscape ? 'overflow-hidden whitespace-nowrap text-[9px]' : 'flex-wrap text-xs')}>
                    <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 font-semibold text-cyan-100">
                      {player.position}
                    </span>
                    <span>{t('training.labels.overall')} {formatRatingLabel(player.overall)}</span>
                  </div>
                </div>
                <div className={cn('flex items-center justify-center rounded-[16px] font-black leading-none sm:rounded-[18px]', metricBadgeClass, isCompactLandscape ? 'min-w-[38px] px-1.5 py-1 text-xs' : 'min-w-[50px] px-2.5 py-1.5 text-base sm:min-w-[58px] sm:px-3 sm:py-2 sm:text-lg')}>
                  {displayMetric === 'overall' ? formatRatingLabel(player.overall) : metricValue}
                </div>
              </div>
              <div className={cn('flex items-center justify-between uppercase tracking-[0.22em] text-slate-500', isCompactLandscape ? 'mt-1.5 text-[9px]' : 'mt-3 text-[11px]')}>
                <span>{metricLabel}</span>
                <span className="text-slate-300">{metricValue}</span>
              </div>
              <div className={cn('overflow-hidden rounded-full bg-slate-950/90', isCompactLandscape ? 'mt-1.5 h-1.5' : 'mt-2 h-2')}>
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
        draggable={!isTraining && supportsNativeHtmlDrag}
        data-training-source="training"
        onPointerDown={event => handlePointerDragStart(event, 'training', training.id)}
        onDragStart={event => handleDragStart(event, 'training', training.id)}
        onDragEnd={handleDragEnd}
        onClick={() => {
          if (isTraining) {
            return;
          }
          if (isTouchSelectionMode) {
            void commitSelectionDrop('training', training.id);
          }
        }}
        onDoubleClick={() => {
          if (!isTraining) {
            setSelectedTrainings(prev =>
              prev.some(item => item.id === training.id) ? prev : [...prev, training],
            );
          }
        }}
        className={cn(
          'relative min-w-0 max-w-full overflow-hidden rounded-[24px] border bg-[linear-gradient(135deg,rgba(8,15,33,0.96),rgba(5,12,24,0.96))] transition duration-200',
          isCompactLandscape ? 'my-0.5 w-full box-border' : 'mx-1.5 my-1',
          accent.card,
          isTraining ? 'pointer-events-none opacity-50' : 'cursor-pointer hover:brightness-110',
          isTouchSelectionMode && 'touch-none',
          isSelected && (isCompactLandscape ? accent.compactGlow : accent.glow),
        )}
      >
        {isSelected ? (
          <div
            className={cn(
              'pointer-events-none absolute inset-0 rounded-[24px]',
              accent.selectionOverlay,
            )}
          />
        ) : null}
        <CardContent className={cn('p-3 sm:p-4', isCompactLandscape && 'p-2')}>
          <div className={cn('flex gap-3 sm:gap-4', isCompactLandscape && 'gap-2')}>
            <div className={cn('flex shrink-0 items-center justify-center rounded-[18px] border text-xs font-black uppercase tracking-[0.16em] sm:rounded-[20px] sm:text-sm sm:tracking-[0.18em]', accent.badge, isCompactLandscape ? 'h-10 w-10 text-[10px]' : 'h-12 w-12 sm:h-14 sm:w-14')}>
              {getTrainingMonogram(training.type)}
            </div>
            <div className="min-w-0 flex-1">
              <div className={cn('flex items-start justify-between gap-3', isCompactLandscape && 'gap-2')}>
                <div className="min-w-0">
                  <p className={cn('truncate font-semibold text-white sm:text-base', isCompactLandscape ? 'text-[11px] leading-tight' : 'text-sm')}>{training.name}</p>
                  <p className={cn('mt-1 text-slate-400 sm:text-sm', isCompactLandscape ? 'truncate text-[9px]' : 'text-xs')}>{training.description}</p>
                  {isCompactLandscape ? (
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={cn('inline-flex max-w-full shrink-0 rounded-full border font-semibold uppercase tracking-[0.12em]', accent.chip, 'px-1.5 py-0.5 text-[8px]')}>
                        {getTrainingAttributeLabel(training.type)}
                      </span>
                      <p className="truncate text-[10px] font-semibold text-slate-300">
                        {formatMinutesShort(training.duration)}
                      </p>
                    </div>
                  ) : null}
                </div>
                <div className={cn('text-right', isCompactLandscape ? 'hidden' : 'w-[112px] shrink-0 sm:w-[128px]')}>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Odak</p>
                  <span className={cn('mt-1 inline-flex w-full items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full border font-semibold uppercase tracking-[0.16em]', accent.chip, isCompactLandscape ? 'px-2 py-0.5 text-[9px]' : 'px-2.5 py-1 text-[10px]')}>
                    {getTrainingAttributeLabel(training.type)}
                  </span>
                  <p className={cn('mt-1.5 font-semibold text-slate-300', isCompactLandscape ? 'text-[11px]' : 'text-sm')}>{formatMinutesShort(training.duration)}</p>
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
      <CardHeader className={cn('space-y-4 p-5 pb-4', isCompactLandscape && 'space-y-2 p-2 pb-1.5')}>
        <CardTitle className={sectionTitleClass}>
          <Users className="h-5 w-5 text-cyan-300" />
          {t('training.players')}
        </CardTitle>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={playerSearch}
            onChange={event => setPlayerSearch(event.target.value)}
            placeholder={t('training.placeholders.playerSearch')}
            className={cn(searchInputClass, isCompactLandscape && 'h-7 rounded-[15px] pl-8 text-[10px]')}
          />
        </div>
      </CardHeader>
      <CardContent className={cn('min-h-0 flex-1 overflow-hidden p-3 pt-0 sm:p-4 sm:pt-0', isCompactLandscape && 'p-2 pt-0')}>
        <ScrollArea className={cn('h-full', isCompactLandscape ? 'pr-2' : 'pr-2')}>
          <div
            className={cn(
              isCompactLandscape ? 'space-y-2 px-2.5 py-2' : 'space-y-3 pb-2',
            )}
          >
            {filteredPlayers.length === 0 ? (
              <div className="flex min-h-[200px] items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-slate-950/60 px-4 text-center text-sm text-slate-400">
                {t('training.empty.players')}
              </div>
            ) : filteredPlayers.map(renderPlayerCard)}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );

  const renderTrainingsPanel = (panelHeightClass?: string) => (
    <Card className={cn(panelClass, 'flex min-h-0 flex-col', panelHeightClass)}>
      <CardHeader className={cn('space-y-4 p-5 pb-4', isCompactLandscape && 'space-y-2 p-2 pb-1.5')}>
        <CardTitle className={sectionTitleClass}>
          <Dumbbell className="h-5 w-5 text-emerald-300" />
          {t('training.trainings')}
        </CardTitle>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={trainingSearch}
            onChange={event => setTrainingSearch(event.target.value)}
            placeholder={t('training.placeholders.trainingSearch')}
            className={cn(searchInputClass, isCompactLandscape && 'h-7 rounded-[15px] pl-8 text-[10px]')}
          />
        </div>
      </CardHeader>
      <CardContent className={cn('min-h-0 flex-1 overflow-hidden p-3 pt-0 sm:p-4 sm:pt-0', isCompactLandscape && 'p-2 pt-0')}>
        {isCompactLandscape ? (
          <div className="h-full overflow-x-hidden overflow-y-auto pr-1">
            <div className="space-y-2 pl-2.5 pr-4 py-2.5">
              {filteredTrainings.length === 0 ? (
                <div className="flex min-h-[160px] items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-slate-950/60 px-4 text-center text-sm text-slate-400">
                  {t('training.empty.trainings')}
                </div>
              ) : filteredTrainings.map(renderTrainingCard)}
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full pr-4">
            <div className="space-y-3 px-1.5 py-1.5 pb-2">
              {filteredTrainings.length === 0 ? (
                <div className="flex min-h-[200px] items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-slate-950/60 px-4 text-center text-sm text-slate-400">
                  {t('training.empty.trainings')}
                </div>
              ) : filteredTrainings.map(renderTrainingCard)}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );

  const renderSelectedPlayersPanel = (
    options?: {
      compact?: boolean;
      contentClassName?: string;
      scrollAreaClassName?: string;
      cardClassName?: string;
    },
  ) => {
    const compact = options?.compact ?? false;

    return (
    <Card
      ref={selectedPlayersDropzoneRef}
      data-training-dropzone="player"
      onDragOver={event => handleDragOver(event, 'player')}
      onDrop={event => handleDrop(event, 'player')}
      className={cn(
        panelClass,
        'rounded-[28px] border border-dashed border-white/10 bg-[#040b1d]/70',
        (draggingType === 'player' ||
          (touchDragPayload?.type === 'player' && touchDropTarget === 'player')) &&
          'border-cyan-300/45 shadow-[0_0_0_1px_rgba(34,211,238,0.16),0_18px_40px_rgba(34,211,238,0.18)]',
        isTraining && 'opacity-70',
        options?.cardClassName,
      )}
    >
      <CardHeader
        className={cn(
          'space-y-3 p-4 pb-3 sm:space-y-4 sm:p-5 sm:pb-4',
          compact && 'space-y-2 p-3 pb-2 sm:space-y-2.5 sm:p-3.5 sm:pb-2.5',
        )}
      >
        <CardTitle className={sectionTitleClass}>
          <Users className="h-5 w-5 text-cyan-300" />
          {t('training.selectedPlayers', { count: selectedPlayers.length })}
        </CardTitle>
      </CardHeader>
      <CardContent
        className={cn(
          'min-h-[220px] p-4 pt-0',
          compact && 'min-h-[104px] p-3 pt-0 sm:min-h-[120px] sm:p-3.5 sm:pt-0',
          options?.contentClassName,
        )}
      >
        {selectedPlayers.length === 0 ? (
          <div
            className={cn(
              'flex min-h-[150px] items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-slate-950/60 px-4 text-center text-sm text-slate-400',
              compact && 'min-h-[60px] px-3 text-[11px] leading-snug sm:min-h-[72px]',
            )}
          >
            {t('training.empty.selectedPlayers')}
          </div>
        ) : options?.scrollAreaClassName ? (
          <ScrollArea className={options.scrollAreaClassName}>
            <div className={cn('space-y-3 pr-2', compact && 'space-y-2 pr-1')}>
              {selectedPlayers.map(player => {
                const metricValue = getDisplayMetricValue(player, displayMetric);
                const metricBadgeClass =
                  displayMetric === 'overall'
                    ? getOverallBadgeClass(player.overall)
                    : activeDisplayMetric.badgeClass;

                return (
                  <div
                    key={player.id}
                    className={cn(
                      'flex items-center gap-3 rounded-[22px] border border-cyan-400/20 bg-cyan-500/10 p-3 shadow-[0_18px_36px_rgba(8,145,178,0.14)]',
                      compact && 'gap-2 p-2',
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-14 w-14 items-center justify-center rounded-[18px] border border-cyan-400/25 bg-cyan-400/10 text-sm font-black uppercase tracking-[0.18em] text-cyan-100',
                        compact && 'h-9 w-9 text-[10px]',
                      )}
                    >
                      {getPlayerInitials(player.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate font-semibold text-white', compact && 'text-[11px] leading-tight')}>
                        {player.name}
                      </p>
                      <p className={cn('text-sm text-slate-400', compact && 'truncate text-[10px]')}>
                        {player.position} - {t('training.labels.overall')} {formatRatingLabel(player.overall)}
                      </p>
                      <div className={cn('mt-2 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-500', compact && 'mt-1 text-[9px]')}>
                        <span>{activeDisplayMetric.label}</span>
                        <span className="text-slate-300">{metricValue}</span>
                      </div>
                      <div className={cn('mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-950/80', compact && 'mt-1')}>
                        <div
                          className={cn('h-full rounded-full', activeDisplayMetric.barClass)}
                          style={{ width: `${metricValue}%` }}
                        />
                      </div>
                    </div>
                    <div
                      className={cn(
                        'flex h-11 min-w-[50px] items-center justify-center rounded-[16px] px-3 text-lg font-black',
                        compact && 'h-8 min-w-[36px] px-2 text-[11px]',
                        metricBadgeClass,
                      )}
                    >
                      {displayMetric === 'overall' ? formatRatingLabel(player.overall) : metricValue}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn('h-9 w-9 rounded-full text-slate-400 hover:bg-white/10 hover:text-white', compact && 'h-7 w-7')}
                      onClick={() => removeSelectedPlayer(player.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        ) : (
          <div className={cn('space-y-3', compact && 'space-y-2')}>
            {selectedPlayers.map(player => {
              const metricValue = getDisplayMetricValue(player, displayMetric);
              const metricBadgeClass =
                displayMetric === 'overall'
                  ? getOverallBadgeClass(player.overall)
                  : activeDisplayMetric.badgeClass;

              return (
                <div
                  key={player.id}
                  className={cn(
                    'flex items-center gap-3 rounded-[22px] border border-cyan-400/20 bg-cyan-500/10 p-3 shadow-[0_18px_36px_rgba(8,145,178,0.14)]',
                    compact && 'gap-2 p-2',
                  )}
                >
                  <div
                    className={cn(
                      'flex h-14 w-14 items-center justify-center rounded-[18px] border border-cyan-400/25 bg-cyan-400/10 text-sm font-black uppercase tracking-[0.18em] text-cyan-100',
                      compact && 'h-9 w-9 text-[10px]',
                    )}
                  >
                    {getPlayerInitials(player.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate font-semibold text-white', compact && 'text-[11px] leading-tight')}>
                      {player.name}
                    </p>
                    <p className={cn('text-sm text-slate-400', compact && 'truncate text-[10px]')}>
                      {player.position} - {t('training.labels.overall')} {formatRatingLabel(player.overall)}
                    </p>
                    <div className={cn('mt-2 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-500', compact && 'mt-1 text-[9px]')}>
                      <span>{activeDisplayMetric.label}</span>
                      <span className="text-slate-300">{metricValue}</span>
                    </div>
                    <div className={cn('mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-950/80', compact && 'mt-1')}>
                      <div
                        className={cn('h-full rounded-full', activeDisplayMetric.barClass)}
                        style={{ width: `${metricValue}%` }}
                      />
                    </div>
                  </div>
                  <div
                    className={cn(
                      'flex h-11 min-w-[50px] items-center justify-center rounded-[16px] px-3 text-lg font-black',
                      compact && 'h-8 min-w-[36px] px-2 text-[11px]',
                      metricBadgeClass,
                    )}
                  >
                    {displayMetric === 'overall' ? formatRatingLabel(player.overall) : metricValue}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn('h-9 w-9 rounded-full text-slate-400 hover:bg-white/10 hover:text-white', compact && 'h-7 w-7')}
                    onClick={() => removeSelectedPlayer(player.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
    );
  };

  const renderSelectedTrainingsPanel = (
    options?: {
      compact?: boolean;
      contentClassName?: string;
      scrollAreaClassName?: string;
      cardClassName?: string;
    },
  ) => {
    const compact = options?.compact ?? false;

    return (
    <Card
      ref={selectedTrainingsDropzoneRef}
      data-training-dropzone="training"
      onDragOver={event => handleDragOver(event, 'training')}
      onDrop={event => handleDrop(event, 'training')}
      className={cn(
        panelClass,
        'rounded-[28px] border border-dashed border-white/10 bg-[#040b1d]/70',
        (draggingType === 'training' ||
          (touchDragPayload?.type === 'training' && touchDropTarget === 'training')) &&
          'border-emerald-300/45 shadow-[0_0_0_1px_rgba(74,222,128,0.16),0_18px_40px_rgba(16,185,129,0.18)]',
        isTraining && 'opacity-70',
        options?.cardClassName,
      )}
    >
      <CardHeader
        className={cn(
          'space-y-3 p-4 pb-3 sm:space-y-4 sm:p-5 sm:pb-4',
          compact && 'space-y-2 p-3 pb-2 sm:space-y-2.5 sm:p-3.5 sm:pb-2.5',
        )}
      >
        <CardTitle className={sectionTitleClass}>
          <Dumbbell className="h-5 w-5 text-emerald-300" />
          {t('training.selectedTrainings', { count: selectedTrainings.length })}
        </CardTitle>
      </CardHeader>
      <CardContent
        className={cn(
          'min-h-[220px] p-4 pt-0',
          compact && 'min-h-[104px] p-3 pt-0 sm:min-h-[120px] sm:p-3.5 sm:pt-0',
          options?.contentClassName,
        )}
      >
        {selectedTrainings.length === 0 ? (
          <div
            className={cn(
              'flex min-h-[150px] items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-slate-950/60 px-4 text-center text-sm text-slate-400',
              compact && 'min-h-[60px] px-3 text-[11px] leading-snug sm:min-h-[72px]',
            )}
          >
            {t('training.empty.selectedTrainings')}
          </div>
        ) : options?.scrollAreaClassName ? (
          <ScrollArea className={options.scrollAreaClassName}>
            <div className={cn('space-y-3 pr-2', compact && 'space-y-2 pr-1')}>
              {selectedTrainings.map(training => {
                const accent = getTrainingAccent(training.type);
                return (
                  <div
                    key={training.id}
                    className={cn(
                      'flex items-center gap-3 rounded-[22px] border p-3 shadow-[0_18px_36px_rgba(0,0,0,0.14)]',
                      compact && 'gap-2 p-2',
                      accent.card,
                      accent.glow,
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-14 w-14 items-center justify-center rounded-[18px] border text-sm font-black uppercase tracking-[0.18em]',
                        compact && 'h-9 w-9 text-[10px]',
                        accent.badge,
                      )}
                    >
                      {getTrainingMonogram(training.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate font-semibold text-white', compact && 'text-[11px] leading-tight')}>
                        {training.name}
                      </p>
                      <p className={cn('text-sm text-slate-400', compact && 'truncate text-[10px]')}>
                        {getTrainingAttributeLabel(training.type)} - {t('common.minutesShort', { value: training.duration })}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn('h-9 w-9 rounded-full text-slate-400 hover:bg-white/10 hover:text-white', compact && 'h-7 w-7')}
                      onClick={() => removeSelectedTraining(training.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        ) : (
          <div className={cn('space-y-3', compact && 'space-y-2')}>
            {selectedTrainings.map(training => {
              const accent = getTrainingAccent(training.type);
              return (
                <div
                  key={training.id}
                  className={cn(
                    'flex items-center gap-3 rounded-[22px] border p-3 shadow-[0_18px_36px_rgba(0,0,0,0.14)]',
                    compact && 'gap-2 p-2',
                    accent.card,
                    accent.glow,
                  )}
                >
                  <div
                    className={cn(
                      'flex h-14 w-14 items-center justify-center rounded-[18px] border text-sm font-black uppercase tracking-[0.18em]',
                      compact && 'h-9 w-9 text-[10px]',
                      accent.badge,
                    )}
                  >
                    {getTrainingMonogram(training.type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate font-semibold text-white', compact && 'text-[11px] leading-tight')}>
                      {training.name}
                    </p>
                    <p className={cn('text-sm text-slate-400', compact && 'truncate text-[10px]')}>
                      {getTrainingAttributeLabel(training.type)} - {t('common.minutesShort', { value: training.duration })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn('h-9 w-9 rounded-full text-slate-400 hover:bg-white/10 hover:text-white', compact && 'h-7 w-7')}
                    onClick={() => removeSelectedTraining(training.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
    );
  };

  const renderTrainingControlPanel = (options?: { compact?: boolean; className?: string }) => {
    const compact = options?.compact ?? false;

    return (
    <Card className={cn(panelClass, 'min-h-0 flex flex-col', options?.className)}>
      <CardHeader className={cn('space-y-4 p-5 pb-4', compact && 'space-y-2.5 p-3.5 pb-2.5')}>
        <CardTitle className={sectionTitleClass}>
          <ClipboardList className="h-5 w-5 text-sky-300" />
          {t('training.control')}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn('space-y-4 p-5 pt-0', compact && 'flex min-h-0 flex-1 flex-col space-y-2 p-3 pt-0')}>
        {compact ? (
          <div className="grid grid-cols-4 gap-1.5">
            <div className="rounded-[14px] border border-white/8 bg-white/[0.04] px-2 py-1.5">
              <p className="text-[8px] uppercase tracking-[0.16em] text-slate-500">{t('training.labels.playerCount')}</p>
              <p className="mt-0.5 text-sm font-black text-white">{selectedPlayers.length}</p>
            </div>
            <div className="rounded-[14px] border border-white/8 bg-white/[0.04] px-2 py-1.5">
              <p className="text-[8px] uppercase tracking-[0.16em] text-slate-500">{t('training.labels.trainingCount')}</p>
              <p className="mt-0.5 text-sm font-black text-white">{selectedTrainings.length}</p>
            </div>
            <div className="rounded-[14px] border border-white/8 bg-white/[0.04] px-2 py-1.5">
              <p className="text-[8px] uppercase tracking-[0.16em] text-slate-500">{t('training.labels.totalCombination')}</p>
              <p className="mt-0.5 text-sm font-black text-white">{totalAssignments}</p>
            </div>
            <div className="rounded-[14px] border border-white/8 bg-white/[0.04] px-2 py-1.5">
              <p className="text-[8px] uppercase tracking-[0.16em] text-slate-500">{t('training.labels.expectedDuration')}</p>
              <p className="mt-0.5 text-sm font-black text-white">{formatMinutesShort(sessionDurationMinutes)}</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{t('training.labels.playerCount')}</p>
              <p className="mt-2 text-3xl font-black text-white">{selectedPlayers.length}</p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{t('training.labels.trainingCount')}</p>
              <p className="mt-2 text-3xl font-black text-white">{selectedTrainings.length}</p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{t('training.labels.totalCombination')}</p>
              <p className="mt-2 text-3xl font-black text-white">{totalAssignments}</p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{t('training.labels.expectedDuration')}</p>
              <p className="mt-2 text-3xl font-black text-white">{formatMinutesShort(sessionDurationMinutes)}</p>
            </div>
          </div>
        )}

        <div
          className={cn(
            'rounded-[26px] border p-5 shadow-[0_0_0_1px_rgba(16,185,129,0.08),0_18px_48px_rgba(16,185,129,0.14)]',
            compact && 'p-2',
            leadAccent.card,
            leadAccent.glow,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={cn('text-[11px] uppercase tracking-[0.24em] text-cyan-300', compact && 'text-[8px]')}>
                {isTraining ? t('training.labels.started') : t('training.control')}
              </p>
              <h3 className={cn('mt-2 text-2xl font-black text-white', compact && 'mt-1 text-[12px] leading-tight')}>
                {isTraining
                  ? `${formatTime(Math.max(timeLeft, 0))} / ${formatTime(activeDurationSeconds)}`
                  : canStart
                    ? t('training.labels.sessionReady')
                    : t('training.labels.sessionIdle')}
              </h3>
            </div>
            <div className={cn('rounded-[18px] border border-white/10 bg-slate-950/70 px-4 py-3 text-right', compact && 'px-2 py-1')}>
              <p className={cn('text-[11px] uppercase tracking-[0.22em] text-slate-500', compact && 'text-[8px]')}>{t('training.labels.duration')}</p>
              <p className={cn('mt-1 text-2xl font-black text-white', compact && 'mt-0.5 text-[11px]')}>
                {isTraining ? formatTime(timeLeft) : `${formatMinutesShort(sessionDurationMinutes)}`}
              </p>
            </div>
          </div>
          <div className={cn('mt-5 h-4 overflow-hidden rounded-full bg-slate-950/80', compact && 'mt-1.5 h-1.5')}>
            <div
              className={cn('h-full rounded-full bg-gradient-to-r', leadAccent.progress)}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {compact ? (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[9px]">
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-950/70 px-2 py-1 text-slate-300">
                <Clock className="h-3 w-3" />
                {isTraining ? formatTime(timeLeft) : formatMinutesShort(sessionDurationMinutes)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-950/70 px-2 py-1 text-slate-300">
                <Diamond className="h-3 w-3" />
                {diamondCost}
              </span>
              {isTraining && (
                <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-950/70 px-2 py-1 text-slate-300">
                  <Diamond className="h-3 w-3" />
                  {finishDiamondCost}
                </span>
              )}
              {diamondCost === 0 && (
                <span className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-emerald-200">
                  {t('training.labels.freeCombo')}
                </span>
              )}
            </div>
          ) : (
            <div className={cn('mt-5 space-y-3 text-sm')}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-slate-400">
                  <Clock className="h-4 w-4" />
                  <span>{t('training.labels.duration')}</span>
                </div>
                <span className="font-semibold text-white">
                  {isTraining ? formatTime(timeLeft) : formatMinutesLong(sessionDurationMinutes)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-slate-400">
                  <Diamond className="h-4 w-4" />
                  <span>{t('training.labels.diamondCost')}</span>
                </div>
                <span className="font-semibold text-white">{diamondCost}</span>
              </div>
              {isTraining && (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-slate-400">
                    <Diamond className="h-4 w-4" />
                    <span>{t('training.labels.earlyFinishCost')}</span>
                  </div>
                  <span className="font-semibold text-white">{finishDiamondCost}</span>
                </div>
              )}
              {diamondCost === 0 && (
                <p className="pt-2 text-xs text-slate-400">
                  {t('training.labels.freeCombo')}
                </p>
              )}
            </div>
          )}
        </div>

        {!isTraining ? (
          <Button
            onClick={handleStartTraining}
            disabled={!canStart}
            className={cn(
              'h-14 w-full rounded-[22px] border border-cyan-300/20 bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400 text-base font-black uppercase tracking-[0.14em] text-slate-950 shadow-[0_18px_42px_rgba(34,211,238,0.28)] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-900 disabled:text-slate-500',
              compact && 'mt-auto h-9 text-[10px]',
            )}
          >
            {t('training.actions.start')}
          </Button>
        ) : (
          <div className={cn('space-y-3', compact && 'mt-auto space-y-2')}>
            {timeLeft > 0 && (
              <>
                <Button
                  onClick={handleFinishWithDiamonds}
                  variant="outline"
                  className={cn('h-12 w-full rounded-[18px] border border-amber-400/25 bg-amber-500/10 text-amber-100 hover:bg-amber-500/16', compact && 'h-9 text-[11px]')}
                  disabled={isFinishingWithDiamonds}
                >
                  <Diamond className="mr-2 h-4 w-4" />
                  {t('training.actions.finishWithDiamonds', { cost: finishDiamondCost })}
                </Button>
                <Button
                  onClick={handleWatchAd}
                  variant="secondary"
                  className={cn('h-14 w-full rounded-[22px] border border-fuchsia-300/30 bg-gradient-to-r from-fuchsia-500 via-violet-500 to-purple-500 text-base font-black text-white shadow-[0_18px_45px_rgba(168,85,247,0.32)] hover:brightness-110 disabled:opacity-60', compact && 'h-10 text-[11px]')}
                  disabled={isWatchingAd}
                >
                  <Clapperboard className="mr-2 h-5 w-5" />
                  {isWatchingAd ? t('training.actions.loadingAd') : t('training.actions.finishWithAd')}
                </Button>
              </>
            )}
            <p className={cn('text-center text-xs text-slate-400', compact && 'text-[10px]')}>
              {t('training.labels.lockedHint')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
    );
  };

  const renderSelectionAndControlColumn = (
    options?: {
      className?: string;
      selectionGridClassName?: string;
      compactSelected?: boolean;
      compactControl?: boolean;
      selectedPanelContentClassName?: string;
      selectedPanelScrollAreaClassName?: string;
      controlPanelClassName?: string;
    },
  ) => (
    <div className={cn('min-h-0 flex flex-col gap-3', options?.className)}>
      <div className={cn('grid gap-3 md:grid-cols-2', options?.selectionGridClassName)}>
        {renderSelectedPlayersPanel({
          compact: options?.compactSelected,
          contentClassName: options?.selectedPanelContentClassName,
          scrollAreaClassName: options?.selectedPanelScrollAreaClassName,
        })}
        {renderSelectedTrainingsPanel({
          compact: options?.compactSelected,
          contentClassName: options?.selectedPanelContentClassName,
          scrollAreaClassName: options?.selectedPanelScrollAreaClassName,
        })}
      </div>
      {renderTrainingControlPanel({ compact: options?.compactControl, className: options?.controlPanelClassName })}
    </div>
  );

  const renderCompactSelectionCard = (
    kind: 'players' | 'trainings',
  ) => {
    const isPlayerCard = kind === 'players';
    const dropType: 'player' | 'training' = isPlayerCard ? 'player' : 'training';
    const items = isPlayerCard ? selectedPlayers : selectedTrainings;
    const title = isPlayerCard ? 'Secili Oyuncu' : 'Secili Antrenman';
    const accentClass = isPlayerCard
      ? 'border-cyan-400/14 bg-cyan-500/[0.06]'
      : 'border-emerald-400/14 bg-emerald-500/[0.06]';
    const emptyText = isPlayerCard
      ? t('training.empty.selectedPlayers')
      : t('training.empty.selectedTrainings');

    return (
      <Card
        ref={isPlayerCard ? selectedPlayersDropzoneRef : selectedTrainingsDropzoneRef}
        data-training-dropzone={dropType}
        onDragOver={event => handleDragOver(event, dropType)}
        onDrop={event => handleDrop(event, dropType)}
        className={cn(
          panelClass,
          'h-[132px] rounded-[20px] border border-dashed border-white/10 bg-[#040b1d]/70',
          (draggingType === dropType ||
            (touchDragPayload?.type === dropType && touchDropTarget === dropType)) &&
            (isPlayerCard
              ? 'border-cyan-300/45 shadow-[0_0_0_1px_rgba(34,211,238,0.16),0_18px_40px_rgba(34,211,238,0.18)]'
              : 'border-emerald-300/45 shadow-[0_0_0_1px_rgba(74,222,128,0.16),0_18px_40px_rgba(16,185,129,0.18)]'),
        )}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 pb-1">
          <CardTitle className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-100">
            {title}
          </CardTitle>
          <span className="rounded-full border border-white/10 bg-slate-950/80 px-2 py-0.5 text-[9px] font-semibold text-slate-200">
            {items.length}
          </span>
        </CardHeader>
        <CardContent className="flex h-[94px] flex-col gap-1 p-2 pt-0">
          {items.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-[14px] border border-dashed border-white/10 bg-slate-950/60 px-2 text-center text-[9px] leading-snug text-slate-400">
              {emptyText}
            </div>
          ) : (
            <ScrollArea className="h-full pr-1">
              <div className="space-y-1.5">
                {items.map(item => (
                  <div
                    key={item.id}
                    className={cn('rounded-[12px] border px-2 py-1.5 text-[9px] shadow-[0_12px_24px_rgba(0,0,0,0.18)]', accentClass)}
                  >
                    <p className="truncate font-semibold text-white">{item.name}</p>
                    <p className="mt-0.5 truncate text-[9px] text-slate-400">
                      {isPlayerCard
                        ? `${(item as Player).position} · ${t('training.labels.overall')} ${formatRatingLabel((item as Player).overall)}`
                        : `${t('common.minutesShort', { value: (item as Training).duration })} · ${getTrainingAttributeLabel((item as Training).type)}`}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderCompactTrainingControlPanel = () => (
    <Card className={cn(panelClass, 'h-[94px] rounded-[20px]')}>
      <CardHeader className="space-y-1 p-2 pb-1">
        <CardTitle className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-100">
          <ClipboardList className="h-4 w-4 text-sky-300" />
          {t('training.control')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex h-[58px] flex-col gap-1 p-2 pt-0">
        <div className="flex items-center justify-between rounded-[12px] border border-white/10 bg-slate-950/70 px-2 py-1 text-[8px] text-slate-300">
          <span className="uppercase tracking-[0.08em] text-slate-400">
            {isTraining ? t('training.labels.started') : canStart ? t('training.labels.sessionReady') : t('training.labels.sessionIdle')}
          </span>
          <span className="font-semibold text-white">
            {isTraining ? formatTime(timeLeft) : formatMinutesShort(sessionDurationMinutes)}
          </span>
        </div>
        {!isTraining ? (
          <Button
            onClick={handleStartTraining}
            disabled={!canStart}
            className="h-8 w-full rounded-[14px] border border-cyan-300/20 bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400 text-[9px] font-black uppercase tracking-[0.08em] text-slate-950 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-900 disabled:text-slate-500"
          >
            {t('training.actions.start')}
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={handleFinishWithDiamonds}
              variant="outline"
              className="h-8 rounded-[12px] border border-amber-400/25 bg-amber-500/10 px-2 text-[8px] text-amber-100 hover:bg-amber-500/16"
              disabled={isFinishingWithDiamonds}
            >
              <Diamond className="mr-1.5 h-3.5 w-3.5" />
              {finishDiamondCost}
            </Button>
            <Button
              onClick={handleWatchAd}
              variant="secondary"
              className="h-8 rounded-[12px] border border-fuchsia-300/30 bg-gradient-to-r from-fuchsia-500 via-violet-500 to-purple-500 px-2 text-[8px] font-black text-white shadow-[0_16px_30px_rgba(168,85,247,0.24)] hover:brightness-110 disabled:opacity-60"
              disabled={isWatchingAd}
            >
              <Clapperboard className="mr-1.5 h-3.5 w-3.5" />
              {isWatchingAd ? t('training.actions.loadingAd') : t('training.actions.finishWithAd')}
            </Button>
          </div>
        )}
        <div className="hidden flex-wrap items-center gap-1 text-[9px] text-slate-400">
          <span className="rounded-full border border-white/10 bg-slate-950/70 px-2 py-1">
            {selectedPlayers.length} Oyuncu
          </span>
          <span className="rounded-full border border-white/10 bg-slate-950/70 px-2 py-1">
            {selectedTrainings.length} Antrenman
          </span>
          <span className="rounded-full border border-white/10 bg-slate-950/70 px-2 py-1">
            {totalAssignments} Komb.
          </span>
        </div>
      </CardContent>
    </Card>
  );

  const renderLibraryViewSwitcher = (compact = false) => (
    <div
      className={cn(
        'grid w-full grid-cols-2 rounded-[20px] border border-white/10 bg-[#030b1b]/80 p-1',
        compact ? 'gap-1' : 'gap-1.5 rounded-[22px] p-1.5',
      )}
    >
      <button
        type="button"
        onClick={() => setMobileLibraryView('players')}
        className={cn(
          'rounded-[16px] font-semibold transition',
          compact ? 'py-2 text-xs' : 'py-3 text-sm',
          mobileLibraryView === 'players'
            ? 'bg-cyan-500/12 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.18)]'
            : 'text-slate-400 hover:text-slate-200',
        )}
      >
        {t('training.players')}
      </button>
      <button
        type="button"
        onClick={() => setMobileLibraryView('trainings')}
        className={cn(
          'rounded-[16px] font-semibold transition',
          compact ? 'py-2 text-xs' : 'py-3 text-sm',
          mobileLibraryView === 'trainings'
            ? 'bg-emerald-500/12 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(74,222,128,0.18)]'
            : 'text-slate-400 hover:text-slate-200',
        )}
      >
        {t('training.trainings')}
      </button>
    </div>
  );

  const renderMobileLibraryPanel = (options?: {
    compact?: boolean;
    playersHeightClass?: string;
    trainingsHeightClass?: string;
  }) => {
    const compact = options?.compact ?? false;

    return (
      <div className={cn('flex min-h-0 flex-col', compact ? 'gap-2' : 'gap-3')}>
        {renderLibraryViewSwitcher(compact)}
        {mobileLibraryView === 'players'
          ? renderPlayersPanel(options?.playersHeightClass)
          : renderTrainingsPanel(options?.trainingsHeightClass)}
      </div>
    );
  };

  return (
    <div className="relative flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#020617] text-slate-100">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.14),transparent_26%),radial-gradient(circle_at_bottom,rgba(16,185,129,0.14),transparent_30%),linear-gradient(180deg,rgba(2,6,23,0.96),rgba(2,6,23,1))]" />
      {touchDragPayload && touchDragPoint && touchDragMovedRef.current ? (
        <div
          className="pointer-events-none fixed z-[120] -translate-x-1/2 -translate-y-1/2"
          style={{ left: touchDragPoint.x, top: touchDragPoint.y }}
        >
          <div
            className={cn(
              'rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] shadow-[0_18px_36px_rgba(0,0,0,0.34)] backdrop-blur-xl',
              touchDragPayload.type === 'player'
                ? 'border-cyan-300/35 bg-cyan-400/20 text-cyan-50'
                : 'border-emerald-300/35 bg-emerald-400/20 text-emerald-50',
            )}
          >
            {touchDragPayload.type === 'player' ? t('training.players') : t('training.trainings')}
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          'relative z-20 shrink-0 border-b border-cyan-400/10 bg-[#030712]/90 shadow-[0_24px_60px_rgba(0,0,0,0.52)] backdrop-blur-2xl',
          isCompactLandscape ? 'px-1 py-1' : 'px-2.5 py-2.5 sm:px-4 sm:py-3',
        )}
      >
        <div
          className={cn(
            'mx-auto flex max-w-[1600px] flex-col',
            isCompactLandscape ? 'gap-1' : 'gap-2.5 lg:flex-row lg:items-center lg:justify-between',
          )}
        >
            <div className={cn('flex items-center gap-3', isCompactLandscape && 'gap-1')}>
            <BackButton
              className={cn(
                'rounded-2xl border border-white/10 bg-slate-950/80 text-slate-100 hover:border-cyan-300/35 hover:bg-slate-900/90',
                isCompactLandscape ? 'h-7 w-7 rounded-[14px]' : 'h-10 w-10 sm:h-11 sm:w-11',
              )}
            />
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-300">{t('training.hubLabel')}</p>
              <h1 className={cn('font-black uppercase tracking-[0.08em] text-white', isCompactLandscape ? 'text-[15px] leading-none' : 'text-xl sm:text-2xl')}>{t('training.title')}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Button variant="secondary" size="sm" className={cn('shrink-0 rounded-2xl border border-white/10 bg-slate-950/80 font-semibold uppercase text-slate-100 transition hover:border-cyan-300/35 hover:bg-slate-900/90 disabled:opacity-40', isCompactLandscape ? 'h-7 px-2 text-[9px] tracking-[0.1em]' : 'h-10 px-3 text-[11px] tracking-[0.16em] sm:h-11 sm:px-4 sm:text-xs sm:tracking-[0.22em]')} disabled={isTraining || squadRoleSelections.starters.length === 0} onClick={() => handleSquadSelection('starters')}>{t('training.squadFilters.starters')}</Button>
            <Button variant="secondary" size="sm" className={cn('shrink-0 rounded-2xl border border-white/10 bg-slate-950/80 font-semibold uppercase text-slate-100 transition hover:border-cyan-300/35 hover:bg-slate-900/90 disabled:opacity-40', isCompactLandscape ? 'h-7 px-2 text-[9px] tracking-[0.1em]' : 'h-10 px-3 text-[11px] tracking-[0.16em] sm:h-11 sm:px-4 sm:text-xs sm:tracking-[0.22em]')} disabled={isTraining || squadRoleSelections.bench.length === 0} onClick={() => handleSquadSelection('bench')}>{t('training.squadFilters.bench')}</Button>
            <Button variant="secondary" size="sm" className={cn('shrink-0 rounded-2xl border border-white/10 bg-slate-950/80 font-semibold uppercase text-slate-100 transition hover:border-cyan-300/35 hover:bg-slate-900/90 disabled:opacity-40', isCompactLandscape ? 'h-7 px-2 text-[9px] tracking-[0.1em]' : 'h-10 px-3 text-[11px] tracking-[0.16em] sm:h-11 sm:px-4 sm:text-xs sm:tracking-[0.22em]')} disabled={isTraining || squadRoleSelections.reserves.length === 0} onClick={() => handleSquadSelection('reserves')}>{t('training.squadFilters.reserves')}</Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className={cn('shrink-0 rounded-2xl border border-white/10 bg-slate-950/80 font-semibold text-slate-100 hover:border-cyan-300/35 hover:bg-slate-900/90', isCompactLandscape ? 'h-7 px-2 text-[9px]' : 'h-10 px-3 text-xs sm:h-11 sm:px-4 sm:text-sm')}>
                  <History className="mr-2 h-4 w-4" />
                  {t('training.squadFilters.history')}
                </Button>
              </SheetTrigger>
              <SheetContent className="flex h-full flex-col gap-4 border-l border-cyan-400/10 bg-[#020617]/98 px-5 py-5 text-slate-100 sm:max-w-lg">
                <SheetHeader className="space-y-2 text-left">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-300">{t('training.labels.results')}</p>
                  <SheetTitle className="text-left text-xl font-semibold text-white">{t('training.labels.historyTitle')}</SheetTitle>
                </SheetHeader>
                <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                  {t('training.labels.historyDescription')}
                </div>
                <div className="min-h-0 flex-1">
                  <ScrollArea className="h-full pr-2">
                    {visibleHistory.length === 0 ? (
                      <div className="flex min-h-[320px] items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-slate-950/60 px-4 text-center text-sm text-slate-400">{t('training.empty.noHistory')}</div>
                    ) : (
                      <div className="space-y-3">
                        {visibleHistory.map(record => {
                          const player = players.find(item => item.id === record.playerId);
                          const training = trainingCatalog.find(item => item.id === record.trainingId);
                          return (
                            <div key={record.id} className={cn('rounded-[22px] border p-4 text-sm shadow-[0_18px_40px_rgba(0,0,0,0.18)]', getTrainingHistoryCardClass(record.result))}>
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                  <p className="font-semibold text-white">{player?.name ?? t('training.empty.unknownPlayer')}</p>
                                  <p className="text-xs text-slate-400">{training?.name ?? t('training.empty.unknownTraining')}</p>
                                </div>
                                <span className="text-xs text-slate-400">{record.completedAt ? formatDate(record.completedAt.toDate(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  {record.gain > 0 ? (
                                    <span className="text-xs font-medium text-emerald-300">
                                      {training?.type
                                        ? t('training.labels.gain', {
                                            label: getTrainingAttributeLabel(training.type),
                                            value: (record.gain * 100).toFixed(1),
                                          })
                                        : t('training.labels.development', {
                                            value: (record.gain * 100).toFixed(1),
                                          })}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-slate-500">{t('training.empty.noGrowth')}</span>
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

      <div className={cn('relative z-10 min-h-0 flex-1', isCompactLandscape ? 'overflow-hidden' : 'overflow-auto')}>
        <div
          className={cn(
            'mx-auto flex h-full w-full max-w-[1600px] min-h-0 flex-col',
            isCompactLandscape ? 'gap-1 p-1' : 'gap-3 p-2.5 sm:p-4',
          )}
        >
          <div className={cn('w-full sm:max-w-[460px]', isCompactLandscape ? 'max-w-[240px]' : 'max-w-[400px]')}>
            <div className={cn('rounded-[24px] border border-white/10 bg-[#040b1d]/85', isCompactLandscape ? 'grid grid-cols-4 gap-1 p-1' : 'grid grid-cols-2 gap-1.5 p-1.5 md:grid-cols-4 md:gap-2 md:p-2')}>
              {DISPLAY_METRIC_OPTIONS.map(option => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setDisplayMetric(option.key)}
                  className={cn(
                    'min-w-0 rounded-[18px] border text-center font-semibold uppercase leading-tight whitespace-nowrap transition',
                    isCompactLandscape ? 'px-1 py-1.5 text-[8px] tracking-[0.06em]' : 'px-2.5 py-2 text-[10px] tracking-[0.12em] sm:text-[11px] sm:tracking-[0.14em]',
                    displayMetric === option.key ? option.activeClass : option.idleClass,
                  )}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          </div>
          <div
            className={cn(
              'grid min-h-0 w-full flex-1 pb-2',
              isCompactLandscape
                ? 'grid-cols-[minmax(0,0.98fr)_minmax(0,1.08fr)_minmax(0,1.1fr)] gap-2 overflow-hidden pb-0'
                : 'grid-cols-1 gap-3 lg:grid-cols-[320px_minmax(0,1.35fr)_340px] lg:overflow-visible xl:grid-cols-[340px_minmax(0,1.45fr)_360px]',
            )}
          >
            {isCompactLandscape ? (
              <>
                <div className="order-1 min-h-0 min-w-0">
                  {renderPlayersPanel('h-full w-full')}
                </div>
                <div className="order-2 min-h-0 min-w-0">
                  <div className="flex h-full min-h-0 flex-col gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      {renderCompactSelectionCard('players')}
                      {renderCompactSelectionCard('trainings')}
                    </div>
                    {renderCompactTrainingControlPanel()}
                  </div>
                </div>
                <div className="order-3 min-h-0 min-w-0">
                  {renderTrainingsPanel('h-full w-full')}
                </div>
              </>
            ) : (
              <>
                <div className="order-1 min-h-0 min-w-0 lg:hidden">
                  {renderSelectionAndControlColumn({
                    className: 'gap-2.5',
                    selectionGridClassName: 'grid-cols-2 gap-2',
                    compactSelected: true,
                    compactControl: true,
                    selectedPanelContentClassName: 'min-h-[96px] p-3 pt-0',
                    selectedPanelScrollAreaClassName: 'max-h-[104px]',
                  })}
                </div>

                <div className="order-2 min-h-0 lg:hidden">
                  {renderMobileLibraryPanel({
                    playersHeightClass: 'h-[52dvh] min-h-[320px] max-h-[460px]',
                    trainingsHeightClass: 'h-[52dvh] min-h-[320px] max-h-[460px]',
                  })}
                </div>

                <div className="order-1 hidden min-h-0 min-w-0 lg:block">
                  {renderPlayersPanel('h-full w-full')}
                </div>
                <div className="order-2 hidden min-h-0 min-w-0 lg:block">
                  {useTightLandscapeColumns ? (
                    <div className="flex h-full min-h-0 flex-col gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        {renderCompactSelectionCard('players')}
                        {renderCompactSelectionCard('trainings')}
                      </div>
                      {renderCompactTrainingControlPanel()}
                    </div>
                  ) : (
                    renderSelectionAndControlColumn()
                  )}
                </div>
                <div className="order-3 hidden min-h-0 min-w-0 lg:block">
                  {renderTrainingsPanel('h-full w-full')}
                </div>
              </>
            )}
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











