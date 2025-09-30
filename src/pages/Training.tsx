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
import { calculateOverall } from '@/lib/player';
import { cn } from '@/lib/utils';
import { Player, Training } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { getTeam, saveTeamPlayers } from '@/services/team';
import {
  addTrainingRecord,
  getTrainingHistory,
  TrainingHistoryRecord,
} from '@/services/training';
import {
  Clock,
  Diamond,
  Dumbbell,
  Search,
  Users,
  ClipboardList,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

const BASE_SESSION_DURATION = 15;
const EXTRA_PLAYER_DURATION = 5;
const EXTRA_TRAINING_DURATION = 8;
const EXTRA_SLOT_DIAMOND_COST = 15;

interface ActiveBulkSession {
  players: Player[];
  trainings: Training[];
}

export default function TrainingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { balance, spend } = useDiamonds();

  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<Player[]>([]);
  const [selectedTrainings, setSelectedTrainings] = useState<Training[]>([]);
  const [draggingType, setDraggingType] = useState<'player' | 'training' | null>(null);
  const [playerSearch, setPlayerSearch] = useState('');
  const [trainingSearch, setTrainingSearch] = useState('');
  const [isTraining, setIsTraining] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [activeSession, setActiveSession] = useState<ActiveBulkSession | null>(null);
  const [history, setHistory] = useState<TrainingHistoryRecord[]>([]);
  const [filterPlayer, setFilterPlayer] = useState('all');
  const [filterTrainingType, setFilterTrainingType] = useState('all');
  const [filterResult, setFilterResult] = useState('all');

  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    const fetchPlayers = async () => {
      if (!user) return;
      const team = await getTeam(user.id);
      setPlayers(team?.players || []);
    };

    fetchPlayers();
  }, [user]);

  useEffect(() => {
    const loadHistory = async () => {
      if (!user) return;
      const records = await getTrainingHistory(user.id);
      setHistory(records);
    };

    loadHistory();
  }, [user]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

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

  const sessionDurationMinutes = useMemo(() => {
    const playersCount = selectedPlayers.length;
    const trainingsCount = selectedTrainings.length;
    if (playersCount === 0 || trainingsCount === 0) return 0;

    return (
      BASE_SESSION_DURATION +
      Math.max(0, playersCount - 1) * EXTRA_PLAYER_DURATION +
      Math.max(0, trainingsCount - 1) * EXTRA_TRAINING_DURATION
    );
  }, [selectedPlayers.length, selectedTrainings.length]);

  const diamondCost = useMemo(() => {
    const playersCount = selectedPlayers.length;
    const trainingsCount = selectedTrainings.length;
    if (playersCount === 0 || trainingsCount === 0) return 0;

    const extras = Math.max(0, playersCount - 1) + Math.max(0, trainingsCount - 1);
    return extras * EXTRA_SLOT_DIAMOND_COST;
  }, [selectedPlayers.length, selectedTrainings.length]);

  const totalAssignments = useMemo(
    () => selectedPlayers.length * selectedTrainings.length,
    [selectedPlayers.length, selectedTrainings.length],
  );

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

    setActiveSession({
      players: selectedPlayers,
      trainings: selectedTrainings,
    });
    setIsTraining(true);
    setTimeLeft(durationSeconds);

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    intervalRef.current = window.setInterval(() => {
      setTimeLeft(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    toast.success('Antrenman başlatıldı');
  };

  const completeSession = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!isTraining) {
      return;
    }

    if (!user || !activeSession) {
      setIsTraining(false);
      setTimeLeft(0);
      setActiveSession(null);
      return;
    }

    const updatedPlayers = [...players];
    const records: TrainingHistoryRecord[] = [];

    for (const sessionPlayer of activeSession.players) {
      const playerIndex = updatedPlayers.findIndex(p => p.id === sessionPlayer.id);
      if (playerIndex === -1) continue;

      let playerSnapshot = updatedPlayers[playerIndex];

      for (const training of activeSession.trainings) {
        const attributeKey = training.type;
        const currentValue = playerSnapshot.attributes[attributeKey];
        let gain = 0;
        let result: 'success' | 'average' | 'fail' = 'fail';

        if (currentValue < 1) {
          const improvement = 0.005 + Math.random() * 0.03;
          const successRoll = Math.random() * 100;

          if (successRoll > 75) {
            gain = improvement;
            result = 'success';
          } else if (successRoll > 45) {
            gain = improvement * 0.5;
            result = 'average';
          } else {
            result = 'fail';
          }

          if (gain > 0) {
            const newValue = Math.min(currentValue + gain, 1);
            const newAttributes = {
              ...playerSnapshot.attributes,
              [attributeKey]: newValue,
            };
            playerSnapshot = {
              ...playerSnapshot,
              attributes: newAttributes,
              overall: Math.min(
                calculateOverall(playerSnapshot.position, newAttributes),
                playerSnapshot.potential,
              ),
            };
          }
        } else {
          result = 'fail';
          gain = 0;
        }

        records.push({
          playerId: playerSnapshot.id,
          playerName: playerSnapshot.name,
          trainingId: training.id,
          trainingName: training.name,
          result,
          gain,
          completedAt: Timestamp.now(),
        });
      }

      updatedPlayers[playerIndex] = playerSnapshot;
    }

    setPlayers(updatedPlayers);

    if (user) {
      try {
        await saveTeamPlayers(user.id, updatedPlayers);
      } catch (err) {
        console.warn('Oyuncular kaydedilirken hata oluştu', err);
      }

      for (const record of records) {
        try {
          await addTrainingRecord(user.id, record);
        } catch (err) {
          console.warn('Antrenman kaydı eklenemedi', err);
        }
      }
    }

    setHistory(prev => [...prev, ...records]);
    setIsTraining(false);
    setTimeLeft(0);
    setActiveSession(null);
    setSelectedPlayers([]);
    setSelectedTrainings([]);
    toast.success('Antrenman tamamlandı');
  }, [activeSession, isTraining, players, user]);

  useEffect(() => {
    if (isTraining && timeLeft <= 0) {
      void completeSession();
    }
  }, [isTraining, timeLeft, completeSession]);

  const continueToMatch = () => {
    navigate('/match-preview');
  };

  const filteredHistory = history.filter(h =>
    (filterPlayer === 'all' || h.playerId === filterPlayer) &&
    (filterTrainingType === 'all' || h.trainingId === filterTrainingType) &&
    (filterResult === 'all' || h.result === filterResult),
  );

  const canStart = selectedPlayers.length > 0 && selectedTrainings.length > 0 && !isTraining;

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton />
            <h1 className="text-xl font-bold">Antrenman Merkezi</h1>
          </div>
          <div className="flex items-center gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Geçmiş</Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[350px] sm:w-[400px] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Geçmiş Antrenmanlar</SheetTitle>
                </SheetHeader>
                <div className="p-4 space-y-4">
                  <div className="space-y-2">
                    <Select value={filterPlayer} onValueChange={setFilterPlayer}>
                      <SelectTrigger>
                        <SelectValue placeholder="Oyuncu" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Tümü</SelectItem>
                        {players.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={filterTrainingType} onValueChange={setFilterTrainingType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Antrenman" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Tümü</SelectItem>
                        {trainings.map(t => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={filterResult} onValueChange={setFilterResult}>
                      <SelectTrigger>
                        <SelectValue placeholder="Durum" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Tümü</SelectItem>
                        <SelectItem value="success">Başarılı</SelectItem>
                        <SelectItem value="average">Ortalama</SelectItem>
                        <SelectItem value="fail">Başarısız</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto pr-2">
                    {filteredHistory.length === 0 && (
                      <p className="text-sm text-muted-foreground">Kayıt yok</p>
                    )}
                    {filteredHistory.map((rec, idx) => (
                      <div key={idx} className="border p-2 rounded">
                        <p className="font-semibold">{rec.playerName}</p>
                        <p className="text-sm">
                          {rec.trainingName} •
                          {rec.result === 'success'
                            ? ' Başarılı'
                            : rec.result === 'average'
                              ? ' Ortalama'
                              : ' Başarısız'}
                          {rec.gain > 0 && ` • +${(rec.gain * 100).toFixed(1)}%`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {rec.completedAt.toDate().toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
            <Button onClick={continueToMatch} variant="outline">
              Maç Önizleme →
            </Button>
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="grid gap-4 xl:grid-cols-[1fr_minmax(320px,1.1fr)_1fr]">
          {/* Players list */}
          <Card className="border-emerald-200/70 bg-white/70 dark:border-emerald-900/60 dark:bg-emerald-950/50">
            <CardHeader className="space-y-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5" /> Oyuncular
              </CardTitle>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={playerSearch}
                  onChange={event => setPlayerSearch(event.target.value)}
                  placeholder="Oyuncu ara"
                  className="pl-9"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[calc(100vh-260px)] overflow-y-auto pr-2">
              {filteredPlayers.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Eşleşen oyuncu bulunamadı.
                </p>
              )}
              {filteredPlayers.map(player => (
                <Card
                  key={player.id}
                  draggable={!isTraining}
                  onDragStart={event => handleDragStart(event, 'player', player.id)}
                  onDragEnd={handleDragEnd}
                  onDoubleClick={() => {
                    if (!isTraining) {
                      setSelectedPlayers(prev =>
                        prev.some(item => item.id === player.id) ? prev : [...prev, player],
                      );
                    }
                  }}
                  className={cn(
                    'cursor-grab select-none border-emerald-100 transition hover:border-emerald-300 dark:border-emerald-900/50 dark:hover:border-emerald-700',
                    isTraining && 'pointer-events-none opacity-60',
                  )}
                >
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <p className="font-semibold">{player.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {player.position} • Genel {Math.round(player.overall * 100)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Motivasyon</p>
                      <p className="font-semibold">{Math.round(player.motivation * 100)}%</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>

          {/* Central control area */}
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card
                onDragOver={event => handleDragOver(event, 'player')}
                onDrop={event => handleDrop(event, 'player')}
                className={cn(
                  'min-h-[220px] border-2 border-dashed bg-white/80 transition dark:bg-emerald-950/40',
                  draggingType === 'player'
                    ? 'border-emerald-400 shadow-lg'
                    : 'border-emerald-200/60 dark:border-emerald-900/50',
                  isTraining && 'opacity-70',
                )}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-5 w-5" /> Seçilen Oyuncular
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {selectedPlayers.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Oyuncuları sürükleyip bırakın veya çift tıklayın.
                    </p>
                  )}
                  {selectedPlayers.map(player => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between rounded-md border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-sm dark:border-emerald-900/60 dark:bg-emerald-900/40"
                    >
                      <div>
                        <p className="font-medium">{player.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {player.position} • {Math.round(player.overall * 100)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
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
                  'min-h-[220px] border-2 border-dashed bg-white/80 transition dark:bg-emerald-950/40',
                  draggingType === 'training'
                    ? 'border-teal-400 shadow-lg'
                    : 'border-teal-200/60 dark:border-emerald-900/50',
                  isTraining && 'opacity-70',
                )}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Dumbbell className="h-5 w-5" /> Seçilen Antrenmanlar
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {selectedTrainings.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Antrenman kartlarını bu alana bırakın.
                    </p>
                  )}
                  {selectedTrainings.map(training => (
                    <div
                      key={training.id}
                      className="flex items-center justify-between rounded-md border border-teal-100 bg-teal-50/60 px-3 py-2 text-sm dark:border-emerald-900/60 dark:bg-emerald-900/30"
                    >
                      <div>
                        <p className="font-medium">{training.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {training.type} • {training.duration} dk
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        onClick={() => removeSelectedTraining(training.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card className="border-emerald-200/80 bg-white/80 dark:border-emerald-900/50 dark:bg-emerald-950/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ClipboardList className="h-5 w-5" /> Antrenman Kontrolü
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md bg-emerald-50/80 p-2 dark:bg-emerald-900/40">
                    <p className="text-muted-foreground">Oyuncu Sayısı</p>
                    <p className="text-lg font-semibold">{selectedPlayers.length}</p>
                  </div>
                  <div className="rounded-md bg-teal-50/80 p-2 dark:bg-emerald-900/40">
                    <p className="text-muted-foreground">Antrenman Sayısı</p>
                    <p className="text-lg font-semibold">{selectedTrainings.length}</p>
                  </div>
                  <div className="rounded-md bg-emerald-50/80 p-2 dark:bg-emerald-900/40">
                    <p className="text-muted-foreground">Toplam Kombinasyon</p>
                    <p className="text-lg font-semibold">{totalAssignments}</p>
                  </div>
                  <div className="rounded-md bg-teal-50/80 p-2 dark:bg-emerald-900/40">
                    <p className="text-muted-foreground">Beklenen Süre</p>
                    <p className="text-lg font-semibold">
                      {sessionDurationMinutes} dk
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50 p-4 text-sm dark:border-emerald-900/60 dark:from-emerald-950 dark:to-teal-950">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span>Süre</span>
                    </div>
                    <span className="font-semibold">
                      {isTraining ? formatTime(timeLeft) : `${sessionDurationMinutes} dakika`}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Diamond className="h-4 w-4" />
                      <span>Elmas Maliyeti</span>
                    </div>
                    <span className="font-semibold">{diamondCost}</span>
                  </div>
                  {diamondCost === 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Bir oyuncu + bir antrenman kombinasyonu ücretsizdir.
                    </p>
                  )}
                </div>

                <Button
                  onClick={handleStartTraining}
                  disabled={!canStart}
                  className="h-12 w-full"
                >
                  {isTraining ? formatTime(timeLeft) : 'Antrenmanı Başlat'}
                </Button>
                {isTraining && (
                  <p className="text-center text-xs text-muted-foreground">
                    Antrenman devam ederken seçimler kilitlenir.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Trainings list */}
          <Card className="border-teal-200/70 bg-white/70 dark:border-emerald-900/60 dark:bg-emerald-950/50">
            <CardHeader className="space-y-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Dumbbell className="h-5 w-5" /> Antrenmanlar
              </CardTitle>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={trainingSearch}
                  onChange={event => setTrainingSearch(event.target.value)}
                  placeholder="Antrenman ara"
                  className="pl-9"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[calc(100vh-260px)] overflow-y-auto pr-2">
              {filteredTrainings.length === 0 && (
                <p className="text-sm text-muted-foreground">
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
                    'cursor-grab select-none border-teal-100 transition hover:border-teal-300 dark:border-emerald-900/50 dark:hover:border-emerald-700',
                    isTraining && 'pointer-events-none opacity-60',
                  )}
                >
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <p className="font-semibold">{training.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {training.description}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Hedef</p>
                      <p className="font-semibold">{training.type}</p>
                      <p className="text-xs text-muted-foreground mt-1">{training.duration} dk</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
