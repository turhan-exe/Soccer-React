import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatBar } from '@/components/ui/stat-bar';
import { trainings } from '@/lib/data';
import { Player, Training } from '@/types';
import { Dumbbell, Play, TrendingUp, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getTeam, saveTeamPlayers } from '@/services/team';

export default function TrainingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [selectedTraining, setSelectedTraining] = useState<Training | null>(null);
  const [isTraining, setIsTraining] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [playersLoaded, setPlayersLoaded] = useState(false);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    const fetchPlayers = async () => {
      if (!user) return;
      const team = await getTeam(user.id);
      setPlayers(team?.players || []);
      setPlayersLoaded(true);
    };
    fetchPlayers();
  }, [user]);

  // Restore training session from localStorage if it exists
  useEffect(() => {
    if (!user || !playersLoaded) return;
    const sessionStr = localStorage.getItem('activeTraining');
    if (!sessionStr) return;

    try {
      const session = JSON.parse(sessionStr);
      if (session.userId !== user.id) {
        // Remove training sessions that belong to another user
        localStorage.removeItem('activeTraining');
        return;
      }

      const player = players.find(p => p.id === session.playerId);
      const training = trainings.find(t => t.id === session.trainingId);
      if (!player || !training) {
        localStorage.removeItem('activeTraining');
        return;
      }

      const remaining = Math.round((session.endTime - Date.now()) / 1000);

      if (remaining <= 0) {
        setSelectedPlayer(player);
        setSelectedTraining(training);
        setIsTraining(true);
        setTimeLeft(0);
        completeTraining(player, training);
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
    } catch (e) {
      localStorage.removeItem('activeTraining');
    }
  }, [players, user, playersLoaded]);

  const handleStartTraining = () => {
    if (!selectedPlayer || !selectedTraining || !user) {
      toast.error('Lütfen oyuncu ve antrenman seçin');
      return;
    }

    const existingStr = localStorage.getItem('activeTraining');
    if (existingStr) {
      try {
        const existing = JSON.parse(existingStr);
        if (existing.userId === user.id) {
          toast.error('Zaten devam eden bir antrenman var');
          return;
        }
      } catch {
        // ignore parse errors and clear stale data
      }
      localStorage.removeItem('activeTraining');
    }

    const duration = selectedTraining.duration * 60;
    const endTime = Date.now() + duration * 1000;
    localStorage.setItem(
      'activeTraining',
      JSON.stringify({
        userId: user.id,
        playerId: selectedPlayer.id,
        trainingId: selectedTraining.id,
        endTime,
      })
    );

    setIsTraining(true);
    setTimeLeft(duration);

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    intervalRef.current = window.setInterval(() => {
      setTimeLeft(prev => prev - 1);
    }, 1000);
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
      localStorage.removeItem('activeTraining');
      return;
    }

    const improvement = 0.001 + Math.random() * 0.05;
    const successRate = Math.random() * 100;
    let gain = 0;

    if (successRate > 70) {
      gain = improvement;
      toast.success(`${player.name} antrenmanı başarıyla tamamladı! +${(gain * 100).toFixed(1)}% gelişim`);
    } else if (successRate > 40) {
      gain = improvement * 0.5;
      toast(`${player.name} ortalama bir antrenman yaptı. +${(gain * 100).toFixed(1)}% gelişim`);
    } else {
      toast.error(`${player.name} antrenmanı tamamlayamadı. Gelişim yok.`);
    }

    if (gain > 0) {
      const updatedPlayers = players.map(p => {
        if (p.id !== player.id) return p;
        const newAttr = Math.min(p.attributes[training.type] + gain, 1);
        return {
          ...p,
          attributes: { ...p.attributes, [training.type]: newAttr },
          overall: Math.min(parseFloat((p.overall + gain / 10).toFixed(3)), 1),
        };
      });
      setPlayers(updatedPlayers);
      const updatedPlayer = updatedPlayers.find(p => p.id === player.id) || null;
      setSelectedPlayer(updatedPlayer);
      await saveTeamPlayers(user.id, updatedPlayers);
    }

    setIsTraining(false);
    setTimeLeft(0);
    localStorage.removeItem('activeTraining');
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const continueToMatch = () => {
    navigate('/match-preview');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
      {/* Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/')}>←</Button>
            <h1 className="text-xl font-bold">Antrenman</h1>
          </div>
          <Button onClick={continueToMatch} variant="outline">
            Maç Önizleme →
          </Button>
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
                  {players.filter(p => p.squadRole === 'starting').map(player => (
                    <SelectItem key={player.id} value={player.id}>
                      {player.name} ({player.position}) - {player.overall.toFixed(3)}
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
              <Select onValueChange={(value) => {
                const training = trainings.find(t => t.id === value);
                setSelectedTraining(training || null);
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Antrenman türünü seçin" />
                </SelectTrigger>
                <SelectContent>
                  {trainings.map(training => (
                    <SelectItem key={training.id} value={training.id}>
                      <div className="flex items-center justify-between w-full">
                        <span>{training.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {training.duration}dk
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                    <StatBar label="Hız" value={selectedPlayer.attributes.topSpeed} />
                    <StatBar label="Şut" value={selectedPlayer.attributes.shooting} />
                    <StatBar label="Pas" value={selectedPlayer.attributes.passing} />
                    <StatBar label="Savunma" value={selectedPlayer.attributes.tackling} />
                    <StatBar label="Dribling" value={selectedPlayer.attributes.ballControl} />
                    <StatBar label="Fizik" value={selectedPlayer.attributes.strength} />
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
              disabled={!selectedPlayer || !selectedTraining || isTraining}
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
            
            {(!selectedPlayer || !selectedTraining) && (
              <p className="text-center text-sm text-muted-foreground mt-2">
                Antrenmanı başlatmak için oyuncu ve antrenman türü seçin
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}