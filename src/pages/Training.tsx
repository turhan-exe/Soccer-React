import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatBar } from '@/components/ui/stat-bar';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { trainings } from '@/lib/data';
import { calculateOverall } from '@/lib/player';
import { Player, Training } from '@/types';
import { Dumbbell, Play, TrendingUp, Clock, Diamond } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getTeam, saveTeamPlayers } from '@/services/team';
import { Timestamp } from 'firebase/firestore';
import {
  getActiveTraining,
  setActiveTraining,
  clearActiveTraining,
  finishTrainingWithDiamonds,
  TRAINING_FINISH_COST,
  purchaseTrainingBoost,
  TRAINING_BOOST_COST,
  addTrainingRecord,
  getTrainingHistory,
  TrainingHistoryRecord,
} from '@/services/training';
import { useDiamonds } from '@/contexts/DiamondContext';

export default function TrainingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { balance } = useDiamonds();
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [selectedTraining, setSelectedTraining] = useState<Training | null>(null);
  const [isTraining, setIsTraining] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [useBoost, setUseBoost] = useState(false);
  const [playersLoaded, setPlayersLoaded] = useState(false);
  const [history, setHistory] = useState<TrainingHistoryRecord[]>([]);
  const [filterPlayer, setFilterPlayer] = useState('all');
  const [filterTrainingType, setFilterTrainingType] = useState('all');
  const [filterResult, setFilterResult] = useState('all');
  const intervalRef = useRef<number | null>(null);

  const isStatMaxed =
    selectedPlayer &&
    selectedTraining &&
    selectedPlayer.attributes[selectedTraining.type] >= 1;

  useEffect(() => {
    const fetchPlayers = async () => {
      if (!user) return;
      const team = await getTeam(user.id);
      setPlayers(team?.players || []);
      setPlayersLoaded(true);
    };
    fetchPlayers();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const loadHistory = async () => {
      const records = await getTrainingHistory(user.id);
      setHistory(records);
    };
    loadHistory();
  }, [user]);

  // Restore training session from Firestore if it exists
  useEffect(() => {
    if (!user || !playersLoaded) return;
    const fetchSession = async () => {
      const session = await getActiveTraining(user.id);
      if (!session) return;

      const player = players.find(p => p.id === session.playerId);
      const training = trainings.find(t => t.id === session.trainingId);
      if (!player || !training) {
        await clearActiveTraining(user.id);
        return;
      }

      const remaining = Math.round((session.endAt.toMillis() - Date.now()) / 1000);
      setUseBoost(session.boost || false);

      if (remaining <= 0) {
        setSelectedPlayer(player);
        setSelectedTraining(training);
        setIsTraining(true);
        setTimeLeft(0);
        await completeTraining(player, training);
      } else {
        setSelectedPlayer(player);
        setSelectedTraining(training);
        setIsTraining(true);
        setTimeLeft(remaining);

        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        intervalRef.current = window.setInterval(() => {
          setTimeLeft(prev => prev - 1);
        }, 1000);
      }
    };
    fetchSession();
  }, [players, user, playersLoaded]);

  const handleStartTraining = async () => {
    if (!selectedPlayer || !selectedTraining || !user) {
      toast.error('Lütfen oyuncu ve antrenman seçin');
      return;
    }

    if (isStatMaxed) {
      toast.error('Bu yetenek zaten maksimum seviyede');
      return;
    }

    const existing = await getActiveTraining(user.id);
    if (existing) {
      toast.error('Zaten devam eden bir antrenman var');
      return;
    }

    if (useBoost) {
      try {
        await purchaseTrainingBoost(user.id);
      } catch (err) {
        return;
      }
    }

    const duration = selectedTraining.duration * 60;
    const startTime = Date.now();
    const endTime = startTime + duration * 1000;
    await setActiveTraining(user.id, {
      playerId: selectedPlayer.id,
      playerName: selectedPlayer.name,
      trainingId: selectedTraining.id,
      trainingName: selectedTraining.name,
      startAt: Timestamp.fromMillis(startTime),
      endAt: Timestamp.fromMillis(endTime),
      boost: useBoost,
    });

    setIsTraining(true);
    setTimeLeft(duration);

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    intervalRef.current = window.setInterval(() => {
      setTimeLeft(prev => prev - 1);
    }, 1000);
  };

  const handleFinishWithDiamonds = async () => {
    if (!selectedPlayer || !selectedTraining || !user) return;
    try {
      await finishTrainingWithDiamonds(user.id);
      setTimeLeft(0);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  useEffect(() => {
    if (isTraining && timeLeft <= 0) {
      completeTraining();
    }
  }, [isTraining, timeLeft]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const completeTraining = async (playerOverride?: Player, trainingOverride?: Training) => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    const player = playerOverride || selectedPlayer;
    const training = trainingOverride || selectedTraining;

    if (!player || !training || !user) {
      setIsTraining(false);
      if (user) await clearActiveTraining(user.id);
      return;
    }

    const improvement = 0.001 + Math.random() * 0.05;
    const successRate = Math.min(Math.random() * 100 + (useBoost ? 20 : 0), 100);
    let gain = 0;
    let result: 'success' | 'average' | 'fail' = 'fail';

    if (successRate > 70) {
      gain = improvement;
      result = 'success';
      toast.success(
        `${player.name} antrenmanı başarıyla tamamladı! +${(gain * 100).toFixed(1)}% gelişim`,
      );
    } else if (successRate > 40) {
      gain = improvement * 0.5;
      result = 'average';
      toast(
        `${player.name} ortalama bir antrenman yaptı. +${(gain * 100).toFixed(1)}% gelişim`,
      );
    } else {
      result = 'fail';
      toast.error(`${player.name} antrenmanı tamamlayamadı. Gelişim yok.`);
    }

    if (gain > 0) {
      const updatedPlayers = players.map(p => {
        if (p.id !== player.id) return p;
        const newAttr = Math.min(p.attributes[training.type] + gain, 1);
        const newAttributes = { ...p.attributes, [training.type]: newAttr };
        return {
          ...p,
          attributes: newAttributes,
          overall: Math.min(
            calculateOverall(p.position, newAttributes),
            p.potential
          ),
        };
      });
      setPlayers(updatedPlayers);
      const updatedPlayer = updatedPlayers.find(p => p.id === player.id) || null;
      setSelectedPlayer(updatedPlayer);
      await saveTeamPlayers(user.id, updatedPlayers);
    }
    const record: TrainingHistoryRecord = {
      playerId: player.id,
      playerName: player.name,
      trainingId: training.id,
      trainingName: training.name,
      result,
      gain,
      completedAt: Timestamp.now(),
    };
    await addTrainingRecord(user.id, record);
    setHistory(prev => [...prev, record]);

    setIsTraining(false);
    setTimeLeft(0);
    await clearActiveTraining(user.id);
    setUseBoost(false);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const continueToMatch = () => {
    navigate('/match-preview');
  };

  const filteredHistory = history.filter(h =>
    (filterPlayer === 'all' || h.playerId === filterPlayer) &&
    (filterTrainingType === 'all' || h.trainingId === filterTrainingType) &&
    (filterResult === 'all' || h.result === filterResult)
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
      {/* Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/')}>←</Button>
            <h1 className="text-xl font-bold">Antrenman</h1>
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
                  <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
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

      <div className="p-4 space-y-6">
        {isTraining && selectedPlayer && selectedTraining && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Dumbbell className="h-5 w-5" />
                Aktif Antrenman
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{selectedPlayer.name}</p>
                  <p className="text-sm text-muted-foreground">{selectedTraining.name}</p>
                </div>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {formatTime(timeLeft)}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Selection Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Player Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Oyuncu Seçimi
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select onValueChange={(value) => {
                const player = players.find(p => p.id === value);
                setSelectedPlayer(player || null);
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Antrenman yapacak oyuncuyu seçin" />
                </SelectTrigger>
                <SelectContent>
                  {players.map(player => (
                    <SelectItem key={player.id} value={player.id}>
                      {player.name} ({player.position}) - {Math.round(player.overall * 100)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Training Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Dumbbell className="h-5 w-5" />
                Antrenman Seçimi
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Select onValueChange={(value) => {
                  const training = trainings.find(t => t.id === value);
                  setSelectedTraining(training || null);
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Antrenman türünü seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {trainings.map(training => (
                      <SelectItem
                        key={training.id}
                        value={training.id}
                        disabled={
                          selectedPlayer ? selectedPlayer.attributes[training.type] >= 1 : false
                        }
                      >
                        <div className="flex items-center justify-between w-full">
                          <span>{training.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {selectedPlayer && selectedPlayer.attributes[training.type] >= 1
                              ? 'Max'
                              : `${training.duration}dk`}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  variant={useBoost ? 'default' : 'outline'}
                  onClick={() => setUseBoost(!useBoost)}
                  disabled={balance < TRAINING_BOOST_COST || isTraining}
                >
                  <Diamond className="h-4 w-4" />
                </Button>
              </div>
              {useBoost && (
                <p className="text-xs text-muted-foreground mt-2">
                  {TRAINING_BOOST_COST} Elmas • Başarı şansı artar
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Selected Player Details */}
        {selectedPlayer && (
          <Card>
            <CardHeader>
              <CardTitle>Seçili Oyuncu Detayları</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 rounded-full flex items-center justify-center text-xl font-semibold">
                  {selectedPlayer.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{selectedPlayer.name}</h3>
                  <p className="text-muted-foreground">{selectedPlayer.position} • {selectedPlayer.age} yaş</p>
                  
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <StatBar label="Güç" value={selectedPlayer.attributes.strength} />
                    <StatBar label="Hızlanma" value={selectedPlayer.attributes.acceleration} />
                    <StatBar label="Maks Hız" value={selectedPlayer.attributes.topSpeed} />
                    <StatBar label="Dribling Hızı" value={selectedPlayer.attributes.dribbleSpeed} />
                    <StatBar label="Sıçrama" value={selectedPlayer.attributes.jump} />
                    <StatBar label="Mücadele" value={selectedPlayer.attributes.tackling} />
                    <StatBar label="Top Saklama" value={selectedPlayer.attributes.ballKeeping} />
                    <StatBar label="Pas" value={selectedPlayer.attributes.passing} />
                    <StatBar label="Uzun Top" value={selectedPlayer.attributes.longBall} />
                    <StatBar label="Çeviklik" value={selectedPlayer.attributes.agility} />
                    <StatBar label="Şut" value={selectedPlayer.attributes.shooting} />
                    <StatBar label="Şut Gücü" value={selectedPlayer.attributes.shootPower} />
                    <StatBar label="Pozisyon Alma" value={selectedPlayer.attributes.positioning} />
                    <StatBar label="Refleks" value={selectedPlayer.attributes.reaction} />
                    <StatBar label="Top Kontrolü" value={selectedPlayer.attributes.ballControl} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Selected Training Details */}
        {selectedTraining && (
          <Card>
            <CardHeader>
              <CardTitle>Antrenman Detayları</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{selectedTraining.name}</h3>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    {selectedTraining.duration} dakika
                  </div>
                </div>
                <p className="text-muted-foreground">{selectedTraining.description}</p>
                <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    Bu antrenman <span className="font-semibold">{selectedTraining.type}</span> yeteneğini geliştirecek.
                    Başarı oranı oyuncunun mevcut seviyesine bağlıdır.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Start Training Button */}
        <Card>
          <CardContent className="p-6">
            <Button
              onClick={handleStartTraining}
              disabled={!selectedPlayer || !selectedTraining || isTraining || isStatMaxed}
              className="w-full h-12"
              size="lg"
            >
              {isTraining ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  {formatTime(timeLeft)}
                </div>
              ) : (
                <>
                  <Play className="h-5 w-5 mr-2" />
                  Antrenmanı Başlat
                </>
              )}
            </Button>

            {isTraining && selectedPlayer && selectedTraining && (
              <Button
                onClick={handleFinishWithDiamonds}
                className="mt-4 w-full"
                variant="secondary"
                disabled={balance < TRAINING_FINISH_COST}
              >
                <Diamond className="h-4 w-4 mr-1" />
                {TRAINING_FINISH_COST} Elmas ile bitir
              </Button>
            )}

            {(!selectedPlayer || !selectedTraining) && (
              <p className="text-center text-sm text-muted-foreground mt-2">
                Antrenmanı başlatmak için oyuncu ve antrenman türü seçin
              </p>
            )}
            {isStatMaxed && selectedPlayer && selectedTraining && (
              <p className="text-center text-sm text-muted-foreground mt-2">
                Bu yetenek zaten maksimum seviyede
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}