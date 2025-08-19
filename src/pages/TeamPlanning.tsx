import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlayerCard } from '@/components/ui/player-card';
import { Player } from '@/types';
import { getTeam, saveTeamPlayers, createInitialTeam } from '@/services/team';
import { useAuth } from '@/contexts/AuthContext';
import { Search, Save, Eye, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formations } from '@/lib/formations';

export default function TeamPlanning() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('starting');
  const [selectedFormation, setSelectedFormation] = useState(
    formations[0].name
  );

  const filteredPlayers = players.filter(player => 
    player.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    player.squadRole === activeTab
  );

  const movePlayer = (playerId: string, newRole: Player['squadRole']) => {
    setPlayers(prev => prev.map(player =>
      player.id === playerId ? { ...player, squadRole: newRole } : player
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
    (async () => {
      let team = await getTeam(user.id);
      if (!team) {
        team = await createInitialTeam(user.id, user.teamName, user.teamName);
      }
      setPlayers(team.players);
    })();
  }, [user]);

  const startingEleven = players.filter(p => p.squadRole === 'starting');
  const benchPlayers = players.filter(p => p.squadRole === 'bench');
  const reservePlayers = players.filter(p => p.squadRole === 'reserve');

  const currentFormation = formations.find(
    f => f.name === selectedFormation
  )!;
  const formationPositions = (() => {
    const used = new Set<string>();
    return currentFormation.positions.map(pos => {
      const player = startingEleven.find(
        p => p.position === pos.position && !used.has(p.id)
      );
      if (player) used.add(player.id);
      return { ...pos, player };
    });
  })();

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
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              Formasyon Görünümü ({selectedFormation})
            </CardTitle>
            <Select value={selectedFormation} onValueChange={setSelectedFormation}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Formasyon" />
              </SelectTrigger>
              <SelectContent>
                {formations.map(f => (
                  <SelectItem key={f.name} value={f.name}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <div className="bg-gradient-to-b from-green-400 to-green-600 rounded-lg p-4 relative h-96">
              <div className="text-white text-center text-sm font-semibold mb-2">
                {startingEleven.length}/11 oyuncu seçildi
              </div>
              <div className="absolute inset-0">
                {formationPositions.map(({ player, position, x, y }, idx) => (
                  <div
                    key={idx}
                    className="absolute text-xs text-center"
                    style={{
                      left: `${x}%`,
                      top: `${y}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <div className="w-12 h-12 rounded-full bg-white/80 flex items-center justify-center">
                      {player ? player.name.split(' ')[0] : position}
                    </div>
                  </div>
                ))}
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