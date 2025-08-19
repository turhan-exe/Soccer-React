import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlayerCard } from '@/components/ui/player-card';
import { Player } from '@/types';
import { getTeam, saveTeamPlayers } from '@/services/team';
import { useAuth } from '@/contexts/AuthContext';
import { Search, Save, Eye, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

export default function TeamPlanning() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('starting');

  const filteredPlayers = players.filter(player => 
    player.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    player.category === activeTab
  );

  const movePlayer = (playerId: string, newCategory: Player['category']) => {
    setPlayers(prev => prev.map(player =>
      player.id === playerId ? { ...player, category: newCategory } : player
    ));
    toast.success('Oyuncu başarıyla taşındı');
  };

  const handleSave = () => {
    if (!user) return;
    saveTeamPlayers(user.id, players);
    toast.success('Takım planı kaydedildi!');
  };

  useEffect(() => {
    if (!user) return;
    getTeam(user.id).then(team => {
      if (team) setPlayers(team.players);
    });
  }, [user]);

  const startingEleven = players.filter(p => p.category === 'starting');
  const benchPlayers = players.filter(p => p.category === 'bench');
  const reservePlayers = players.filter(p => p.category === 'reserve');

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
      {/* Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/')}>←</Button>
            <h1 className="text-xl font-bold">Takım Planı</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Eye className="h-4 w-4 mr-2" />
              Formasyon
            </Button>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-2" />
              Kaydet
            </Button>
          </div>
        </div>
      </div>

      <div className="p-4">
        {/* Search & Filter */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Oyuncu ara..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4 mr-2" />
                Filtre
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Team Formation Overview */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              Formasyon Görünümü (4-4-2)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-gradient-to-b from-green-400 to-green-600 rounded-lg p-4 relative h-40">
              <div className="text-white text-center text-sm font-semibold">
                {startingEleven.length}/11 oyuncu seçildi
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="grid grid-cols-4 gap-2 text-white text-xs">
                  <div className="text-center">GK<br/>1</div>
                  <div className="text-center">DEF<br/>4</div>
                  <div className="text-center">MID<br/>4</div>
                  <div className="text-center">ATT<br/>2</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Player Lists */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="starting">
              İlk 11 ({startingEleven.length})
            </TabsTrigger>
            <TabsTrigger value="bench">
              Yedek ({benchPlayers.length})
            </TabsTrigger>
            <TabsTrigger value="reserve">
              Rezerv ({reservePlayers.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="starting" className="space-y-4 mt-4">
            {filteredPlayers.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="text-4xl mb-4">⚽</div>
                  <h3 className="font-semibold mb-2">İlk 11'inizi oluşturun</h3>
                  <p className="text-muted-foreground text-sm">
                    Yedek kulübesinden oyuncularınızı İlk 11'e taşıyın
                  </p>
                </CardContent>
              </Card>
            ) : (
              filteredPlayers.map(player => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  onMoveToBench={() => movePlayer(player.id, 'bench')}
                  onMoveToReserve={() => movePlayer(player.id, 'reserve')}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="bench" className="space-y-4 mt-4">
            {filteredPlayers.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="text-4xl mb-4">🪑</div>
                  <h3 className="font-semibold mb-2">Yedek kulübesi boş</h3>
                  <p className="text-muted-foreground text-sm">
                    Rezervden oyuncularınızı yedek kulübesine taşıyın
                  </p>
                </CardContent>
              </Card>
            ) : (
              filteredPlayers.map(player => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  onMoveToStarting={() => movePlayer(player.id, 'starting')}
                  onMoveToReserve={() => movePlayer(player.id, 'reserve')}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="reserve" className="space-y-4 mt-4">
            {filteredPlayers.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="text-4xl mb-4">👥</div>
                  <h3 className="font-semibold mb-2">Rezerv oyuncu yok</h3>
                  <p className="text-muted-foreground text-sm">
                    Altyapıdan oyuncu transfer edin veya pazardan oyuncu satın alın
                  </p>
                </CardContent>
              </Card>
            ) : (
              filteredPlayers.map(player => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  onMoveToStarting={() => movePlayer(player.id, 'starting')}
                  onMoveToBench={() => movePlayer(player.id, 'bench')}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}