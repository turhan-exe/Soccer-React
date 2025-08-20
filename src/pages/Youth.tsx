import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlayerCardSkeleton } from '@/components/ui/loading-skeleton';
import { youthPlayers } from '@/lib/data';
import { generateRandomName } from '@/lib/names';
import { Player } from '@/types';
import { UserPlus, Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { addPlayerToTeam } from '@/services/team';
import CandidateCard from '@/features/academy/CandidateCard';

export default function Youth() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [players, setPlayers] = useState<Player[]>(youthPlayers);
  const [isGenerating, setIsGenerating] = useState(false);

  const generatePlayer = async () => {
    setIsGenerating(true);
    
    // Simulate player generation
    setTimeout(() => {
      const positions: Player['position'][] = ['GK', 'CB', 'LB', 'RB', 'CM', 'LM', 'RM', 'CAM', 'LW', 'RW', 'ST'];
      
      const rand = () => Math.random();
      const newPlayer: Player = {
        id: `y${Date.now()}`,
        name: generateRandomName(),
        position: positions[Math.floor(Math.random() * positions.length)],
        overall: 0.3 + Math.random() * 0.4, // 0.3-0.7 range for youth
        attributes: {
          strength: rand(),
          acceleration: rand(),
          topSpeed: rand(),
          dribbleSpeed: rand(),
          jump: rand(),
          tackling: rand(),
          ballKeeping: rand(),
          passing: rand(),
          longBall: rand(),
          agility: rand(),
          shooting: rand(),
          shootPower: rand(),
          positioning: rand(),
          reaction: rand(),
          ballControl: rand(),
        },
        age: 16 + Math.floor(Math.random() * 3), // 16-18 years old
        squadRole: 'youth',
        height: 180,
        weight: 75,
      };
      
      setPlayers(prev => [...prev, newPlayer]);
      setIsGenerating(false);
      toast.success('Yeni genç oyuncu üretildi!');
    }, 2000);
  };

  const promotePlayer = async (playerId: string) => {
    const player = players.find(p => p.id === playerId);
    if (player && user) {
      await addPlayerToTeam(user.id, player);
      setPlayers(prev => prev.filter(p => p.id !== playerId));
      toast.success(`${player.name} takıma transfer edildi!`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
      {/* Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/')}>←</Button>
            <h1 className="text-xl font-bold">Altyapı</h1>
          </div>
          <Button onClick={generatePlayer} disabled={isGenerating}>
            {isGenerating ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Üretiliyor...
              </div>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Oyuncu Üret
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="p-4">
        {/* Stats Overview */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{players.length}</div>
              <div className="text-sm text-muted-foreground">Genç Oyuncu</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">
                {players.filter(p => p.overall > 0.6).length}
              </div>
              <div className="text-sm text-muted-foreground">Yetenekli</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-purple-600">
                {Math.round(players.reduce((acc, p) => acc + p.age, 0) / players.length || 0)}
              </div>
              <div className="text-sm text-muted-foreground">Ort. Yaş</div>
            </CardContent>
          </Card>
        </div>

        {/* Player Generation Info */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-yellow-500" />
              Oyuncu Üretimi
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Altyapı sisteminiz yeni genç yetenekleri keşfetmenizi sağlar. 
              Üretilen oyuncuların potansiyeli rastgeledir - bazen gelecekteki yıldızları bulabilirsiniz!
            </p>
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="font-semibold">Sonraki üretim:</span> 2 saat
              </div>
              <Button variant="outline" size="sm" disabled>
                Hızlandır (💎5)
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Players List */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Genç Oyuncular</h2>
          
          {isGenerating && <PlayerCardSkeleton />}
          
          {players.length === 0 && !isGenerating ? (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-4xl mb-4">🌱</div>
                <h3 className="font-semibold mb-2">Henüz genç oyuncu yok</h3>
                <p className="text-muted-foreground text-sm mb-4">
                  İlk genç oyuncunuzu üretmek için yukarıdaki butonu kullanın
                </p>
                <Button onClick={generatePlayer} disabled={isGenerating}>
                  <Plus className="h-4 w-4 mr-2" />
                  İlk Oyuncuyu Üret
                </Button>
              </CardContent>
            </Card>
          ) : (
            players.map(player => (
              <CandidateCard
      key={player.id}
      candidate={{ id: player.id, player }}   // CandidateCard player objesini bu şekilde alıyor
      onAccept={() => promotePlayer(player.id)}
      onRelease={() => setPlayers(prev => prev.filter(p => p.id !== player.id))}
    />
            ))
          )}
        </div>
      </div>
    </div>
  );
}