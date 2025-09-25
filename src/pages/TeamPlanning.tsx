import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlayerCard } from '@/components/ui/player-card';
import { PerformanceGauge, clampPerformanceGauge } from '@/components/ui/performance-gauge';
import { Player } from '@/types';
import { getTeam, saveTeamPlayers, createInitialTeam, setLineupServer } from '@/services/team';
import { useAuth } from '@/contexts/AuthContext';
import { Search, Save, Eye, ArrowUp } from 'lucide-react';
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
import { calculatePowerIndex } from '@/lib/player';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BackButton } from '@/components/ui/back-button';

const DEFAULT_GAUGE_VALUE = 0.75;

const KNOWN_POSITIONS: Player['position'][] = ['GK', 'CB', 'LB', 'RB', 'CM', 'LM', 'RM', 'CAM', 'LW', 'RW', 'ST'];

const POSITION_ALIAS_MAP: Record<string, Player['position']> = {
  CF: 'ST',
  FW: 'ST',
  FWD: 'ST',
  FOR: 'ST',
  FORWARD: 'ST',
  STRIKER: 'ST',
  ATT: 'ST',
  SS: 'ST',
  HU: 'ST',
  FO: 'ST',
  STP: 'ST',
  AM: 'CAM',
  AMF: 'CAM',
  IM: 'CAM',
  CMF: 'CM',
  CMID: 'CM',
  MID: 'CM',
  DM: 'CM',
  DMF: 'CM',
  CDM: 'CM',
  RMF: 'RM',
  RWF: 'RW',
  RWB: 'RB',
  LWF: 'LW',
  LMF: 'LM',
  LWB: 'LB',
  RCB: 'CB',
  LCB: 'CB',
  CBK: 'CB',
  BL: 'CB',
  DR: 'RB',
  EB: 'RW',
  IR: 'RM',
  LY: 'LB',
};

const squadRoleWeight = (role?: Player['squadRole'] | 'youth'): number => {
  switch (role) {
    case 'starting':
      return 0;
    case 'bench':
      return 1;
    case 'reserve':
      return 2;
    case 'youth':
      return 3;
    default:
      return 4;
  }
};

const canonicalPosition = (value?: string | null): Player['position'] => {
  if (!value) return 'CM';
  const key = value.toUpperCase().replace(/[^A-Z]/g, '');
  if ((KNOWN_POSITIONS as readonly string[]).includes(key)) {
    return key as Player['position'];
  }
  if (POSITION_ALIAS_MAP[key]) {
    return POSITION_ALIAS_MAP[key];
  }
  return 'CM';
};

function normalizePlayer(player: Player): Player {
  return {
    ...player,
    condition: clampPerformanceGauge(player.condition, DEFAULT_GAUGE_VALUE),
    motivation: clampPerformanceGauge(player.motivation, DEFAULT_GAUGE_VALUE),
  };
}

function normalizePlayers(list: Player[]): Player[] {
  return list.map(normalizePlayer);
}

function playerInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');
}

function getPlayerCondition(player: Player): number {
  return clampPerformanceGauge(player.condition, DEFAULT_GAUGE_VALUE);
}

function getPlayerMotivation(player: Player): number {
  return clampPerformanceGauge(player.motivation, DEFAULT_GAUGE_VALUE);
}

function getPlayerPower(player: Player): number {
  return calculatePowerIndex({
    ...player,
    condition: getPlayerCondition(player),
    motivation: getPlayerMotivation(player),
  });
}

