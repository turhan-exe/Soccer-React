import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlayerCard } from '@/components/ui/player-card';
import { StatBar } from '@/components/ui/stat-bar';
import { mockPlayers, trainings } from '@/lib/data';
import { Player, Training } from '@/types';
import { Dumbbell, Play, TrendingUp, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

export default function TrainingPage() {
  const navigate = useNavigate();
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [selectedTraining, setSelectedTraining] = useState<Training | null>(null);
  const [isTraining, setIsTraining] = useState(false);

  const handleStartTraining = async () => {
    if (!selectedPlayer || !selectedTraining) {
      toast.error('Lütfen oyuncu ve antrenman seçin');
      return;
    }

    setIsTraining(true);
    
    // Simulate training
    setTimeout(() => {
      const improvement = 0.001 + Math.random() * 0.05; // 0.001-0.051 improvement
      const successRate = Math.random() * 100;
      
      setIsTraining(false);
      
      if (successRate > 70) {
        toast.success(`${selectedPlayer.name} antrenmanı başarıyla tamamladı! +${(improvement * 100).toFixed(1)}% gelişim`);
      } else if (successRate > 40) {
        toast(`${selectedPlayer.name} ortalama bir antrenman yaptı. +${(improvement * 50).toFixed(1)}% gelişim`);
      } else {
        toast.error(`${selectedPlayer.name} antrenmanı tamamlayamadı. Gelişim yok.`);
      }
    }, 3000);
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
                const player = mockPlayers.find(p => p.id === value);
                setSelectedPlayer(player || null);
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Antrenman yapacak oyuncuyu seçin" />
                </SelectTrigger>
                <SelectContent>
                  {mockPlayers.filter(p => p.squadRole === 'starting').map(player => (
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
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Antrenman Devam Ediyor...
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