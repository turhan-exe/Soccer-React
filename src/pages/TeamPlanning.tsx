import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlayerCard } from '@/components/ui/player-card';
import { PerformanceGauge, clampPerformanceGauge } from '@/components/ui/performance-gauge';
import { Player, CustomFormationMap } from '@/types';
import { getTeam, saveTeamPlayers, createInitialTeam } from '@/services/team';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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

type FormationPlayerPosition = {
  x: number;
  y: number;
  position: Player['position'];
};

type CustomFormationState = CustomFormationMap;

const clampPercentageValue = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
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

const parsePercentage = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return clampPercentageValue(numeric);
};

const sanitizeCustomFormationState = (input: unknown): CustomFormationState => {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const sanitized: CustomFormationState = {};

  Object.entries(input as Record<string, unknown>).forEach(([formationKey, layout]) => {
    if (!layout || typeof layout !== 'object') {
      return;
    }

    const sanitizedLayout: Record<string, FormationPlayerPosition> = {};

    Object.entries(layout as Record<string, unknown>).forEach(([playerId, value]) => {
      if (!value || typeof value !== 'object') {
        return;
      }

      const x = parsePercentage((value as { x?: unknown }).x);
      const y = parsePercentage((value as { y?: unknown }).y);
      const rawPosition = (value as { position?: unknown }).position;
      const normalizedPosition =
        typeof rawPosition === 'string' ? canonicalPosition(rawPosition) : 'CM';

      sanitizedLayout[String(playerId)] = {
        x,
        y,
        position: normalizedPosition,
      };
    });

    if (Object.keys(sanitizedLayout).length > 0) {
      sanitized[String(formationKey)] = sanitizedLayout;
    }
  });

  return sanitized;
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


type PromoteToStartingResult = {
  players: Player[];
  error?: string;
  updated: boolean;
  swappedPlayerId?: string | null;
  targetPosition?: Player['position'];
};

function promotePlayerToStartingRoster(
  roster: Player[],
  playerId: string,
  targetPosition?: Player['position'],
): PromoteToStartingResult {
  const playerIndex = roster.findIndex(player => player.id === playerId);
  if (playerIndex === -1) {
    return { players: roster, error: 'Oyuncu bulunamad.', updated: false };
  }

  const player = roster[playerIndex];
  const currentRole = player.squadRole;
  const desiredPosition = targetPosition ?? player.position;
  const canonicalTarget = canonicalPosition(desiredPosition);
  const isAlreadyStartingSameSpot =
    currentRole === 'starting' &&
    canonicalPosition(player.position) === canonicalTarget &&
    (!targetPosition || player.position === targetPosition);

  if (isAlreadyStartingSameSpot) {
    return { players: roster, updated: false, targetPosition: canonicalTarget };
  }

  const startersCount = roster.filter(p => p.squadRole === 'starting').length;
  const occupantIndex = roster.findIndex(
    candidate =>
      candidate.id !== playerId &&
      candidate.squadRole === 'starting' &&
      canonicalPosition(candidate.position) === canonicalTarget,
  );

  if (currentRole !== 'starting' && startersCount >= 11 && occupantIndex === -1) {
    return {
      players: roster,
      error: 'lk 11 dolu. Ayn mevkideki bir oyuncuyu karmadan yeni oyuncu ekleyemezsin.',
      updated: false,
    };
  }

  const updatedRoster = [...roster];
  let swappedPlayerId: string | null = null;
  updatedRoster[playerIndex] = {
    ...player,
    position: desiredPosition,
    squadRole: 'starting',
  };

  if (occupantIndex !== -1 && currentRole !== 'starting') {
    swappedPlayerId = roster[occupantIndex].id;
    updatedRoster[occupantIndex] = {
      ...roster[occupantIndex],
      squadRole: currentRole,
    };
  }

  return {
    players: normalizePlayers(updatedRoster),
    updated: true,
    swappedPlayerId,
    targetPosition: canonicalTarget,
  };
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
  const [selectedFormation, setSelectedFormation] = useState(formations[0].name);
  const [customFormations, setCustomFormations] = useState<CustomFormationState>({});

  const [draggedPlayerId, setDraggedPlayerId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'role' | 'overall' | 'potential'>('role');
  const [focusedPlayerId, setFocusedPlayerId] = useState<string | null>(null);
  const [comparisonPlayerId, setComparisonPlayerId] = useState<string | null>(null);

  const pitchRef = useRef<HTMLDivElement | null>(null);
  const dropHandledRef = useRef(false);


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

  const removePlayerFromCustomFormations = (playerId: string) => {
    setCustomFormations(prev => {
      let changed = false;
      const nextEntries: [string, Record<string, FormationPlayerPosition>][] = [];

      Object.entries(prev).forEach(([formationKey, layout]) => {
        if (!layout || typeof layout !== 'object') {
          return;
        }

        if (playerId in layout) {
          const { [playerId]: _removed, ...rest } = layout;
          changed = true;
          if (Object.keys(rest).length > 0) {
            nextEntries.push([
              formationKey,
              rest as Record<string, FormationPlayerPosition>,
            ]);
          }
        } else {
          nextEntries.push([formationKey, layout]);
        }
      });

      if (!changed) {
        return prev;
      }

      return Object.fromEntries(nextEntries) as CustomFormationState;
    });
  };

  const updatePlayerManualPosition = (
    formationName: string,
    playerId: string,
    data: FormationPlayerPosition,
  ) => {
    setCustomFormations(prev => {
      const currentFormation = prev[formationName] ?? {};
      const normalized: FormationPlayerPosition = {
        x: clampPercentageValue(data.x),
        y: clampPercentageValue(data.y),
        position: data.position,
      };

      const existing = currentFormation[playerId];
      if (
        existing &&
        existing.x === normalized.x &&
        existing.y === normalized.y &&
        existing.position === normalized.position
      ) {
        return prev;
      }

      return {
        ...prev,
        [formationName]: {
          ...currentFormation,
          [playerId]: normalized,
        },
      };
    });
  };

  const movePlayer = (playerId: string, newRole: Player['squadRole']) => {
    let errorMessage: string | null = null;
    let changed = false;
    let swappedPlayerId: string | null = null;

    setPlayers(prev => {
      const playerIndex = prev.findIndex(player => player.id === playerId);
      if (playerIndex === -1) {
        errorMessage = 'Oyuncu bulunamad.';
        return prev;
      }

      const player = prev[playerIndex];
      if (newRole === 'starting') {
        const result = promotePlayerToStartingRoster(prev, playerId);
        if (result.error) {
          errorMessage = result.error;
          return prev;
        }
        if (!result.updated) {
          return prev;
        }
        changed = true;
        swappedPlayerId = result.swappedPlayerId ?? null;
        return result.players;
      }

      if (player.squadRole === newRole) {
        return prev;
      }

      const next = [...prev];
      next[playerIndex] = {
        ...player,
        squadRole: newRole,
      };
      changed = true;
      return normalizePlayers(next);
    });

    if (errorMessage) {
      toast.error('lem tamamlanamad', { description: errorMessage });
    } else if (changed) {
      if (newRole !== 'starting') {
        removePlayerFromCustomFormations(playerId);
      } else if (swappedPlayerId) {
        removePlayerFromCustomFormations(swappedPlayerId);
      }
      toast.success('Oyuncu baaryla tand');
    }
  };

  const getPitchCoordinates = (clientX: number, clientY: number): FormationPlayerPosition | null => {
    const field = pitchRef.current;
    if (!field) {
      return null;
    }
    const rect = field.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }

    const relativeX = ((clientX - rect.left) / rect.width) * 100;
    const relativeY = ((clientY - rect.top) / rect.height) * 100;

    if (Number.isNaN(relativeX) || Number.isNaN(relativeY)) {
      return null;
    }

    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null;
    }

    return {
      x: clampPercentageValue(relativeX),
      y: clampPercentageValue(relativeY),
      position: 'CM',
    };
  };

  const handlePitchDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const playerId = e.dataTransfer.getData('text/plain') || draggedPlayerId;
    if (!playerId) {
      return;
    }

    const player = players.find(p => p.id === playerId);
    if (!player) {
      return;
    }

    const coordinates = getPitchCoordinates(e.clientX, e.clientY);
    if (!coordinates) {
      setDraggedPlayerId(null);
      return;
    }

    dropHandledRef.current = true;

    if (player.squadRole === 'starting') {
      updatePlayerManualPosition(selectedFormation, playerId, {
        x: coordinates.x,
        y: coordinates.y,
        position: player.position,
      });
      setFocusedPlayerId(playerId);
      toast.success('Oyuncu sahada yeniden konumlandırıldı');
      setDraggedPlayerId(null);
      return;
    }

    let errorMessage: string | null = null;
    let updated = false;
    let result: PromoteToStartingResult | null = null;

    setPlayers(prev => {
      const promotion = promotePlayerToStartingRoster(prev, playerId);
      result = promotion;
      if (promotion.error) {
        errorMessage = promotion.error;
        return prev;
      }
      if (!promotion.updated) {
        return prev;
      }
      updated = true;
      return promotion.players;
    });

    if (errorMessage) {
      toast.error('Oyuncu eklenemedi', { description: errorMessage });
    } else if (updated) {
      updatePlayerManualPosition(selectedFormation, playerId, {
        x: coordinates.x,
        y: coordinates.y,
        position: player.position,
      });
      if (result?.swappedPlayerId) {
        removePlayerFromCustomFormations(result.swappedPlayerId);
      }
      setFocusedPlayerId(playerId);
      toast.success('Oyuncu sahada konumlandırıldı');
    }

    setDraggedPlayerId(null);
  };

  const handlePlayerDragEnd = (
    event: React.DragEvent<HTMLDivElement>,
    player: Player,
  ) => {
    setDraggedPlayerId(null);
    if (dropHandledRef.current) {
      dropHandledRef.current = false;
      return;
    }

    if (player.squadRole !== 'starting') {
      return;
    }

    if (event.clientX === 0 && event.clientY === 0) {
      return;
    }

    const coordinates = getPitchCoordinates(event.clientX, event.clientY);
    if (!coordinates) {
      return;
    }

    updatePlayerManualPosition(selectedFormation, player.id, {
      x: coordinates.x,
      y: coordinates.y,
      position: player.position,
    });
  };

  const handleListForTransfer = (playerId: string) => {
    navigate('/transfer-market', { state: { listPlayerId: playerId } });
  };

  const handleReleasePlayer = (playerId: string) => {
    let removedName: string | null = null;
    removePlayerFromCustomFormations(playerId);
    setPlayers(prev => {
      const player = prev.find(p => p.id === playerId);
      if (!player) {
        return prev;
      }
      removedName = player.name;
      return prev.filter(p => p.id !== playerId);
    });
    if (removedName) {
      setFocusedPlayerId(current => (current === playerId ? null : current));
      toast.success(`${removedName} serbest brakld`, {
        description: 'Deiiklikleri kaydetmeyi unutmayn.',
      });
    }
  };

  const handleSave = async () => {
    if (!user) return;
    try {
      const collectIds = (role: Player['squadRole']) =>
        players
          .filter(p => p.squadRole === role && p.id)
          .map(p => String(p.id));

      const unique = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

      const starters = unique(collectIds('starting'));
      if (starters.length !== 11) {
        toast.error('Kadro tamamlanmadÄ±', {
          description: 'Kaydetmeden Ã¶nce 11 oyuncuyu ilk 11 olarak belirleyin.',
        });
        return;
      }

      const bench = unique(collectIds('bench')).filter(id => !starters.includes(id));
      const reserves = unique(collectIds('reserve')).filter(id => !starters.includes(id) && !bench.includes(id));

      const startersSet = new Set(starters);
      const customForSave = Object.fromEntries(
        Object.entries(customFormations).flatMap(([formationKey, layout]) => {
          if (!layout || typeof layout !== 'object') {
            return [];
          }
          const filteredEntries = Object.entries(layout).filter(([playerId]) =>
            startersSet.has(playerId),
          );
          if (filteredEntries.length === 0) {
            return [];
          }
          const sanitizedLayout = Object.fromEntries(
            filteredEntries.map(([playerId, value]) => [
              playerId,
              {
                x: clampPercentageValue(value.x),
                y: clampPercentageValue(value.y),
                position: value.position,
              },
            ]),
          );
          return [[formationKey, sanitizedLayout]];
        }),
      ) as CustomFormationState;

      // Persist full roster and snapshot locally for Firestore
      await saveTeamPlayers(user.id, players, {
        formation: selectedFormation,
        squads: {
          starters,
          bench,
          reserves,
        },
        customFormations:
          Object.keys(customForSave).length > 0 ? customForSave : undefined,
      });

      toast.success('Takım planı kaydedildi!');
    } catch (error) {
      console.error('[TeamPlanning] saveTeamPlayers failed', error);
      const description =
        error && typeof error === 'object' && 'details' in error && typeof (error as { details?: unknown }).details === 'string'
          ? String((error as { details?: unknown }).details)
          : error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
          ? String((error as { message?: unknown }).message)
          : 'Kadro kaydÄ± baÅŸarÄ±sÄ±z. LÃ¼tfen tekrar deneyin.';
      toast.error('Sunucu hatasÄ±', { description });
    }
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      let team = await getTeam(user.id);
      if (!team) {
        team = await createInitialTeam(user.id, user.teamName, user.teamName);
      }

      const normalized = normalizePlayers(team.players);
      setPlayers(normalized);

      const remoteFormation =
        team.plan?.formation || team.lineup?.formation || formations[0].name;
      setSelectedFormation(remoteFormation);

      const remoteCustomFormations = sanitizeCustomFormationState(
        team.plan?.customFormations || team.lineup?.customFormations || {},
      );
      setCustomFormations(remoteCustomFormations);
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

  useEffect(() => {
    if (players.length === 0) {
      return;
    }

    setCustomFormations(prev => {
      const startingIds = new Set(
        players.filter(player => player.squadRole === 'starting').map(player => player.id),
      );

      let changed = false;
      const next: CustomFormationState = {};

      Object.entries(prev).forEach(([formationKey, layout]) => {
        const filteredEntries = Object.entries(layout).filter(([playerId]) =>
          startingIds.has(playerId),
        );

        if (filteredEntries.length > 0) {
          next[formationKey] = Object.fromEntries(filteredEntries);
          if (filteredEntries.length !== Object.keys(layout).length) {
            changed = true;
          }
        } else if (Object.keys(layout).length > 0) {
          changed = true;
        }
      });

      if (!changed) {
        return prev;
      }

      return next;
    });
  }, [players]);

  const startingEleven = players.filter(p => p.squadRole === 'starting');
  const benchPlayers = players.filter(p => p.squadRole === 'bench');
  const reservePlayers = players.filter(p => p.squadRole === 'reserve');

  const currentFormation =
    formations.find(f => f.name === selectedFormation) ?? formations[0];

  const manualFormation = useMemo(
    () => customFormations[selectedFormation] ?? {},
    [customFormations, selectedFormation],
  );

  const formationPositions = useMemo(() => {
    const starters = players.filter(p => p.squadRole === 'starting');
    const slots = currentFormation.positions;

    if (starters.length === 0) {
      return slots.map((slot, idx) => ({ ...slot, player: null, slotIndex: idx }));
    }

    const startersById = new Map(starters.map(player => [player.id, player] as const));
    const remainingPlayerIds = new Set(starters.map(player => player.id));
    const slotAssignments = new Map<
      number,
      { player: Player; manual: FormationPlayerPosition | null }
    >();

    Object.entries(manualFormation).forEach(([playerId, manual]) => {
      const player = startersById.get(playerId);
      if (!player) {
        return;
      }

      const targetIndex = slots.findIndex((slot, idx) => {
        if (slotAssignments.has(idx)) {
          return false;
        }
        const canonicalSlot = canonicalPosition(slot.position);
        const manualPosition = manual?.position ?? player.position;
        return canonicalPosition(manualPosition) === canonicalSlot;
      });

      if (targetIndex === -1) {
        return;
      }

      slotAssignments.set(targetIndex, { player, manual });
      remainingPlayerIds.delete(playerId);
    });

    slots.forEach((slot, idx) => {
      if (slotAssignments.has(idx)) {
        return;
      }

      const canonicalSlot = canonicalPosition(slot.position);
      const matchingEntry = Array.from(remainingPlayerIds).find(playerId => {
        const candidate = startersById.get(playerId);
        if (!candidate) return false;
        const playerPosition = canonicalPosition(candidate.position);
        if (playerPosition === canonicalSlot) {
          return true;
        }
        return (candidate.roles ?? []).some(role => canonicalPosition(role) === canonicalSlot);
      });

      if (!matchingEntry) {
        return;
      }

      const player = startersById.get(matchingEntry);
      if (!player) {
        return;
      }

      slotAssignments.set(idx, { player, manual: null });
      remainingPlayerIds.delete(matchingEntry);
    });

    slots.forEach((slot, idx) => {
      if (slotAssignments.has(idx) || remainingPlayerIds.size === 0) {
        return;
      }

      const iterator = remainingPlayerIds.values().next();
      if (iterator.done) {
        return;
      }

      const player = startersById.get(iterator.value);
      remainingPlayerIds.delete(iterator.value);
      if (!player) {
        return;
      }

      slotAssignments.set(idx, { player, manual: null });
    });

    return slots.map((slot, idx) => {
      const assigned = slotAssignments.get(idx);
      if (!assigned) {
        return { ...slot, player: null, slotIndex: idx };
      }

      const { player, manual } = assigned;
      if (!manual) {
        return { ...slot, player, slotIndex: idx };
      }

      return {
        position: slot.position,
        x: clampPercentageValue(manual.x),
        y: clampPercentageValue(manual.y),
        player,
        slotIndex: idx,
      };
    });
  }, [currentFormation, manualFormation, players]);

  const selectedPlayer = useMemo(() => {
    if (!focusedPlayerId) return null;
    return players.find(p => p.id === focusedPlayerId) ?? null;
  }, [players, focusedPlayerId]);

  const selectedPower = selectedPlayer ? getPlayerPower(selectedPlayer) : 0;

  const alternativePlayers = useMemo(() => {
    if (!selectedPlayer) {
      return [] as Player[];
    }

    const target = canonicalPosition(selectedPlayer.position);

    return players.filter(player => {
      if (player.id === selectedPlayer.id) {
        return false;
      }
      if (player.squadRole !== 'bench' && player.squadRole !== 'reserve') {
        return false;
      }
      const primary = canonicalPosition(player.position);
      if (primary === target) {
        return true;
      }
      return (player.roles ?? []).some(role => canonicalPosition(role) === target);
    });
  }, [players, selectedPlayer]);

  const comparisonPlayer = useMemo(() => {
    if (!comparisonPlayerId) {
      return null;
    }
    return players.find(player => player.id === comparisonPlayerId) ?? null;
  }, [players, comparisonPlayerId]);

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
    slot: { position: Player['position']; x: number; y: number; slotIndex: number },
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const playerId = e.dataTransfer.getData('text/plain') || draggedPlayerId;
    if (!playerId) return;
    let errorMessage: string | null = null;
    let updated = false;
    let result: PromoteToStartingResult | null = null;
    setPlayers(prev => {
      const promotion = promotePlayerToStartingRoster(prev, playerId, slot.position);
      result = promotion;
      if (promotion.error) {
        errorMessage = promotion.error;
        return prev;
      }
      if (!promotion.updated) {
        return prev;
      }
      updated = true;
      return promotion.players;
    });

    if (errorMessage) {
      toast.error('Pozisyon gncellenemedi', { description: errorMessage });
    } else if (updated) {
      dropHandledRef.current = true;
      updatePlayerManualPosition(selectedFormation, playerId, {
        x: slot.x,
        y: slot.y,
        position: slot.position,
      });
      if (result?.swappedPlayerId) {
        removePlayerFromCustomFormations(result.swappedPlayerId);
      }
      setFocusedPlayerId(playerId);
      toast.success('Oyuncu ilk 11\'e tand');
    }
    setDraggedPlayerId(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
      {/* Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton />
            <h1 className="text-xl font-bold">TakÄ±m PlanÄ±</h1>
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
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
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
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="SÄ±rala" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="role">Role göre</SelectItem>
                <SelectItem value="overall">Ortalamaya göre</SelectItem>
                <SelectItem value="potential">Maks. potansiyel</SelectItem>
              </SelectContent>
            </Select>
            </div>
            </CardContent>
          </Card>

        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
          {/* Team Formation Overview */}
          <Card className="order-1 w-full lg:sticky lg:top-24 lg:z-30 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
            <CardHeader className="flex flex-col gap-3 border-b border-white/60 bg-white/70 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:bg-slate-900/80">
            <CardTitle className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              Formasyon  ({selectedFormation})
            </CardTitle>
            <Select value={selectedFormation} onValueChange={setSelectedFormation}>
              <SelectTrigger className="w-full md:w-40">
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
            <div className="flex flex-col gap-6 2xl:flex-row">
              <div className="relative z-10 w-full max-w-full flex-shrink-0">
                <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-gradient-to-b from-emerald-600 via-emerald-700 to-emerald-800 shadow-[0_20px_45px_-25px_rgba(16,80,40,0.8)] sm:aspect-[2/3] lg:aspect-[3/4]">
                  <div className="absolute inset-0 p-5">
                    <div
                      ref={pitchRef}
                      className="relative h-full w-full"
                      onDragOver={e => e.preventDefault()}
                      onDrop={handlePitchDrop}
                    >
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
                        {formationPositions.map(({ player, position, x, y, slotIndex }) => (
                          <div
                            key={slotIndex}
                            className="absolute text-center"
                            style={{
                              left: `${x}%`,
                              top: `${y}%`,
                              transform: 'translate(-50%, -50%)',
                            }}
                            onDragOver={e => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onDrop={e => handlePositionDrop(e, { position, x, y, slotIndex })}
                          >
                            {player ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className={cn(
                                      'flex h-16 w-16 items-center justify-center rounded-full border border-white/30 bg-white/85 px-2 text-[10px] font-semibold text-emerald-900 shadow transition-all duration-150 cursor-grab leading-tight text-center',
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
                                    onDragEnd={event => handlePlayerDragEnd(event, player)}
                                  >
                                    <span className="block max-h-[3rem] overflow-hidden text-ellipsis">
                                      {player.name}
                                    </span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent className="z-50 w-56 space-y-2">
                                  <div className="text-xs font-semibold">{player.name}</div>
                                  <PerformanceGauge label="Güç" value={getPlayerPower(player)} />
                                  <PerformanceGauge label="Kondisyon" value={getPlayerCondition(player)} />
                                  <PerformanceGauge label="Motivasyon" value={getPlayerMotivation(player)} />
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-white/50 bg-white/20 px-2 text-[10px] font-semibold uppercase tracking-wide text-white">
                                {position}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex-1 min-w-0 space-y-4">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-900/20 p-4 text-white shadow-inner backdrop-blur-sm">
                  {selectedPlayer ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-white/70">SeÃ§ili Oyuncu</p>
                          <h3 className="text-lg font-semibold">{selectedPlayer.name}</h3>
                          <p className="text-xs text-white/70">
                            {selectedPlayer.position} - GÃ¼Ã§ {Math.round(selectedPower * 100)}
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
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-wide text-white/70">Alternatifler</p>
                        {alternativePlayers.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {alternativePlayers.map(alternative => (
                              <button
                                key={alternative.id}
                                type="button"
                                onClick={() => setComparisonPlayerId(alternative.id)}
                                className="flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-white/15 px-2 text-[10px] font-semibold text-white transition hover:border-white/60"
                              >
                                <span className="line-clamp-2 leading-tight">{alternative.name}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-white/60">
                            Bu pozisyon için bench veya rezerv oyuncu yok.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="py-8 text-center text-sm text-white/70">
                      Formasyondaki bir oyuncuya tÄ±klayÄ±n.
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-emerald-200/40 bg-white/80 p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/70">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-emerald-700 dark:text-emerald-200">TakÄ±m NabzÄ±</h4>
                    <span className="text-xs text-muted-foreground">ilk 11 ortalamasÄ±</span>
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
        <div className="order-2 flex flex-col gap-4 min-w-0">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex w-full gap-2 overflow-x-auto sm:overflow-visible">
            <TabsTrigger value="starting" className="flex-none min-w-[140px] whitespace-nowrap sm:flex-1 sm:min-w-0 sm:w-auto">
              ilk 11 ({startingEleven.length})
            </TabsTrigger>
            <TabsTrigger value="bench" className="flex-none min-w-[140px] whitespace-nowrap sm:flex-1 sm:min-w-0 sm:w-auto">
              Yedek ({benchPlayers.length})
            </TabsTrigger>
            <TabsTrigger value="reserve" className="flex-none min-w-[140px] whitespace-nowrap sm:flex-1 sm:min-w-0 sm:w-auto">
              Rezerv ({reservePlayers.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="starting" className="space-y-4 mt-4">
            {sortedPlayers.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="text-4xl mb-4">&#9917;</div>
                  <h3 className="font-semibold mb-2">ilk 11'inizi oluÅŸturun</h3>
                  <p className="text-muted-foreground text-sm">
                    Yedek kulÃ¼besinden oyuncularÄ±nÄ±zÄ± ilk 11'e taÅŸÄ±yÄ±n
                  </p>
                </CardContent>
              </Card>
            ) : (
              sortedPlayers.map(player => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  compact
                  defaultCollapsed
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
                  <div className="text-4xl mb-4">&#9917;</div>
                  <h3 className="font-semibold mb-2">Yedek kulÃ¼besi boÅŸ</h3>
                  <p className="text-muted-foreground text-sm">
                    Rezervden oyuncularÄ±nÄ±zÄ± yedek kulÃ¼besine taÅŸÄ±yÄ±n
                  </p>
                </CardContent>
              </Card>
            ) : (
              sortedPlayers.map(player => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  compact
                  defaultCollapsed
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
        <div className="text-4xl mb-4">&#9917;</div>
        <h3 className="font-semibold mb-2">Rezerv oyuncu yok</h3>
        <p className="text-muted-foreground text-sm">
          Altyapıdan oyuncu transfer edin veya pazardan oyuncu satın alın
        </p>
      </CardContent>
    </Card>
            ) : (
              sortedPlayers.map(player => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  compact
                  defaultCollapsed
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
      <Dialog
        open={Boolean(comparisonPlayer)}
        onOpenChange={open => {
          if (!open) {
            setComparisonPlayerId(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{comparisonPlayer?.name}</DialogTitle>
          </DialogHeader>
          {comparisonPlayer ? (
            <PlayerCard
              player={comparisonPlayer}
              showActions={false}
              compact={false}
              defaultCollapsed={false}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}