export default function TeamPlanning() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('starting');
  const [selectedFormation, setSelectedFormation] = useState(
    formations[0].name
  );

  const [draggedPlayerId, setDraggedPlayerId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'role' | 'overall' | 'potential'>('role');
  const [focusedPlayerId, setFocusedPlayerId] = useState<string | null>(null);


  const filteredPlayers = players.filter(
    player =>
      player.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      player.squadRole === activeTab,
  );

  const POSITION_ORDER: Player['position'][] = [
    'GK',
    'LB',
    'CB',
    'RB',
    'LM',
    'CM',
    'RM',
    'CAM',
    'LW',
    'RW',
    'ST',
  ];

  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    switch (sortBy) {
      case 'overall':
        return b.overall - a.overall;
      case 'potential':
        return b.potential - a.potential;
      default:
        return (
          POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position)
        );
    }
  });

  const movePlayer = (playerId: string, newRole: Player['squadRole']) => {
    setPlayers(prev => prev.map(player =>
      player.id === playerId ? { ...player, squadRole: newRole } : player
    ));
    toast.success('Oyuncu baÃ…Å¸arÃ„Â±yla taÃ…Å¸Ã„Â±ndÃ„Â±');
  };

  const handleSave = async () => {
    if (!user) return;
    try {
      // Persist full roster locally for client experience
      await saveTeamPlayers(user.id, players);

      // Also send authoritative lineup snapshot to server (XI + bench)
      const starters = players.filter(p => p.squadRole === 'starting').map(p => p.id);
      const bench = players.filter(p => p.squadRole === 'bench').map(p => p.id);
      await setLineupServer({
        teamId: user.id,
        formation: selectedFormation,
        starters,
        subs: bench,
      });
      toast.success('TakÃ„Â±m planÃ„Â± kaydedildi!');
    } catch (e) {
      console.warn('[TeamPlanning] setLineup failed', e);
      toast.error('Sunucu hatasÃ„Â±', { description: 'Kadro kaydÃ„Â± baÃ…Å¸arÃ„Â±sÃ„Â±z. LÃƒÂ¼tfen tekrar deneyin.' });
    }
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      let team = await getTeam(user.id);
      if (!team) {
        team = await createInitialTeam(user.id, user.teamName, user.teamName);
      }
      setPlayers(normalizePlayers(team.players));
    })();
  }, [user]);

  useEffect(() => {
    if (players.length === 0) {
      if (focusedPlayerId !== null) {
        setFocusedPlayerId(null);
      }
      return;
    }
    if (focusedPlayerId && players.some(p => p.id === focusedPlayerId)) {
      return;
    }
    const fallback = players.find(p => p.squadRole === 'starting') ?? players[0];
    if (fallback && fallback.id !== focusedPlayerId) {
      setFocusedPlayerId(fallback.id);
    }
  }, [players, focusedPlayerId]);

  const startingEleven = players.filter(p => p.squadRole === 'starting');
  const benchPlayers = players.filter(p => p.squadRole === 'bench');
  const reservePlayers = players.filter(p => p.squadRole === 'reserve');

  const currentFormation = formations.find(
    f => f.name === selectedFormation
  )!;

  const prioritizedPlayers = useMemo(() => {
    const indexMap = new Map(players.map((p, idx) => [p.id, idx]));
    return [...players].sort((a, b) => {
      const roleDiff = squadRoleWeight(a.squadRole) - squadRoleWeight(b.squadRole);
      if (roleDiff !== 0) return roleDiff;
      return (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0);
    });
  }, [players]);

  const formationPositions = useMemo(() => {
    const used = new Set<string>();
    return currentFormation.positions.map(pos => {
      const target = canonicalPosition(pos.position);
      const directMatch = prioritizedPlayers.find(
        player => !used.has(player.id) && canonicalPosition(player.position) === target
      );
      const roleMatch = prioritizedPlayers.find(
        player =>
          !used.has(player.id) && (player.roles ?? []).some(role => canonicalPosition(role) === target)
      );
      const player = directMatch ?? roleMatch ?? null;
      if (player) used.add(player.id);
      return { ...pos, player };
    });
  }, [currentFormation, prioritizedPlayers]);

  const selectedPlayer = useMemo(() => {
    if (!focusedPlayerId) return null;
    return players.find(p => p.id === focusedPlayerId) ?? null;
  }, [players, focusedPlayerId]);

  const selectedPower = selectedPlayer ? getPlayerPower(selectedPlayer) : 0;

  const startingAverages = useMemo(() => {
    const starters = players.filter(p => p.squadRole === 'starting');
    if (starters.length === 0) {
      return { condition: 0, motivation: 0, power: 0 };
    }
    const totals = starters.reduce(
      (acc, player) => {
        acc.condition += getPlayerCondition(player);
        acc.motivation += getPlayerMotivation(player);
        acc.power += getPlayerPower(player);
        return acc;
      },
      { condition: 0, motivation: 0, power: 0 }
    );
    return {
      condition: totals.condition / starters.length,
      motivation: totals.motivation / starters.length,
      power: totals.power / starters.length,
    };
  }, [players]);


  const handlePositionDrop = (
    e: React.DragEvent<HTMLDivElement>,
    targetPosition: Player['position'],
  ) => {
    const playerId = e.dataTransfer.getData('text/plain') || draggedPlayerId;
    if (!playerId) return;
    setPlayers(prev => {
      const draggedIndex = prev.findIndex(p => p.id === playerId);
      if (draggedIndex === -1) return prev;
      const draggedPlayer = prev[draggedIndex];
      const targetIndex = prev.findIndex(
        p => p.position === targetPosition && p.squadRole === 'starting',
      );
      const updated = [...prev];
      if (targetIndex !== -1) {
        const targetPlayer = prev[targetIndex];
        updated[targetIndex] = {
          ...targetPlayer,
          squadRole: draggedPlayer.squadRole,
        };
      }
      updated[draggedIndex] = {
        ...draggedPlayer,
        position: targetPosition,
        squadRole: 'starting',
      };
      return normalizePlayers(updated);
    });
    setFocusedPlayerId(playerId);
    setDraggedPlayerId(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
      {/* Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton />
            <h1 className="text-xl font-bold">TakÃ„Â±m PlanÃ„Â±</h1>
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
        <div className="mx-auto max-w-6xl space-y-6">
        {/* Search & Filter */}
        <Card className="sticky top-4 z-40">
          <CardContent className="p-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Oyuncu ara..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select
                value={sortBy}
                onValueChange={value =>
                  setSortBy(value as 'role' | 'overall' | 'potential')
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="SÃ„Â±rala" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="role">Role gÃƒÂ¶re</SelectItem>
                  <SelectItem value="overall">Ortalamaya gÃƒÂ¶re</SelectItem>
                  <SelectItem value="potential">Maks. potansiyel</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
          {/* Team Formation Overview */}
          <Card className="sticky top-24 z-30 self-start lg:top-24 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <CardHeader className="flex flex-col gap-2 border-b border-white/60 bg-white/70 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:bg-slate-900/80">
            <CardTitle className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              Formasyon GörüÃƒÂ¶rÃƒÂ¼nÃƒÂ¼mÃƒÂ¼ ({selectedFormation})
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
          <CardContent className="bg-gradient-to-br from-emerald-600/95 via-emerald-700/95 to-emerald-800/95">
            <div className="flex flex-col gap-6 lg:flex-row">
              <div className="relative z-10 w-full max-w-md flex-shrink-0 overflow-hidden rounded-2xl bg-gradient-to-b from-emerald-600 via-emerald-700 to-emerald-800 p-5 shadow-[0_20px_45px_-25px_rgba(16,80,40,0.8)]">
                <div className="absolute inset-0 opacity-80">
                  <svg
                    viewBox="0 0 100 100"
                    className="absolute inset-0 h-full w-full text-white/60"
                    pointerEvents="none"
                  >
                    <rect x="0" y="0" width="100" height="100" fill="none" stroke="currentColor" strokeWidth="2" />
                    <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeWidth="1" />
                    <circle cx="50" cy="50" r="9" stroke="currentColor" strokeWidth="1" fill="none" />
                    <rect x="16" y="0" width="68" height="16" stroke="currentColor" strokeWidth="1" fill="none" />
                    <rect x="16" y="84" width="68" height="16" stroke="currentColor" strokeWidth="1" fill="none" />
                    <rect x="30" y="0" width="40" height="6" stroke="currentColor" strokeWidth="1" fill="none" />
                    <rect x="30" y="94" width="40" height="6" stroke="currentColor" strokeWidth="1" fill="none" />
                    <circle cx="50" cy="11" r="1.5" fill="currentColor" />
                    <circle cx="50" cy="89" r="1.5" fill="currentColor" />
                  </svg>
                </div>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <ArrowUp className="h-24 w-24 text-white/15" />
                </div>
                <div className="absolute inset-0">
                  {formationPositions.map(({ player, position, x, y }, idx) => (
                    <div
                      key={idx}
                      className="absolute text-center"
                      style={{
                        left: `${x}%`,
                        top: `${y}%`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handlePositionDrop(e, position)}
                    >
                      {player ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className={cn(
                                'flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-white/85 text-[9px] font-semibold text-emerald-900 shadow transition-all duration-150 cursor-grab',
                                player.id === focusedPlayerId
                                  ? 'ring-4 ring-white/80 ring-offset-2 ring-offset-emerald-600 shadow-lg'
                                  : 'hover:ring-2 hover:ring-white/70'
                              )}
                              draggable
                              onClick={() => setFocusedPlayerId(player.id)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setFocusedPlayerId(player.id);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              onDragStart={e => {
                                setDraggedPlayerId(player.id);
                                e.dataTransfer.setData('text/plain', player.id);
                              }}
                              onDragEnd={() => setDraggedPlayerId(null)}
                            >
                              <span className="px-1 text-center leading-tight">
                                {playerInitials(player.name)}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="w-48 space-y-2">
                            <div className="text-xs font-semibold">{player.name}</div>
                            <PerformanceGauge label="GÃ¼Ã§" value={getPlayerPower(player)} />
                            <PerformanceGauge label="Kondisyon" value={getPlayerCondition(player)} />
                            <PerformanceGauge label="Motivasyon" value={getPlayerMotivation(player)} />
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-white/50 bg-white/20 text-[9px] font-semibold uppercase tracking-wide text-white">
                          {position}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-1 space-y-4">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-900/20 p-4 text-white shadow-inner backdrop-blur-sm">
                  {selectedPlayer ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-white/70">SeÃ§ili Oyuncu</p>
                          <h3 className="text-lg font-semibold">{selectedPlayer.name}</h3>
                          <p className="text-xs text-white/70">
                            {selectedPlayer.position} â€¢ GÃ¼Ã§ {Math.round(selectedPower * 100)}
                          </p>
                        </div>
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-lg font-semibold">
                          {playerInitials(selectedPlayer.name)}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <PerformanceGauge label="GÃ¼Ã§" value={selectedPower} variant="dark" />
                        <PerformanceGauge label="Kondisyon" value={getPlayerCondition(selectedPlayer)} variant="dark" />
                        <PerformanceGauge label="Motivasyon" value={getPlayerMotivation(selectedPlayer)} variant="dark" />
                      </div>
                    </div>
                  ) : (
                    <div className="py-8 text-center text-sm text-white/70">
                      Formasyondaki bir oyuncuya tıklayın.Ä±klayÄ±n.
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-emerald-200/40 bg-white/80 p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/70">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-emerald-700 dark:text-emerald-200">TakÄ±m NabzÄ±</h4>
                    <span className="text-xs text-muted-foreground">Ä°lk 11 ortalamasÄ±</span>
                  </div>
                  <div className="space-y-3">
                    <PerformanceGauge label="TakÄ±m GÃ¼cÃ¼" value={startingAverages.power} />
                    <PerformanceGauge label="Kondisyon OrtalamasÄ±" value={startingAverages.condition} />
                    <PerformanceGauge label="Motivasyon OrtalamasÄ±" value={startingAverages.motivation} />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Player Lists */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="starting">
              Ã„Â°lk 11 ({startingEleven.length})
            </TabsTrigger>
            <TabsTrigger value="bench">
              Yedek ({benchPlayers.length})
            </TabsTrigger>
            <TabsTrigger value="reserve">
              Rezerv ({reservePlayers.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="starting" className="space-y-4 mt-4">
            {sortedPlayers.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="text-4xl mb-4">Ã¢Å¡Â½</div>
                  <h3 className="font-semibold mb-2">Ã„Â°lk 11'inizi oluÃ…Å¸turun</h3>
                  <p className="text-muted-foreground text-sm">
                    Yedek kulÃƒÂ¼besinden oyuncularÃ„Â±nÃ„Â±zÃ„Â± Ã„Â°lk 11'e taÃ…Å¸Ã„Â±yÃ„Â±n
                  </p>
                </CardContent>
              </Card>
            ) : (
              sortedPlayers.map(player => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  compact
                  draggable
                  onDragStart={e => {
                    setDraggedPlayerId(player.id);
                    e.dataTransfer.setData('text/plain', player.id);
                  }}
                  onDragEnd={() => setDraggedPlayerId(null)}
                  onMoveToBench={() => movePlayer(player.id, 'bench')}
                  onMoveToReserve={() => movePlayer(player.id, 'reserve')}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="bench" className="space-y-4 mt-4">
            {sortedPlayers.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="text-4xl mb-4">ÄŸÅ¸Âªâ€˜</div>
                  <h3 className="font-semibold mb-2">Yedek kulÃƒÂ¼besi boÃ…Å¸</h3>
                  <p className="text-muted-foreground text-sm">
                    Rezervden oyuncularÃ„Â±nÃ„Â±zÃ„Â± yedek kulÃƒÂ¼besine taÃ…Å¸Ã„Â±yÃ„Â±n
                  </p>
                </CardContent>
              </Card>
            ) : (
              sortedPlayers.map(player => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  compact
                  draggable
                  onDragStart={e => {
                    setDraggedPlayerId(player.id);
                    e.dataTransfer.setData('text/plain', player.id);
                  }}
                  onDragEnd={() => setDraggedPlayerId(null)}
                  onMoveToStarting={() => movePlayer(player.id, 'starting')}
                  onMoveToReserve={() => movePlayer(player.id, 'reserve')}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="reserve" className="space-y-4 mt-4">
            {sortedPlayers.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="text-4xl mb-4">ÄŸÅ¸â€˜Â¥</div>
                  <h3 className="font-semibold mb-2">Rezerv oyuncu yok</h3>
                  <p className="text-muted-foreground text-sm">
                    AltyapÃ„Â±dan oyuncu transfer edin veya pazardan oyuncu satÃ„Â±n alÃ„Â±n
                  </p>
                </CardContent>
              </Card>
            ) : (
              sortedPlayers.map(player => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  compact
                  draggable
                  onDragStart={e => {
                    setDraggedPlayerId(player.id);
                    e.dataTransfer.setData('text/plain', player.id);
                  }}
                  onDragEnd={() => setDraggedPlayerId(null)}
                  onMoveToStarting={() => movePlayer(player.id, 'starting')}
                  onMoveToBench={() => movePlayer(player.id, 'bench')}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
        </div>
        </div>
      </div>
    </div>
  );
}






