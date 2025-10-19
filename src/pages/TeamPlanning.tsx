import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlayerCard } from '@/components/ui/player-card';
import { PerformanceGauge, clampPerformanceGauge } from '@/components/ui/performance-gauge';
import { Player, CustomFormationMap } from '@/types';
import { getTeam, saveTeamPlayers, createInitialTeam } from '@/services/team';
import { completeLegendRental, getLegendIdFromPlayer } from '@/services/legends';
import { auth } from '@/services/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { Search, Save, Eye, ArrowDown, ArrowUp, X } from 'lucide-react';
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
import { calculatePowerIndex, formatRatingLabel, normalizeRatingTo100 } from '@/lib/player';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BackButton } from '@/components/ui/back-button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import '@/styles/nostalgia-theme.css';

const DEFAULT_GAUGE_VALUE = 0.75;

const PLAYER_RENAME_DIAMOND_COST = 45;
const PLAYER_RENAME_AD_COOLDOWN_HOURS = 24;
const CONTRACT_EXTENSION_MONTHS = 18;

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

const HOURS_IN_MS = 60 * 60 * 1000;

const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date);
  const targetMonth = result.getMonth() + months;
  result.setMonth(targetMonth);
  return result;
};

const getContractExpiration = (player: Player): Date | null => {
  if (!player.contract?.expiresAt) {
    return null;
  }
  const expires = new Date(player.contract.expiresAt);
  return Number.isNaN(expires.getTime()) ? null : expires;
};

const isContractExpired = (player: Player): boolean => {
  if (!player.contract || player.contract.status === 'released') {
    return false;
  }
  const expires = getContractExpiration(player);
  if (!expires) {
    return false;
  }
  return expires.getTime() <= Date.now();
};

