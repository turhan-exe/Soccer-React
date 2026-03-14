import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { BackButton } from '@/components/ui/back-button';
import { trainings } from '@/lib/data';
import { calculateSessionDurationMinutes } from '@/lib/trainingDuration';
import { runTrainingSimulation } from '@/lib/trainingSession';
import { cn } from '@/lib/utils';
import { Player, Training } from '@/types';
import { formatRatingLabel } from '@/lib/player';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { useTheme } from '@/contexts/ThemeContext';
import { getTeam, saveTeamPlayers } from '@/services/team';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PlayerStatusCard } from '@/components/ui/player-status-card';
import {
  addTrainingRecord,
  getTrainingHistory,
  ActiveTrainingSession,
  getActiveTraining,
  setActiveTraining,
  clearActiveTraining,
  TrainingHistoryRecord,
  TRAINING_FINISH_COST,
  finishTrainingWithDiamonds,
  markTrainingRecordsViewed,
  reduceTrainingTimeWithAd,
} from '@/services/training';
import {
  Clock,
  Diamond,
  Dumbbell,
  Search,
  Users,
  ClipboardList,
  X,
  Clapperboard,
  History,
} from 'lucide-react';
import { toast } from 'sonner';
import { useInventory } from '@/contexts/InventoryContext';

const EXTRA_ASSIGNMENT_DIAMOND_COST = 20;
const FINISH_COST_PER_ASSIGNMENT = 18;

interface ActiveBulkSession {
  players: Player[];
  trainings: Training[];
  durationSeconds: number;
  startedAt: Timestamp;
}