const getRenameAdAvailability = (player: Player): Date | null => {
  if (!player.rename?.adAvailableAt) {
    return null;
  }
  const date = new Date(player.rename.adAvailableAt);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isRenameAdReady = (player: Player): boolean => {
  const next = getRenameAdAvailability(player);
  if (!next) {
    return true;
  }
  return next.getTime() <= Date.now();
};

function normalizePlayer(player: Player): Player {
  const fallbackContract = (): NonNullable<Player['contract']> => ({
    expiresAt: addMonths(new Date(), CONTRACT_EXTENSION_MONTHS).toISOString(),
    status: 'active',
    salary: player.contract?.salary ?? 0,
    extensions: player.contract?.extensions ?? 0,
  });

  const fallbackRename = (): NonNullable<Player['rename']> => {
    const details: NonNullable<Player['rename']> = {
      adAvailableAt: new Date(0).toISOString(),
    };

    if (player.rename?.lastUpdatedAt) {
      details.lastUpdatedAt = player.rename.lastUpdatedAt;
    }

    if (player.rename?.lastMethod === 'ad' || player.rename?.lastMethod === 'purchase') {
      details.lastMethod = player.rename.lastMethod;
    }

    return details;
  };

  return {
    ...player,
    condition: clampPerformanceGauge(player.condition, DEFAULT_GAUGE_VALUE),
    motivation: clampPerformanceGauge(player.motivation, DEFAULT_GAUGE_VALUE),
    injuryStatus: player.injuryStatus ?? 'healthy',
    contract: player.contract ?? fallbackContract(),
    rename: player.rename ?? fallbackRename(),
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

type FormationSnapshot = {
  player: Player | null;
  x: number;
  y: number;
};

const LINE_GROUP_TOLERANCE = 10;

const deriveFormationShape = (positions: FormationSnapshot[]): string | null => {
  const outfieldY = positions
    .filter(entry => entry.player && canonicalPosition(entry.player.position) !== 'GK')
    .map(entry => clampPercentageValue(entry.y))
    .sort((a, b) => b - a);

  if (outfieldY.length === 0) {
    return null;
  }

  const groups: { count: number; average: number }[] = [];

  outfieldY.forEach(value => {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && Math.abs(lastGroup.average - value) <= LINE_GROUP_TOLERANCE) {
      const nextCount = lastGroup.count + 1;
      lastGroup.average = (lastGroup.average * lastGroup.count + value) / nextCount;
      lastGroup.count = nextCount;
      return;
    }

    groups.push({ count: 1, average: value });
  });

  const counts = groups.map(group => group.count).filter(count => count > 0);
  if (counts.length === 0) {
    return null;
  }

  const totalOutfield = counts.reduce((sum, current) => sum + current, 0);
  if (totalOutfield === 0) {
    return null;
  }

  return counts.join('-');
};

type AlternativePlayerBubbleProps = {
  player: Player;
  onSelect: (playerId: string) => void;
  variant?: 'pitch' | 'panel';
  compareToPlayer?: Player | null;
};

const STRENGTH_DIFF_EPSILON = 0.1;

const AlternativePlayerBubble: React.FC<AlternativePlayerBubbleProps> = ({
  player,
  onSelect,
  variant = 'pitch',
  compareToPlayer,
}) => {
  const badgeLabel =
    player.squadRole === 'bench'
      ? 'YDK'
      : player.squadRole === 'reserve'
        ? 'RZV'
        : 'KDR';
  const badgeTitle =
    player.squadRole === 'bench'
      ? 'Yedek'
      : player.squadRole === 'reserve'
        ? 'Rezerv'
        : 'Kadrodışı';

  const comparisonPower = compareToPlayer ? getPlayerPower(compareToPlayer) : null;
  const playerPower = getPlayerPower(player);
  const powerDiff = comparisonPower === null ? 0 : playerPower - comparisonPower;
  const showStrengthIndicator =
    comparisonPower !== null && Math.abs(powerDiff) > STRENGTH_DIFF_EPSILON;
  const isStronger = showStrengthIndicator && powerDiff > 0;
  const positionLabel = canonicalPosition(player.position);

  const variantClasses =
    variant === 'panel'
      ? 'border-white/20 bg-white/10 text-white hover:border-white/50 hover:bg-white/15'
      : 'border-white/25 bg-white/5 text-white/95 hover:border-white/50 hover:bg-white/10 backdrop-blur-sm';

  return (
    <div className="nostalgia-screen nostalgia-team-planning">
      <div className="nostalgia-screen__gradient" aria-hidden />
      <div className="nostalgia-screen__orb nostalgia-screen__orb--left" aria-hidden />
      <div className="nostalgia-screen__orb nostalgia-screen__orb--right" aria-hidden />
      <div className="nostalgia-screen__noise" aria-hidden />
      <div className="nostalgia-screen__content">
        <header className="nostalgia-main-menu__header nostalgia-team-planning__header">
          <div className="nostalgia-team-planning__header-title">
            <BackButton />
            <div>
              <h1 className="nostalgia-main-menu__title">Takım Planı</h1>
              <p className="nostalgia-main-menu__subtitle">
                Kadronuzu düzenleyin, formasyonunuzu şekillendirin.
              </p>
            </div>
          </div>
          <div className="nostalgia-team-planning__header-actions">
            <Button variant="outline" size="sm">
              <Eye className="mr-2 h-4 w-4" />
              Formasyon
            </Button>
            <Button onClick={handleSave}>
              <Save className="mr-2 h-4 w-4" />
              Kaydet
            </Button>
          </div>
        </header>

        <div className="nostalgia-team-planning__stage">
          <div className="nostalgia-main-menu__stage nostalgia-main-menu__stage--mobile">
            <div className="nostalgia-main-menu__slide nostalgia-team-planning__slide nostalgia-team-planning__slide--pitch">
              <div className="nostalgia-team-planning__slide-inner">
                <div className="nostalgia-team-planning__pitch-layout">
                  <Card className="nostalgia-team-planning__pitch-card">
                    <CardHeader className="flex flex-col gap-3 border-b border-white/60 bg-white/70 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:bg-slate-900/80">
                      <CardTitle className="flex items-center gap-3">
                        <div className="h-3 w-3 rounded-full bg-green-500" />
                        <div className="flex flex-col text-left">
                          <span>Formasyon</span>
                          <span className="text-sm font-normal text-emerald-900 dark:text-emerald-100">
                            {displayFormationName}
                          </span>
                          {manualShapeDiffers ? (
                            <span className="text-xs font-normal text-emerald-700 dark:text-emerald-200/80">
                              Şablon: {selectedFormation}
                            </span>
                          ) : null}
                        </div>
                      </CardTitle>
                      <Select value={selectedFormation} onValueChange={setSelectedFormation}>
                        <SelectTrigger className="w-full md:w-40" aria-label="Formasyon">
                          <span className="truncate">{displayFormationName}</span>
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
                      <div className="relative">
                        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-gradient-to-b from-emerald-600 via-emerald-700 to-emerald-800 shadow-[0_20px_45px_-25px_rgba(16,80,40,0.8)] sm:aspect-[2/3] lg:aspect-[3/4]">
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
                                          <PitchPlayerMarker
                                            player={player}
                                            isFocused={player.id === focusedPlayerId}
                                            onSelect={() => setFocusedPlayerId(player.id)}
                                            onDragStart={event => {
                                              setDraggedPlayerId(player.id);
                                              event.dataTransfer.setData('text/plain', player.id);
                                            }}
                                            onDragEnd={event => handlePlayerDragEnd(event, player)}
                                          />
                                        </TooltipTrigger>
                                        <TooltipContent className="z-50 w-56 space-y-2">
                                          <div className="text-xs font-semibold">{player.name}</div>
                                          <PerformanceGauge label="Güç" value={getPlayerPower(player)} />
                                          <PerformanceGauge label="Kondisyon" value={getPlayerCondition(player)} />
                                          <PerformanceGauge label="Motivasyon" value={getPlayerMotivation(player)} />
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      <div className="flex h-[3.6rem] w-[3.6rem] items-center justify-center rounded-full border border-dashed border-white/50 bg-white/20 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-white">
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
                    </CardContent>
                  </Card>
                  <div className="nostalgia-team-planning__alternatives">
                    {selectedPlayer ? (
                      <Card className="nostalgia-team-planning__alternatives-card border-emerald-200/20 bg-emerald-900/10 shadow-lg backdrop-blur">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-semibold text-emerald-50">
                            {canonicalPosition(selectedPlayer.position)} için alternatifler
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {alternativePlayers.length > 0 ? (
                            <div className="grid gap-2 sm:grid-cols-2">
                              {alternativePlayers.map(alternative => (
                                <AlternativePlayerBubble
                                  key={alternative.id}
                                  player={alternative}
                                  onSelect={playerId => handleAlternativeSelection(playerId)}
                                  variant="panel"
                                  compareToPlayer={selectedPlayer}
                                />
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-emerald-100/80">
                              Bu pozisyon için yedek veya rezerv oyuncu bulunmadı.
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    ) : (
                      <Card className="nostalgia-team-planning__alternatives-card nostalgia-team-planning__alternatives-card--empty border-emerald-200/10 bg-emerald-900/20 shadow-lg backdrop-blur">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-semibold text-emerald-100">
                            Alternatif oyuncular
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm text-emerald-100/80">
                          <p>Krokide bir oyuncuya tıklayın.</p>
                          <p>Alternatifler burada gösterilecek.</p>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="nostalgia-main-menu__slide nostalgia-main-menu__slide--actions nostalgia-team-planning__slide nostalgia-team-planning__slide--lists">
              <div className="nostalgia-team-planning__slide-inner">
                <Card className="shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
                        <Input
                          placeholder="Oyuncu ara..."
                          value={searchTerm}
                          onChange={event => setSearchTerm(event.target.value)}
                          className="pl-10"
                        />
                      </div>
                      <Select
                        value={sortBy}
                        onValueChange={value => setSortBy(value as 'role' | 'overall' | 'potential')}
                      >
                        <SelectTrigger className="w-full md:w-40">
                          <SelectValue placeholder="Sırala" />
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
                <div className="nostalgia-team-planning__lists">
                  <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="flex w-full gap-2 overflow-x-auto sm:overflow-visible">
                      <TabsTrigger value="starting" className="flex-none min-w-[140px] whitespace-nowrap sm:flex-1 sm:min-w-0 sm:w-auto">
                        İlk 11 ({startingEleven.length})
                      </TabsTrigger>
                      <TabsTrigger value="bench" className="flex-none min-w-[140px] whitespace-nowrap sm:flex-1 sm:min-w-0 sm:w-auto">
                        Yedek ({benchPlayers.length})
                      </TabsTrigger>
                      <TabsTrigger value="reserve" className="flex-none min-w-[140px] whitespace-nowrap sm:flex-1 sm:min-w-0 sm:w-auto">
                        Rezerv ({reservePlayers.length})
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="starting" className="mt-4 space-y-4">
                      {sortedPlayers.length === 0 ? (
                        <Card>
                          <CardContent className="p-8 text-center">
                            <div className="mb-4 text-4xl">⚽</div>
                            <h3 className="mb-2 font-semibold">İlk 11'inizi oluşturun</h3>
                            <p className="text-sm text-muted-foreground">
                              Yedek kulübesinden oyuncularınızı ilk 11'e taşıyın
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
                            onDragStart={event => {
                              setDraggedPlayerId(player.id);
                              event.dataTransfer.setData('text/plain', player.id);
                            }}
                            onDragEnd={() => setDraggedPlayerId(null)}
                            onMoveToBench={() => movePlayer(player.id, 'bench')}
                            onMoveToReserve={() => movePlayer(player.id, 'reserve')}
                            onListForTransfer={() => handleListForTransfer(player.id)}
                            onRenamePlayer={() => setRenamePlayerId(player.id)}
                            onFirePlayer={() => handleFirePlayer(player.id)}
                          />
                        ))
                      )}
                    </TabsContent>
                    <TabsContent value="bench" className="mt-4 space-y-4">
                      {sortedPlayers.length === 0 ? (
                        <Card>
                          <CardContent className="p-8 text-center">
                            <div className="mb-4 text-4xl">⚽</div>
                            <h3 className="mb-2 font-semibold">Yedek kulübesi boş</h3>
                            <p className="text-sm text-muted-foreground">
                              Rezervden oyuncularınızı yedek kulübesine taşıyın
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
                            onDragStart={event => {
                              setDraggedPlayerId(player.id);
                              event.dataTransfer.setData('text/plain', player.id);
                            }}
                            onDragEnd={() => setDraggedPlayerId(null)}
                            onMoveToStarting={() => movePlayer(player.id, 'starting')}
                            onMoveToReserve={() => movePlayer(player.id, 'reserve')}
                            onListForTransfer={() => handleListForTransfer(player.id)}
                            onRenamePlayer={() => setRenamePlayerId(player.id)}
                            onFirePlayer={() => handleFirePlayer(player.id)}
                          />
                        ))
                      )}
                    </TabsContent>
                    <TabsContent value="reserve" className="mt-4 space-y-4">
                      {sortedPlayers.length === 0 ? (
                        <Card>
                          <CardContent className="p-8 text-center">
                            <div className="mb-4 text-4xl">⚽</div>
                            <h3 className="mb-2 font-semibold">Rezerv oyuncu yok</h3>
                            <p className="text-sm text-muted-foreground">
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
                            onDragStart={event => {
                              setDraggedPlayerId(player.id);
                              event.dataTransfer.setData('text/plain', player.id);
                            }}
                            onDragEnd={() => setDraggedPlayerId(null)}
                            onMoveToStarting={() => movePlayer(player.id, 'starting')}
                            onMoveToBench={() => movePlayer(player.id, 'bench')}
                            onListForTransfer={() => handleListForTransfer(player.id)}
                            onRenamePlayer={() => setRenamePlayerId(player.id)}
                            onFirePlayer={() => handleFirePlayer(player.id)}
                          />
                        ))
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>


      <Dialog
        open={Boolean(renamePlayer)}
        onOpenChange={open => {
          if (!open) {
            setRenamePlayerId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Oyuncu Adını Özelleştir</DialogTitle>
            <DialogDescription>
              {renamePlayer
                ? `${renamePlayer.name} için yeni bir isim belirleyin.`
                : 'Oyuncu adını güncelleyin.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={renameInput}
              onChange={event => setRenameInput(event.target.value)}
              placeholder="Yeni oyuncu adı"
              disabled={isRenamingPlayer}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Reklam seçeneği {PLAYER_RENAME_AD_COOLDOWN_HOURS} saatte bir kullanılabilir. Elmas seçeneği {PLAYER_RENAME_DIAMOND_COST} elmas
              harcar. Bakiyeniz: {balance}
            </p>
            {!isRenameAdAvailable && renameAdAvailableAt && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Bir sonraki reklam hakkı {renameAdAvailableAt.toLocaleString('tr-TR')} tarihinde yenilenecek.
              </p>
            )}
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              disabled={!isRenameAdAvailable || isRenamingPlayer}
              onClick={() => handleRenamePlayer('ad')}
            >
              Reklam İzle ve Aç
            </Button>
            <Button disabled={isRenamingPlayer} onClick={() => handleRenamePlayer('purchase')}>
              {PLAYER_RENAME_DIAMOND_COST} Elmasla Onayla
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(activeContractPlayer)} onOpenChange={() => {}}>
        <DialogContent
          className="sm:max-w-md"
          onInteractOutside={event => event.preventDefault()}
          onEscapeKeyDown={event => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Sözleşme Yenileme Kararı</DialogTitle>
            <DialogDescription>
              {activeContractPlayer
                ? `${activeContractPlayer.name} için sözleşme süresi doldu.`
                : 'Sözleşme süresi dolan oyuncu bulunamadı.'}
            </DialogDescription>
          </DialogHeader>
          {activeContractPlayer ? (
            <div className="space-y-3">
              <div className="rounded-md border border-muted bg-muted/40 p-3 text-sm">
                <p>Bitiş Tarihi: {getContractExpiration(activeContractPlayer)?.toLocaleDateString('tr-TR') ?? '-'}</p>
                <p>Mevcut Rol: {activeContractPlayer.squadRole}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {getLegendIdFromPlayer(activeContractPlayer) !== null
                  ? 'Bu nostalji efsanesinin sözleşmesi uzatılamaz. Süre dolduğunda oyuncu otomatik olarak kulüpten ayrılır.'
                  : 'Sözleşmeyi uzatırsanız oyuncu takımda kalmaya devam eder. Aksi halde serbest bırakılarak transfer listesine düşer.'}
              </p>
            </div>
          ) : null}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            {activeContractPlayer && (
              <Button
                variant="secondary"
                disabled={isProcessingContract}
                onClick={() => handleReleaseContract(activeContractPlayer.id)}
              >
                Serbest Bırak
              </Button>
            )}
            {activeContractPlayer && getLegendIdFromPlayer(activeContractPlayer) === null && (
              <Button
                disabled={isProcessingContract}
                onClick={() => handleExtendContract(activeContractPlayer.id)}
              >
                Sözleşmeyi Uzat
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}