export default function TrainingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { balance, spend } = useDiamonds();
  const { vipDurationMultiplier } = useInventory();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<Player[]>([]);
  const [selectedTrainings, setSelectedTrainings] = useState<Training[]>([]);
  const [draggingType, setDraggingType] = useState<'player' | 'training' | null>(null);
  const [playerSearch, setPlayerSearch] = useState('');
  const [trainingSearch, setTrainingSearch] = useState('');
  const [isTraining, setIsTraining] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [activeSession, setActiveSessionState] = useState<ActiveBulkSession | null>(null);
  const [pendingActiveSession, setPendingActiveSession] = useState<ActiveTrainingSession | null>(null);
  const [history, setHistory] = useState<TrainingHistoryRecord[]>([]);
  const [filterPlayer, setFilterPlayer] = useState('all');
  const [filterTrainingType, setFilterTrainingType] = useState('all');
  const [filterResult, setFilterResult] = useState('all');
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

  const startCountdown = useCallback((initialSeconds: number) => {
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
  }, [triggerCompletion]);

  const setActiveSessionSafe = useCallback((session: ActiveBulkSession | null) => {
    activeSessionRef.current = session;
    setActiveSessionState(session);
  }, []);

  useEffect(() => {
    const fetchPlayers = async () => {
      if (!user) return;
      const team = await getTeam(user.id);
      setPlayers(team?.players || []);
      if (team) {
        const plan = (team.plan ?? team.lineup) as {
          starters?: string[];
          bench?: string[];
          subs?: string[];
          reserves?: string[];
        } | undefined;
        setSquadAssignments({
          starters:
            (plan?.starters && plan.starters.filter(Boolean)) ||
            team.players
              .filter(player => player.squadRole === 'starting')
              .map(player => player.id),
          bench:
            (plan?.bench && plan.bench.filter(Boolean)) ||
            (plan?.subs && plan.subs.filter(Boolean)) ||
            team.players
              .filter(player => player.squadRole === 'bench')
              .map(player => player.id),
          reserves:
            (plan?.reserves && plan.reserves.filter(Boolean)) ||
            team.players
              .filter(player => player.squadRole === 'reserve')
              .map(player => player.id),
        });
      }
    };

    fetchPlayers();
  }, [user]);

  useEffect(() => {
    const loadHistory = async () => {
      if (!user) return;
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
          } catch (err) {
            console.warn('Antrenman kayıtları görüldü olarak işaretlenemedi', err);
          }
        }

        setHistory(finalRecords);
      } catch (err) {
        console.warn('Antrenman geçmişi yüklenemedi', err);
      }
    };

    loadHistory();
  }, [user]);

  useEffect(() => {
    if (expandedPlayerId && !players.some(player => player.id === expandedPlayerId)) {
      setExpandedPlayerId(null);
      setPlayerDetail(null);
    }
  }, [players, expandedPlayerId]);

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
      if (!user) return;
      try {
        const session = await getActiveTraining(user.id);
        if (session) {
          setPendingActiveSession(session);
        }
      } catch (err) {
        console.warn('Aktif antrenman yüklenemedi', err);
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

    const { updatedPlayers: sessionUpdatedPlayers, records } = runTrainingSimulation(
      session.players,
      session.trainings,
    );

    const mergedPlayers = players.map(player => {
      const updated = sessionUpdatedPlayers.find(p => p.id === player.id);
      return updated ?? player;
    });

    setPlayers(mergedPlayers);

    if (user) {
      try {
        await saveTeamPlayers(user.id, mergedPlayers);
      } catch (err) {
        console.warn('Oyuncular kaydedilirken hata oluştu', err);
      }

      const createdRecords: TrainingHistoryRecord[] = [];
      const completionTime = Timestamp.now();

      for (const record of records) {
        try {
          const recordId = await addTrainingRecord(user.id, {
            ...record,
            completedAt: completionTime,
            viewed: true,
          });
          createdRecords.push({
            ...record,
            id: recordId,
            completedAt: completionTime,
            viewed: true,
          });
        } catch (err) {
          console.warn('Antrenman kaydı eklenemedi', err);
        }
      }

      try {
        await clearActiveTraining(user.id);
      } catch (err) {
        console.warn('Aktif antrenman temizlenemedi', err);
      }

      setHistory(prev => [...prev, ...createdRecords]);
    }
    setIsTraining(false);
    setTimeLeft(0);
    setActiveSessionSafe(null);
    setPendingActiveSession(null);
    setSelectedPlayers([]);
    setSelectedTrainings([]);
    toast.success(`Antrenman tamamlandı (${records.length} işlem)`);
  }, [players, setActiveSessionSafe, user]);

  useEffect(() => {
    completeSessionRef.current = completeSession;
  }, [completeSession]);

  useEffect(() => {
    if (!pendingActiveSession) return;

    const sessionPlayers = pendingActiveSession.playerIds
      .map(id => players.find(player => player.id === id))
      .filter((player): player is Player => Boolean(player));

    const sessionTrainings = pendingActiveSession.trainingIds
      .map(id => trainings.find(training => training.id === id))
      .filter((training): training is Training => Boolean(training));

    if (sessionPlayers.length === 0 || sessionTrainings.length === 0) {
      return;
    }

    if (sessionPlayers.length !== pendingActiveSession.playerIds.length) {
      console.warn('Eksik oyuncular bulundu, antrenman eksik verilerle devam edecek');
    }

    if (sessionTrainings.length !== pendingActiveSession.trainingIds.length) {
      console.warn('Eksik antrenman kartları bulundu, antrenman eksik verilerle devam edecek');
    }

    const { durationSeconds, startAt } = pendingActiveSession;
    const elapsedSeconds = Math.floor(
      (Date.now() - startAt.toDate().getTime()) / 1000,
    );
    const remaining = Math.max(durationSeconds - elapsedSeconds, 0);

    setSelectedPlayers(sessionPlayers);
    setSelectedTrainings(sessionTrainings);
    setActiveSessionSafe({
      players: sessionPlayers,
      trainings: sessionTrainings,
      durationSeconds,
      startedAt: startAt,
    });
    setIsTraining(true);

    startCountdown(remaining);

    setPendingActiveSession(null);
  }, [completeSession, pendingActiveSession, players, startCountdown, trainings]);

  const filteredPlayers = useMemo(() => {
    const query = playerSearch.toLowerCase();
    return players
      .filter(player =>
        player.name.toLowerCase().includes(query) ||
        player.position.toLowerCase().includes(query),
      )
      .sort((a, b) => b.overall - a.overall);
  }, [players, playerSearch]);

  const filteredTrainings = useMemo(() => {
    const query = trainingSearch.toLowerCase();
    return trainings.filter(training =>
      training.name.toLowerCase().includes(query) ||
      training.type.toLowerCase().includes(query),
    );
  }, [trainingSearch]);

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
    if (totalCombos <= 1) return 0;
    return (totalCombos - 1) * EXTRA_ASSIGNMENT_DIAMOND_COST;
  }, [selectedPlayers.length, selectedTrainings.length]);

  const totalAssignments = useMemo(
    () => selectedPlayers.length * selectedTrainings.length,
    [selectedPlayers.length, selectedTrainings.length],
  );

  const finishDiamondCost = useMemo(() => {
    const sessionPlayersCount = activeSession?.players.length ?? selectedPlayers.length;
    const sessionTrainingsCount = activeSession?.trainings.length ?? selectedTrainings.length;
    const totalCombos = sessionPlayersCount * sessionTrainingsCount;
    if (totalCombos === 0) return TRAINING_FINISH_COST;
    return TRAINING_FINISH_COST + Math.max(0, totalCombos - 1) * FINISH_COST_PER_ASSIGNMENT;
  }, [activeSession, selectedPlayers.length, selectedTrainings.length]);

  const formatTime = (seconds: number) => {
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
    if (isTraining) return;
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
    if (isTraining) return;
    if (draggingType === type) {
      event.preventDefault();
    }
  };

  const handleDrop = (
    event: React.DragEvent<HTMLDivElement>,
    type: 'player' | 'training',
  ) => {
    if (isTraining) return;
    event.preventDefault();
    setDraggingType(null);

    const raw =
      event.dataTransfer.getData('application/json') ||
      event.dataTransfer.getData('text/plain');

    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as { type: 'player' | 'training'; id: string };
      if (parsed.type !== type) return;

      if (type === 'player') {
        const player = players.find(p => p.id === parsed.id);
        if (!player) return;
        setSelectedPlayers(prev =>
          prev.some(item => item.id === player.id) ? prev : [...prev, player],
        );
      } else {
        const training = trainings.find(t => t.id === parsed.id);
        if (!training) return;
        setSelectedTrainings(prev =>
          prev.some(item => item.id === training.id) ? prev : [...prev, training],
        );
      }
    } catch (err) {
      console.warn('Drag drop parse error', err);
    }
  };

  const removeSelectedPlayer = (id: string) => {
    if (isTraining) return;
    setSelectedPlayers(prev => prev.filter(player => player.id !== id));
  };

  const removeSelectedTraining = (id: string) => {
    if (isTraining) return;
    setSelectedTrainings(prev => prev.filter(training => training.id !== id));
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
      toast('Devam eden bir antrenman var');
      return;
    }

    if (diamondCost > 0) {
      if (balance < diamondCost) {
        toast.error('Yetersiz elmas bakiyesi');
        return;
      }

      try {
        await spend(diamondCost);
      } catch (err) {
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
    } catch (err) {
      console.warn('Aktif antrenman kaydedilemedi', err);
      toast.error('Antrenman başlatılamadı');
      return;
    }

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

    const cost = finishDiamondCost;
    if (balance < cost) {
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
      await finishTrainingWithDiamonds(user.id, cost);
      await completeSession();
    } catch (err) {
      console.warn('Antrenman elmasla tamamlanamadı', err);
      toast.error('Elmasla bitirme başarısız');
      if (isTraining && remainingBeforeFinish > 0) {
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

    const remainingBeforeAd = timeLeft;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setIsWatchingAd(true);
    try {
      const session = await reduceTrainingTimeWithAd(user.id);
      setActiveSessionState(prev => {
        const next = prev ? { ...prev, durationSeconds: session.durationSeconds } : prev;
        activeSessionRef.current = next;
        return next;
      });

      const startAtDate = activeSession.startedAt.toDate();
      const elapsedSeconds = Math.max(
        0,
        Math.floor((Date.now() - startAtDate.getTime()) / 1000),
      );
      const newRemaining = Math.max(session.durationSeconds - elapsedSeconds, 0);

      if (newRemaining <= 0) {
        setTimeLeft(0);
        toast.success('Antrenman tamamlandı');
        await completeSession();
      } else {
        startCountdown(newRemaining);
        toast.success('Antrenman tamamlandı');
      }
    } catch (err) {
      console.warn('Antrenman reklamla hızlandırılamadı', err);
      toast.error((err as Error).message || 'Reklam izleme başarısız');
      if (isTraining && remainingBeforeAd > 0) {
        startCountdown(remainingBeforeAd);
      }
    } finally {
      setIsWatchingAd(false);
    }
  };

  useEffect(() => {
    if (isTraining && timeLeft <= 0) {
      triggerCompletion();
    }
  }, [isTraining, timeLeft, triggerCompletion]);

  const continueToMatch = () => {
    navigate('/match-preview');
  };

  const filteredHistory = history.filter(h =>
    (filterPlayer === 'all' || h.playerId === filterPlayer) &&
    (filterTrainingType === 'all' || h.trainingId === filterTrainingType) &&
    (filterResult === 'all' || h.result === filterResult),
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

    const fallback = {
      starters: players.filter(player => player.squadRole === 'starting'),
      bench: players.filter(player => player.squadRole === 'bench'),
      reserves: players.filter(player => player.squadRole === 'reserve'),
    };

    return {
      starters:
        squadAssignments.starters.length > 0
          ? resolveIds(squadAssignments.starters)
          : fallback.starters,
      bench:
        squadAssignments.bench.length > 0
          ? resolveIds(squadAssignments.bench)
          : fallback.bench,
      reserves:
        squadAssignments.reserves.length > 0
          ? resolveIds(squadAssignments.reserves)
          : fallback.reserves,
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

  const shellClass = isDark
    ? 'relative flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100'
    : 'relative flex h-screen flex-col overflow-hidden bg-[#eef6ff] text-slate-950';
  const headerClass = isDark
    ? 'border-b border-white/10 bg-slate-900/75 text-slate-100 backdrop-blur-xl shadow-[0_20px_50px_rgba(2,6,23,0.35)]'
    : 'border-b border-[#b8d8ec] bg-white/78 text-slate-950 backdrop-blur-xl shadow-[0_18px_40px_rgba(37,99,235,0.12)]';
  const toolbarButtonClass = isDark
    ? 'border-white/10 bg-white/5 text-slate-100 hover:bg-white/10'
    : 'border-[#c4dbee] bg-[#eef4fb] text-slate-800 hover:bg-white';
  const historyButtonClass = isDark
    ? 'border-white/10 bg-slate-950/60 text-slate-100 hover:bg-slate-900'
    : 'border-[#bfd6e8] bg-white/92 text-slate-800 hover:bg-white';
  const panelClass = isDark
    ? 'border border-white/10 bg-slate-900/72 text-slate-100 shadow-[0_18px_50px_rgba(2,6,23,0.28)] backdrop-blur-xl'
    : 'border border-[#b8d7ea] bg-white/84 text-slate-950 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl';
  const mutedTextClass = isDark ? 'text-slate-400' : 'text-slate-600';
  const searchInputClass = isDark
    ? 'border-white/10 bg-slate-950/60 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-400/30'
    : 'border-[#bfd6e8] bg-white/92 pl-9 text-slate-900 placeholder:text-slate-400 focus-visible:ring-[#0ea5a8]/30';
  const listItemClass = isDark
    ? 'cursor-pointer select-none border-white/10 bg-white/[0.03] transition hover:border-cyan-400/50 hover:bg-cyan-500/10'
    : 'cursor-pointer select-none border-[#c2daea] bg-white/92 transition hover:border-[#22a3c4] hover:bg-[#effbff]';
  const listItemDisabledClass = isDark ? 'pointer-events-none opacity-50' : 'pointer-events-none opacity-60';
  const listItemExpandedClass = isDark
    ? 'border-cyan-400/60 ring-2 ring-cyan-400/20'
    : 'border-[#0ea5a8] ring-2 ring-[#0ea5a8]/15 bg-[#f0fdfa]';
  const dropZoneClass = isDark
    ? 'border-2 border-dashed border-white/10 bg-slate-900/62'
    : 'border-2 border-dashed border-[#c7dcec] bg-white/86';
  const selectedPlayerClass = isDark
    ? 'border border-cyan-400/20 bg-cyan-500/10'
    : 'border border-[#b8dcec] bg-[#f3fbff]';
  const selectedTrainingClass = isDark
    ? 'border border-emerald-400/20 bg-emerald-500/10'
    : 'border border-[#bde4d7] bg-[#f0fdf7]';
  const metricCardClass = isDark
    ? 'rounded-xl border border-white/8 bg-white/[0.04] p-3'
    : 'rounded-xl border border-[#c9ddeb] bg-[#f8fbff] p-3';
  const summaryCardClass = isDark
    ? 'border border-white/10 bg-gradient-to-r from-cyan-500/10 via-slate-900/80 to-emerald-500/10'
    : 'border border-[#b8d7ea] bg-gradient-to-r from-white via-[#edf8ff] to-[#eefcf6]';
  const primaryButtonClass = isDark
    ? 'h-12 w-full border border-cyan-400/30 bg-gradient-to-r from-cyan-500 to-emerald-500 font-semibold text-slate-950 shadow-[0_14px_30px_rgba(16,185,129,0.18)] hover:from-cyan-400 hover:to-emerald-400 disabled:border-white/10 disabled:bg-slate-900 disabled:text-slate-500'
    : 'h-12 w-full border border-[#22a3c4]/30 bg-gradient-to-r from-[#0ea5a8] to-[#2563eb] font-semibold text-white shadow-[0_14px_30px_rgba(37,99,235,0.16)] hover:from-[#0891b2] hover:to-[#1d4ed8] disabled:border-[#d5e2ec] disabled:bg-[#e8eef5] disabled:text-slate-400';
  const secondaryActionClass = isDark
    ? 'w-full border-white/10 bg-slate-950/70 text-slate-100 hover:bg-slate-900'
    : 'w-full border-[#bfd6e8] bg-white/92 text-slate-800 hover:bg-white';
  const trainingCardClass = isDark
    ? 'cursor-grab select-none border-white/10 bg-white/[0.03] transition hover:border-emerald-400/50 hover:bg-emerald-500/10'
    : 'cursor-grab select-none border-[#c2daea] bg-white/92 transition hover:border-[#10b981] hover:bg-[#effcf6]';
  const trainingCardDisabledClass = isDark ? 'pointer-events-none opacity-50' : 'pointer-events-none opacity-60';
  const sheetContentClass = isDark
    ? 'flex flex-col gap-4 border-l border-white/10 bg-slate-950/96 text-slate-100 sm:max-w-md'
    : 'flex flex-col gap-4 border-l border-[#c6dceb] bg-[#f7fbff] text-slate-950 sm:max-w-md';

  return (
    <div className={shellClass}>
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0',
          isDark
            ? 'bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.14),_transparent_24%),radial-gradient(circle_at_right,_rgba(59,130,246,0.16),_transparent_24%),linear-gradient(135deg,rgba(15,23,42,0.2),rgba(2,6,23,0))]'
            : 'bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.14),_transparent_26%),radial-gradient(circle_at_right,_rgba(16,185,129,0.12),_transparent_24%),linear-gradient(135deg,rgba(255,255,255,0.55),rgba(255,255,255,0))]',
        )}
      />
      <div className={cn('relative shrink-0 p-2', headerClass)}>
        <div className="flex flex-wrap items-center justify-between gap-y-2">
          <div className="flex items-center gap-3">
            <BackButton />
            <h1 className="text-xl font-bold">Antrenman Merkezi</h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                className={toolbarButtonClass}
                disabled={isTraining || squadRoleSelections.starters.length === 0}
                onClick={() => handleSquadSelection('starters')}
              >
                İlk 11
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className={toolbarButtonClass}
                disabled={isTraining || squadRoleSelections.bench.length === 0}
                onClick={() => handleSquadSelection('bench')}
              >
                Yedekler
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className={toolbarButtonClass}
                disabled={isTraining || squadRoleSelections.reserves.length === 0}
                onClick={() => handleSquadSelection('reserves')}
              >
                Kadro Dışı
              </Button>
            </div>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className={cn('gap-2', historyButtonClass)}>
                  <History className="h-4 w-4" />
                  Geçmiş
                </Button>
              </SheetTrigger>
              <SheetContent className={sheetContentClass}>
                <SheetHeader>
                  <SheetTitle>Antrenman Geçmişi</SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto pr-2">
                  {filteredHistory.length === 0 ? (
                    <p className={cn('py-8 text-center', mutedTextClass)}>
                      Henüz antrenman kaydı bulunmuyor.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {filteredHistory.map((record) => {
                        const player = players.find(p => p.id === record.playerId);
                        const training = trainings.find(t => t.id === record.trainingId);

                        return (
                          <div
                            key={record.id}
                            className={cn(
                              "rounded-lg border p-3 text-sm shadow-sm transition-colors",
                              record.result === 'success'
                                ? isDark
                                  ? "bg-emerald-500/10 border-emerald-400/20"
                                  : "bg-emerald-50 border-emerald-100"
                                : record.result === 'fail'
                                  ? isDark
                                    ? "bg-red-500/10 border-red-400/20"
                                    : "bg-red-50 border-red-100"
                                  : isDark
                                    ? "bg-amber-500/10 border-amber-400/20"
                                    : "bg-amber-50 border-amber-100"
                            )}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-semibold">{player?.name || 'Bilinmeyen Oyuncu'}</span>
                              <span className={cn('text-xs', mutedTextClass)}>
                                {record.completedAt?.toDate().toLocaleDateString('tr-TR', {
                                  day: 'numeric',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex flex-col">
                                <span className={cn('truncate', mutedTextClass)}>
                                  {training?.name || 'Bilinmeyen Antrenman'}
                                </span>
                                {record.gain > 0 && (
                                  <span className={cn('text-xs font-medium', isDark ? 'text-emerald-300' : 'text-emerald-700')}>
                                    {training?.type ? (
                                      <>
                                        {training.type.charAt(0).toUpperCase() + training.type.slice(1)}: +{(record.gain * 100).toFixed(1)}
                                      </>
                                    ) : (
                                      `Gelişim: +${(record.gain * 100).toFixed(1)}`
                                    )}
                                  </span>
                                )}
                              </div>
                              <span className={cn(
                                "text-xs px-2 py-0.5 rounded-full font-medium min-w-[60px] text-center",
                                record.result === 'success'
                                  ? isDark
                                    ? "bg-emerald-500/15 text-emerald-300"
                                    : "bg-emerald-100 text-emerald-700"
                                  : record.result === 'fail'
                                    ? isDark
                                      ? "bg-red-500/15 text-red-300"
                                      : "bg-red-100 text-red-700"
                                    : isDark
                                      ? "bg-amber-500/15 text-amber-300"
                                      : "bg-amber-100 text-amber-700"
                              )}>
                                {record.result === 'success' ? 'Başarılı' : record.result === 'fail' ? 'Başarısız' : 'Normal'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto p-2">
        <div className="grid gap-2 grid-cols-[25%_50%_25%] relative">
          {/* Players list */}
          <div className="relative h-full">
            <Card className={cn('absolute inset-0 flex flex-col overflow-hidden', panelClass)}>
              <CardHeader className="space-y-3">
                <CardTitle className={cn('flex items-center gap-2 text-lg', isDark ? 'text-cyan-100' : 'text-slate-900')}>
                  <Users className="h-5 w-5" /> Oyuncular
                </CardTitle>
                <div className="relative">
                  <Search className={cn('absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2', mutedTextClass)} />
                  <Input
                    value={playerSearch}
                    onChange={event => setPlayerSearch(event.target.value)}
                    placeholder="Oyuncu ara"
                    className={searchInputClass}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3 flex-1 overflow-y-auto pr-2">
                {filteredPlayers.length === 0 && (
                  <p className={cn('text-sm', mutedTextClass)}>
                    Eşleşen oyuncu bulunamadı.
                  </p>
                )}
                {filteredPlayers.map(player => {
                  const isExpanded = expandedPlayerId === player.id;

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
                        if (isTraining) {
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
                        listItemClass,
                        isTraining && listItemDisabledClass,
                        isExpanded && listItemExpandedClass,
                      )}
                    >
                      <CardContent className="flex items-center justify-between gap-3 p-4">
                        <div>
                          <p className="font-semibold">{player.name}</p>
                          <p className={cn('text-xs', mutedTextClass)}>
                            {player.position} • Genel {formatRatingLabel(player.overall)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={cn('text-xs', mutedTextClass)}>Motivasyon</p>
                          <p className="font-semibold">{Math.round(player.motivation * 100)}%</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {/* Central control area */}
          <div className="flex flex-col gap-4">
            <div className="grid gap-2 grid-cols-2">
              <Card
                onDragOver={event => handleDragOver(event, 'player')}
                onDrop={event => handleDrop(event, 'player')}
                className={cn(
                  'min-h-[220px] transition',
                  dropZoneClass,
                  draggingType === 'player'
                    ? isDark
                      ? 'border-cyan-400 shadow-[0_18px_45px_rgba(34,211,238,0.14)]'
                      : 'border-[#0ea5a8] shadow-[0_18px_40px_rgba(14,165,168,0.14)]'
                    : '',
                  isTraining && 'opacity-70',
                )}
              >
                <CardHeader className="pb-2">
                  <CardTitle className={cn('flex items-center gap-2 text-base', isDark ? 'text-cyan-100' : 'text-slate-900')}>
                    <Users className="h-5 w-5" /> Seçilen Oyuncular
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {selectedPlayers.length === 0 && (
                    <p className={cn('text-sm', mutedTextClass)}>
                      Oyuncuları sürükleyip bırakın veya çift tıklayın.
                    </p>
                  )}
                  {selectedPlayers.map(player => (
                    <div
                      key={player.id}
                      className={cn('flex items-center justify-between rounded-md px-3 py-2 text-sm', selectedPlayerClass)}
                    >
                      <div>
                        <p className="font-medium">{player.name}</p>
                        <p className={cn('text-xs', mutedTextClass)}>
                          {player.position} • {formatRatingLabel(player.overall)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn('h-7 w-7', mutedTextClass)}
                        onClick={() => removeSelectedPlayer(player.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card
                onDragOver={event => handleDragOver(event, 'training')}
                onDrop={event => handleDrop(event, 'training')}
                className={cn(
                  'min-h-[220px] transition',
                  dropZoneClass,
                  draggingType === 'training'
                    ? isDark
                      ? 'border-emerald-400 shadow-[0_18px_45px_rgba(16,185,129,0.14)]'
                      : 'border-[#10b981] shadow-[0_18px_40px_rgba(16,185,129,0.14)]'
                    : '',
                  isTraining && 'opacity-70',
                )}
              >
                <CardHeader className="pb-2">
                  <CardTitle className={cn('flex items-center gap-2 text-base', isDark ? 'text-emerald-100' : 'text-slate-900')}>
                    <Dumbbell className="h-5 w-5" /> Seçilen Antrenmanlar
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {selectedTrainings.length === 0 && (
                    <p className={cn('text-sm', mutedTextClass)}>
                      Antrenman kartlarını bu alana bırakın.
                    </p>
                  )}
                  {selectedTrainings.map(training => (
                    <div
                      key={training.id}
                      className={cn('flex items-center justify-between rounded-md px-3 py-2 text-sm', selectedTrainingClass)}
                    >
                      <div>
                        <p className="font-medium">{training.name}</p>
                        <p className={cn('text-xs', mutedTextClass)}>
                          {training.type} • {training.duration} dk
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn('h-7 w-7', mutedTextClass)}
                        onClick={() => removeSelectedTraining(training.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card className={panelClass}>
              <CardHeader className="pb-2">
                <CardTitle className={cn('flex items-center gap-2 text-lg', isDark ? 'text-cyan-100' : 'text-slate-900')}>
                  <ClipboardList className="h-5 w-5" /> Antrenman Kontrolü
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className={metricCardClass}>
                    <p className={mutedTextClass}>Oyuncu Sayısı</p>
                    <p className="text-lg font-semibold">{selectedPlayers.length}</p>
                  </div>
                  <div className={metricCardClass}>
                    <p className={mutedTextClass}>Antrenman Sayısı</p>
                    <p className="text-lg font-semibold">{selectedTrainings.length}</p>
                  </div>
                  <div className={metricCardClass}>
                    <p className={mutedTextClass}>Toplam Kombinasyon</p>
                    <p className="text-lg font-semibold">{totalAssignments}</p>
                  </div>
                  <div className={metricCardClass}>
                    <p className={mutedTextClass}>Beklenen Süre</p>
                    <p className="text-lg font-semibold">
                      {sessionDurationMinutes} dk
                    </p>
                  </div>
                </div>

                <div className={cn('rounded-lg p-4 text-sm', summaryCardClass)}>
                  <div className="flex items-center justify-between">
                    <div className={cn('flex items-center gap-2', mutedTextClass)}>
                      <Clock className="h-4 w-4" />
                      <span>Süre</span>
                    </div>
                    <span className="font-semibold">
                      {isTraining ? formatTime(timeLeft) : `${sessionDurationMinutes} dakika`}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className={cn('flex items-center gap-2', mutedTextClass)}>
                      <Diamond className="h-4 w-4" />
                      <span>Elmas Maliyeti</span>
                    </div>
                    <span className="font-semibold">{diamondCost}</span>
                  </div>
                  {isTraining && (
                    <div className="mt-2 flex items-center justify-between">
                      <div className={cn('flex items-center gap-2', mutedTextClass)}>
                        <Diamond className="h-4 w-4" />
                        <span>Erken Bitirme Ücreti</span>
                      </div>
                      <span className="font-semibold">{finishDiamondCost}</span>
                    </div>
                  )}
                  {diamondCost === 0 && (
                    <p className={cn('mt-2 text-xs', mutedTextClass)}>
                      Bir oyuncu + bir antrenman kombinasyonu ücretsizdir.
                    </p>
                  )}
                </div>

                <Button
                  onClick={handleStartTraining}
                  disabled={!canStart}
                  className={primaryButtonClass}
                >
                  {isTraining ? formatTime(timeLeft) : 'Antrenmanı Başlat'}
                </Button>
                {isTraining && (
                  <div className="space-y-2">
                    {timeLeft > 0 && (
                      <>
                        <Button
                          onClick={handleFinishWithDiamonds}
                          variant="outline"
                          className={secondaryActionClass}
                          disabled={isFinishingWithDiamonds}
                        >
                          <Diamond className="mr-2 h-4 w-4" /> Elmasla Bitir ({finishDiamondCost})
                        </Button>
                        <Button
                          onClick={handleWatchAd}
                          variant="secondary"
                          className={secondaryActionClass}
                          disabled={isWatchingAd}
                        >
                          <Clapperboard className="mr-2 h-4 w-4" /> {isWatchingAd ? 'Video Yükleniyor...' : 'Reklam İzle (Hemen Bitir)'}
                        </Button>
                      </>
                    )}
                    <p className={cn('text-center text-xs', mutedTextClass)}>
                      Antrenman devam ederken seçimler kilitlenir.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Trainings list */}
          <div className="relative h-full">
            <Card className={cn('absolute inset-0 flex flex-col overflow-hidden', panelClass)}>
              <CardHeader className="space-y-3">
                <CardTitle className={cn('flex items-center gap-2 text-lg', isDark ? 'text-emerald-100' : 'text-slate-900')}>
                  <Dumbbell className="h-5 w-5" /> Antrenmanlar
                </CardTitle>
                <div className="relative">
                  <Search className={cn('absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2', mutedTextClass)} />
                  <Input
                    value={trainingSearch}
                    onChange={event => setTrainingSearch(event.target.value)}
                    placeholder="Antrenman ara"
                    className={searchInputClass}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3 flex-1 overflow-y-auto pr-2">
                {filteredTrainings.length === 0 && (
                  <p className={cn('text-sm', mutedTextClass)}>
                    Uygun antrenman bulunamadı.
                  </p>
                )}
                {filteredTrainings.map(training => (
                  <Card
                    key={training.id}
                    draggable={!isTraining}
                    onDragStart={event => handleDragStart(event, 'training', training.id)}
                    onDragEnd={handleDragEnd}
                    onDoubleClick={() => {
                      if (!isTraining) {
                        setSelectedTrainings(prev =>
                          prev.some(item => item.id === training.id)
                            ? prev
                            : [...prev, training],
                        );
                      }
                    }}
                    className={cn(
                      trainingCardClass,
                      isTraining && trainingCardDisabledClass,
                    )}
                  >
                    <CardContent className="flex items-center justify-between gap-3 p-4">
                      <div>
                        <p className="font-semibold">{training.name}</p>
                        <p className={cn('text-xs', mutedTextClass)}>
                          {training.description}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={cn('text-xs', mutedTextClass)}>Hedef</p>
                        <p className="font-semibold truncate max-w-[80px]" title={training.type}>{training.type}</p>
                        <p className={cn('mt-1 text-xs', mutedTextClass)}>{training.duration} dk</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog
        open={Boolean(playerDetail)}
        onOpenChange={open => {
          if (!open) {
            setPlayerDetail(null);
          }
        }}
      >
        <DialogContent className="max-w-md border-none bg-transparent p-0 shadow-none">
          {playerDetail ? <PlayerStatusCard player={playerDetail} /> : null}
        </DialogContent>
      </Dialog>
    </div >
  );
}
