import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import { formatContractCountdown } from '@/lib/contracts';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BackButton } from '@/components/ui/back-button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Pitch, { type PitchSlot } from '@/features/team-planning/Pitch';
import {
  TeamPlanningProvider,
  useTeamPlanningStore,
  type PlayerPosition as StorePlayerPosition,
  type MetricKey,
} from '@/features/team-planning/useTeamPlanningStore';
import './team-planning.css';
import './TeamPlanningSizing.css';

const DEFAULT_GAUGE_VALUE = 0.75;

const PLAYER_RENAME_DIAMOND_COST = 45;
const PLAYER_RENAME_AD_COOLDOWN_HOURS = 24;
const CONTRACT_EXTENSION_MONTHS = 18;

const metricOptions: Array<{ key: MetricKey; label: string }> = [
  { key: 'power', label: 'GÜÇ' },
  { key: 'motivation', label: 'MOTİVASYON' },
  { key: 'condition', label: 'KONDİSYON' },
];

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

type PlayerBaseline = {
  naturalPosition: Player['position'];
  naturalOverall: number;
};

type DisplayPlayer = Player & {
  originalOverall: number;
  assignedOverall: number;
  isOutOfPosition: boolean;
};

const POSITION_ATTRIBUTE_WEIGHTS: Record<Player['position'], Record<keyof Player['attributes'], number>> = {
  GK: { strength: 0.15, acceleration: 0.05, topSpeed: 0.05, dribbleSpeed: 0.05, jump: 0.2, tackling: 0.1, ballKeeping: 0.15, passing: 0.1, longBall: 0.05, agility: 0.05, shooting: 0, shootPower: 0.05, positioning: 0.05, reaction: 0.1, ballControl: 0.05 },
  CB: { strength: 0.25, acceleration: 0.1, topSpeed: 0.05, dribbleSpeed: 0, jump: 0.2, tackling: 0.25, ballKeeping: 0, passing: 0.05, longBall: 0.1, agility: 0.05, shooting: 0, shootPower: 0, positioning: 0.15, reaction: 0.15, ballControl: 0.05 },
  LB: { strength: 0.15, acceleration: 0.2, topSpeed: 0.15, dribbleSpeed: 0.1, jump: 0.05, tackling: 0.2, ballKeeping: 0, passing: 0.1, longBall: 0.1, agility: 0.1, shooting: 0, shootPower: 0, positioning: 0.05, reaction: 0.1, ballControl: 0.05 },
  RB: { strength: 0.15, acceleration: 0.2, topSpeed: 0.15, dribbleSpeed: 0.1, jump: 0.05, tackling: 0.2, ballKeeping: 0, passing: 0.1, longBall: 0.1, agility: 0.1, shooting: 0, shootPower: 0, positioning: 0.05, reaction: 0.1, ballControl: 0.05 },
  CM: { strength: 0.1, acceleration: 0.1, topSpeed: 0.05, dribbleSpeed: 0.15, jump: 0, tackling: 0.15, ballKeeping: 0.05, passing: 0.2, longBall: 0.15, agility: 0.15, shooting: 0.05, shootPower: 0.05, positioning: 0.1, reaction: 0.1, ballControl: 0.2 },
  LM: { strength: 0.05, acceleration: 0.2, topSpeed: 0.15, dribbleSpeed: 0.2, jump: 0, tackling: 0.05, ballKeeping: 0, passing: 0.2, longBall: 0.1, agility: 0.15, shooting: 0.1, shootPower: 0.05, positioning: 0.05, reaction: 0.05, ballControl: 0.25 },
  RM: { strength: 0.05, acceleration: 0.2, topSpeed: 0.15, dribbleSpeed: 0.2, jump: 0, tackling: 0.05, ballKeeping: 0, passing: 0.2, longBall: 0.1, agility: 0.15, shooting: 0.1, shootPower: 0.05, positioning: 0.05, reaction: 0.05, ballControl: 0.25 },
  CAM: { strength: 0.05, acceleration: 0.15, topSpeed: 0.1, dribbleSpeed: 0.2, jump: 0, tackling: 0.05, ballKeeping: 0, passing: 0.25, longBall: 0.1, agility: 0.15, shooting: 0.2, shootPower: 0.15, positioning: 0.1, reaction: 0.1, ballControl: 0.25 },
  LW: { strength: 0.05, acceleration: 0.25, topSpeed: 0.2, dribbleSpeed: 0.2, jump: 0, tackling: 0, ballKeeping: 0, passing: 0.15, longBall: 0.05, agility: 0.2, shooting: 0.25, shootPower: 0.2, positioning: 0.1, reaction: 0.05, ballControl: 0.25 },
  RW: { strength: 0.05, acceleration: 0.25, topSpeed: 0.2, dribbleSpeed: 0.2, jump: 0, tackling: 0, ballKeeping: 0, passing: 0.15, longBall: 0.05, agility: 0.2, shooting: 0.25, shootPower: 0.2, positioning: 0.1, reaction: 0.05, ballControl: 0.25 },
  ST: { strength: 0.15, acceleration: 0.2, topSpeed: 0.25, dribbleSpeed: 0.15, jump: 0.05, tackling: 0, ballKeeping: 0, passing: 0.1, longBall: 0.05, agility: 0.1, shooting: 0.25, shootPower: 0.25, positioning: 0.2, reaction: 0.1, ballControl: 0.15 },
};

const DEFAULT_WEIGHTS = Object.fromEntries(
  Object.keys(POSITION_ATTRIBUTE_WEIGHTS.ST).map(key => [key, 1]),
) as Record<keyof Player['attributes'], number>;

const getPositionAttributeWeights = (position: Player['position']) =>
  POSITION_ATTRIBUTE_WEIGHTS[position] || DEFAULT_WEIGHTS;

const computePositionOverall = (
  position: Player['position'],
  attributes: Player['attributes'],
): number => {
  const weights = getPositionAttributeWeights(position);
  let totalWeight = 0;
  let score = 0;
  for (const [key, weight] of Object.entries(weights) as Array<
    [keyof Player['attributes'], number]
  >) {
    const value = attributes[key];
    if (!Number.isFinite(value)) continue;
    score += (value * weight);
    totalWeight += weight;
  }
  if (totalWeight === 0) return 0;
  return parseFloat((score / totalWeight).toFixed(2));
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

function buildDisplayPlayer(player: Player, baseline?: PlayerBaseline): DisplayPlayer {
  const baselinePosition = canonicalPosition(baseline?.naturalPosition ?? player.position);
  const canonicalAssigned = canonicalPosition(player.position);
  const allowedPositions = new Set<Player['position']>(
    (player.roles ?? [player.position]).map(role => canonicalPosition(role)),
  );
  if (allowedPositions.size === 0) {
    allowedPositions.add(baselinePosition);
  }

  const originalOverall = baseline?.naturalOverall ?? player.overall;
  const isOutOfPosition = player.squadRole === 'starting' && !allowedPositions.has(canonicalAssigned);
  const computedOverall = isOutOfPosition
    ? Math.max(0, Math.min(originalOverall, computePositionOverall(canonicalAssigned, player.attributes)))
    : originalOverall;

  return {
    ...player,
    overall: computedOverall,
    originalOverall,
    assignedOverall: computedOverall,
    isOutOfPosition,
  };
}

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

type PromotePlayerOptions = {
  targetPlayerId?: string | null;
};

function promotePlayerToStartingRoster(
  roster: Player[],
  playerId: string,
  targetPosition?: Player['position'],
  options: PromotePlayerOptions = {},
): PromoteToStartingResult {
  const playerIndex = roster.findIndex(player => player.id === playerId);
  if (playerIndex === -1) {
    return { players: roster, error: 'Oyuncu bulunamad.', updated: false };
  }

  const player = roster[playerIndex];
  const currentRole = player.squadRole;
  const targetPlayerId = options.targetPlayerId && options.targetPlayerId !== playerId
    ? options.targetPlayerId
    : null;

  let occupantIndex = -1;
  if (targetPlayerId) {
    occupantIndex = roster.findIndex(
      candidate =>
        candidate.id === targetPlayerId && candidate.squadRole === 'starting',
    );
  }

  if (occupantIndex === -1) {
    occupantIndex = roster.findIndex(
      candidate =>
        candidate.id !== playerId &&
        candidate.squadRole === 'starting' &&
        canonicalPosition(candidate.position) === canonicalPosition(targetPosition ?? player.position),
    );
  }

  const occupant = occupantIndex !== -1 ? roster[occupantIndex] : null;
  const resolvedTargetPosition =
    targetPosition ?? (occupant ? occupant.position : player.position);
  const canonicalTarget = canonicalPosition(resolvedTargetPosition);
  const isAlreadyStartingSameSpot =
    currentRole === 'starting' &&
    canonicalPosition(player.position) === canonicalTarget &&
    (!targetPosition || player.position === resolvedTargetPosition) &&
    (!occupant || occupant.id === player.id);

  if (isAlreadyStartingSameSpot) {
    return { players: roster, updated: false, targetPosition: canonicalTarget };
  }

  const startersCount = roster.filter(p => p.squadRole === 'starting').length;

  if (currentRole !== 'starting' && startersCount >= 11 && occupantIndex === -1) {
    return {
      players: roster,
      error: 'lk 11 dolu. Ayn mevkideki bir oyuncuyu karmadan yeni oyuncu ekleyemezsin.',
      updated: false,
    };
  }

  const updatedRoster = [...roster];
  let swappedPlayerId: string | null = null;
  const previousPosition = player.position;
  updatedRoster[playerIndex] = {
    ...player,
    position: resolvedTargetPosition,
    squadRole: 'starting',
  };

  if (occupantIndex !== -1 && occupant) {
    swappedPlayerId = occupant.id;
    if (currentRole === 'starting') {
      updatedRoster[occupantIndex] = {
        ...occupant,
        position: previousPosition,
        squadRole: 'starting',
      };
    } else {
      updatedRoster[occupantIndex] = {
        ...occupant,
        squadRole: currentRole,
      };
    }
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
  player: DisplayPlayer;
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

  const rootClasses = cn(
    'tp-alternative-card group relative flex w-full items-start gap-3 rounded-2xl border px-3 py-2 text-left text-[11px] font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:px-[0.875rem] sm:py-[0.625rem]',
    variant === 'panel'
      ? 'tp-alternative-card--panel border-white/20 bg-white/10 text-white hover:border-white/50 hover:bg-white/15'
      : 'border-white/25 bg-white/5 text-white/95 hover:border-white/50 hover:bg-white/10 backdrop-blur-sm',
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={() => onSelect(player.id)} className={rootClasses}>
          <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-emerald-300/90 to-emerald-500 px-2 text-emerald-950 shadow-sm">
            <span className="line-clamp-2 w-full break-normal text-center text-[9.5px] font-semibold leading-tight">
              {player.name}
            </span>
            <span className="absolute bottom-0 right-0 rounded-tl-lg bg-emerald-900/90 px-1 text-[8.5px] font-semibold uppercase text-emerald-100 shadow-lg">
              {badgeLabel}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-white/70">
              <span className="font-semibold uppercase tracking-wide text-white/80">{positionLabel}</span>
              <span>{player.age} yaş</span>
              <span className="font-semibold text-white/80">GEN {formatRatingLabel(player.overall)}</span>
              {player.originalOverall > player.assignedOverall ? (
                <span className="text-[10px] uppercase tracking-wide text-emerald-200">
                  Orj: {formatRatingLabel(player.originalOverall)}
                </span>
              ) : null}
              {showStrengthIndicator ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-tight shadow-sm',
                    isStronger
                      ? 'bg-emerald-400/90 text-emerald-950'
                      : 'bg-rose-400/90 text-rose-950',
                  )}
                >
                  {isStronger ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  {Math.abs(powerDiff).toFixed(1)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="hidden flex-col items-end text-[10px] font-semibold text-white/60 sm:flex">
            <span className="uppercase tracking-wide">{badgeTitle}</span>
            <span className="text-white/40">#{player.squadRole === 'bench' ? '02' : player.squadRole === 'reserve' ? '03' : '04'}</span>
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent className="z-50 space-y-1">
        <div className="text-xs font-semibold">{player.name}</div>
        <div className="text-[11px] text-muted-foreground">{badgeTitle}</div>
      </TooltipContent>
    </Tooltip>
  );
};

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

function TeamPlanningContent() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { balance, spend } = useDiamonds();
  const [players, setPlayers] = useState<Player[]>([]);
  const playerBaselineRef = useRef<Record<string, PlayerBaseline>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('starting');
  const [selectedFormation, setSelectedFormation] = useState(formations[0].name);
  const [customFormations, setCustomFormations] = useState<CustomFormationState>({});

  const [draggedPlayerId, setDraggedPlayerId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'role' | 'overall' | 'potential'>('role');
  const [focusedPlayerId, setFocusedPlayerId] = useState<string | null>(null);
  const [savedFormationShape, setSavedFormationShape] = useState<string | null>(null);
  const [renamePlayerId, setRenamePlayerId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [isRenamingPlayer, setIsRenamingPlayer] = useState(false);
  const [pendingContractIds, setPendingContractIds] = useState<string[]>([]);
  const [activeContractId, setActiveContractId] = useState<string | null>(null);
  const [isProcessingContract, setIsProcessingContract] = useState(false);

  const pitchRef = useRef<HTMLDivElement | null>(null);
  const dropHandledRef = useRef(false);
  const handledContractsRef = useRef<Set<string>>(new Set());
  const rightPaneScrollRef = useRef<HTMLDivElement | null>(null);
  const [isRightHeaderCollapsed, setIsRightHeaderCollapsed] = useState(false);
  const teamLeagueIdRef = useRef<string | null>(null);

  const {
    selectedMetric,
    setSelectedMetric,
    setPlayerPositions,
    updateFormationFromPositions,
    registerFormationUpdater,
  } = useTeamPlanningStore();

  useEffect(() => {
    players.forEach(player => {
      if (playerBaselineRef.current[player.id]) {
        return;
      }
      playerBaselineRef.current[player.id] = {
        naturalPosition: player.position,
        naturalOverall: player.overall,
      };
    });
  }, [players]);

  const displayPlayers = useMemo(
    () =>
      players.map(player =>
        buildDisplayPlayer(player, playerBaselineRef.current[player.id]),
      ),
    [players],
  );


  const applyFormationPositions = useCallback(
    (positions: Record<string, StorePlayerPosition>) => {
      setCustomFormations(prev => {
        const entries = Object.entries(positions);
        if (entries.length === 0) {
          if (!(selectedFormation in prev)) {
            return prev;
          }
          const { [selectedFormation]: _removed, ...rest } = prev;
          return rest;
        }

        const layout = entries.reduce<Record<string, FormationPlayerPosition>>(
          (acc, [playerId, value]) => {
            acc[playerId] = {
              x: clampPercentageValue(value.x),
              y: clampPercentageValue(value.y),
              position: value.position,
            };
            return acc;
          },
          {},
        );

        if (
          prev[selectedFormation] &&
          Object.entries(prev[selectedFormation]).length === entries.length &&
          entries.every(([playerId, value]) => {
            const current = prev[selectedFormation]?.[playerId];
            return (
              current &&
              current.x === clampPercentageValue(value.x) &&
              current.y === clampPercentageValue(value.y) &&
              current.position === value.position
            );
          })
        ) {
          return prev;
        }

        return {
          ...prev,
          [selectedFormation]: layout,
        };
      });
    },
    [selectedFormation],
  );

  useEffect(() => {
    registerFormationUpdater(applyFormationPositions);
  }, [registerFormationUpdater, applyFormationPositions]);

  const handleRightPaneScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const collapsed = event.currentTarget.scrollTop >= 24;
      setIsRightHeaderCollapsed(previous =>
        previous === collapsed ? previous : collapsed,
      );
    },
    [],
  );

  useEffect(() => {
    const container = rightPaneScrollRef.current;
    if (!container) {
      return;
    }
    setIsRightHeaderCollapsed(container.scrollTop >= 24);
  }, []);


  const filteredPlayers = displayPlayers.filter(
    player =>
      player.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      player.squadRole === activeTab,
  );

  const getRatingAnnotation = useCallback(
    (player: DisplayPlayer) =>
      player.originalOverall > player.assignedOverall
        ? `Orj: ${formatRatingLabel(player.originalOverall)}`
        : undefined,
    [],
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

  const renamePlayer = useMemo(
    () => displayPlayers.find(player => player.id === renamePlayerId) ?? null,
    [displayPlayers, renamePlayerId],
  );

  const activeContractPlayer = useMemo(
    () => displayPlayers.find(player => player.id === activeContractId) ?? null,
    [displayPlayers, activeContractId],
  );

  const isRenameAdAvailable = renamePlayer ? isRenameAdReady(renamePlayer) : true;
  const renameAdAvailableAt = renamePlayer
    ? getRenameAdAvailability(renamePlayer)
    : null;

  const [manualSlotPositions, setManualSlotPositions] = useState<Record<string, FormationPlayerPosition>>({});

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
    setManualSlotPositions(prev => {
      if (!(playerId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[playerId];
      return next;
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

  const finalizeContractDecision = (playerId: string) => {
    handledContractsRef.current.add(playerId);
    setPendingContractIds(prev => prev.filter(id => id !== playerId));
    setActiveContractId(prev => (prev === playerId ? null : prev));
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

  const handleRenamePlayer = async (method: 'ad' | 'purchase') => {
    if (!user || !renamePlayer) {
      return;
    }

    const userId = user.id;
    const trimmed = renameInput.trim();
    if (trimmed.length < 2) {
      toast.error('İsim en az 2 karakter olmalı');
      return;
    }

    if (trimmed === renamePlayer.name) {
      toast.info('Oyuncu adı değişmedi');
      return;
    }

    if (method === 'ad' && !isRenameAdAvailable) {
      const availableAt = getRenameAdAvailability(renamePlayer);
      const message = availableAt
        ? `Reklam ${availableAt.toLocaleString('tr-TR')} sonrasında tekrar izlenebilir.`
        : 'Reklam hakkı şu anda kullanılamıyor.';
      toast.error(message);
      return;
    }

    if (method === 'purchase' && balance < PLAYER_RENAME_DIAMOND_COST) {
      toast.error('Yetersiz elmas bakiyesi');
      return;
    }

    const previousPlayers = players.map(player => ({ ...player }));
    let diamondsSpent = false;

    setIsRenamingPlayer(true);

    try {
      if (method === 'purchase') {
        await spend(PLAYER_RENAME_DIAMOND_COST);
        diamondsSpent = true;
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const now = new Date();
      const adCooldown = new Date(
        now.getTime() + PLAYER_RENAME_AD_COOLDOWN_HOURS * HOURS_IN_MS,
      );

      const updatedPlayers = normalizePlayers(
        players.map(player => {
          if (player.id !== renamePlayer.id) {
            return player;
          }
          const currentRename = player.rename ?? { adAvailableAt: new Date(0).toISOString() };
          return {
            ...player,
            name: trimmed,
            rename: {
              ...currentRename,
              lastUpdatedAt: now.toISOString(),
              lastMethod: method === 'purchase' ? 'purchase' : 'ad',
              adAvailableAt:
                method === 'ad'
                  ? adCooldown.toISOString()
                  : currentRename.adAvailableAt ?? now.toISOString(),
            },
          };
        }),
      );

      setPlayers(updatedPlayers);
      await saveTeamPlayers(userId, updatedPlayers);
      toast.success('Oyuncu adı güncellendi');
      setRenamePlayerId(null);
    } catch (error) {
      console.error('[TeamPlanning] player rename failed', error);
      toast.error('Oyuncu adı güncellenemedi');
      setPlayers(previousPlayers);
      if (method === 'purchase' && diamondsSpent) {
        toast.error('Elmas harcaması yapıldı, lütfen destek ekibiyle iletişime geçin.');
      }
    } finally {
      setIsRenamingPlayer(false);
    }
  };

  const handleExtendContract = async (playerId: string) => {
    if (!user || isProcessingContract) {
      return;
    }
    const userId = user.id;
    const target = players.find(player => player.id === playerId);
    if (!target) {
      return;
    }
    if (getLegendIdFromPlayer(target) !== null) {
      toast.error('Nostalji paketinden alınan oyuncuların sözleşmeleri uzatılamaz.');
      return;
    }

    setIsProcessingContract(true);
    const previousPlayers = players.map(player => ({ ...player }));
    const now = new Date();
    const currentExpiry = getContractExpiration(target);
    const baseDate = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
    const newExpiry = addMonths(baseDate, CONTRACT_EXTENSION_MONTHS);

    const updatedPlayers = players.map(player => {
      if (player.id !== playerId) {
        return player;
      }
      const existingContract = player.contract ?? {
        expiresAt: newExpiry.toISOString(),
        status: 'active',
        salary: 0,
        extensions: 0,
      };
      return {
        ...player,
        contract: {
          ...existingContract,
          status: 'active',
          expiresAt: newExpiry.toISOString(),
          extensions: (existingContract.extensions ?? 0) + 1,
        },
      };
    });

    setPlayers(updatedPlayers);
    try {
      await saveTeamPlayers(userId, updatedPlayers);
      toast.success(`${target.name} ile sözleşme uzatıldı`);
      finalizeContractDecision(playerId);
    } catch (error) {
      console.error('[TeamPlanning] extend contract failed', error);
      toast.error('Sözleşme uzatılamadı');
      setPlayers(previousPlayers);
    } finally {
      setIsProcessingContract(false);
    }
  };

  const handleReleaseContract = async (playerId: string) => {
    if (!user || isProcessingContract) {
      return;
    }
    const userId = user.id;
    const target = players.find(player => player.id === playerId);
    if (!target) {
      return;
    }

    const isLegendRental = getLegendIdFromPlayer(target) !== null;

    if (isLegendRental) {
      setIsProcessingContract(true);
      const previousPlayers = players.map(player => ({ ...player }));
      const updatedPlayers = players.filter(player => player.id !== playerId);

      setPlayers(updatedPlayers);
      try {
        await completeLegendRental(userId, playerId, { players: previousPlayers });
        toast.info(`${target.name} ile yapılan kiralama sona erdi.`);
        finalizeContractDecision(playerId);
      } catch (error) {
        console.error('[TeamPlanning] legend rental release failed', error);
        toast.error('Oyuncu kadrodan kaldırılamadı');
        setPlayers(previousPlayers);
      } finally {
        setIsProcessingContract(false);
      }
      return;
    }

    setIsProcessingContract(true);
    const previousPlayers = players.map(player => ({ ...player }));
    const updatedPlayers = players.map(player => {
      if (player.id !== playerId) {
        return player;
      }
      const currentContract = player.contract ?? {
        expiresAt: new Date().toISOString(),
        status: 'expired',
        salary: 0,
        extensions: 0,
      };
      return {
        ...player,
        squadRole: player.squadRole === 'starting' ? 'reserve' : player.squadRole,
        contract: {
          ...currentContract,
          status: 'released',
        },
        market: {
          ...(player.market ?? { active: false, listingId: null }),
          active: true,
        },
      };
    });

    setPlayers(updatedPlayers);
    try {
      await saveTeamPlayers(userId, updatedPlayers);
      toast.info(`${target.name} serbest bırakıldı ve transfer listesine eklendi`);
      finalizeContractDecision(playerId);
    } catch (error) {
      console.error('[TeamPlanning] release contract failed', error);
      toast.error('Oyuncu serbest bırakılamadı');
      setPlayers(previousPlayers);
    } finally {
      setIsProcessingContract(false);
    }
  };

  const handleFirePlayer = async (playerId: string) => {
    if (!user) {
      return;
    }

    const userId = user.id;
    const target = players.find(player => player.id === playerId);
    if (!target) {
      return;
    }

    const previousPlayers = players.map(player => ({ ...player }));
    const updatedPlayers = players.filter(player => player.id !== playerId);

    setPlayers(updatedPlayers);
    try {
      await saveTeamPlayers(user.id, updatedPlayers);
      removePlayerFromCustomFormations(playerId);
      toast.success(`${target.name} takımdan gönderildi`);
      finalizeContractDecision(playerId);
    } catch (error) {
      console.error('[TeamPlanning] fire player failed', error);
      toast.error('Oyuncu kovulamadı');
      setPlayers(previousPlayers);
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

    const nearestSlot = findNearestSlot(coordinates);
    const finalPosition = nearestSlot?.position ?? player.position;

    if (player.squadRole === 'starting') {
      if (finalPosition !== player.position) {
        setPlayers(prev =>
          normalizePlayers(
            prev.map(current =>
              current.id === playerId ? { ...current, position: finalPosition } : current,
            ),
          ),
        );
      }
      applyManualPosition(playerId, {
        x: coordinates.x,
        y: coordinates.y,
        position: finalPosition,
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
      const promotion = promotePlayerToStartingRoster(prev, playerId, finalPosition);
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
      applyManualPosition(playerId, {
        x: coordinates.x,
        y: coordinates.y,
        position: finalPosition,
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

    const nearestSlot = findNearestSlot(coordinates);
    const finalPosition = nearestSlot?.position ?? player.position;
    if (finalPosition !== player.position) {
      setPlayers(prev =>
        normalizePlayers(
          prev.map(current =>
            current.id === player.id ? { ...current, position: finalPosition } : current,
          ),
        ),
      );
    }

    applyManualPosition(player.id, {
      x: coordinates.x,
      y: coordinates.y,
      position: finalPosition,
    });
  };

  const applyManualPosition = (
    playerId: string,
    data: FormationPlayerPosition,
    formationName = selectedFormation,
  ) => {
    const normalized: FormationPlayerPosition = {
      x: clampPercentageValue(data.x),
      y: clampPercentageValue(data.y),
      position: data.position,
    };
    updatePlayerManualPosition(formationName, playerId, normalized);
    setManualSlotPositions(prev => ({
      ...prev,
      [playerId]: normalized,
    }));
  };

  const handlePitchMarkerDragStart = useCallback(
    (player: Player, event: React.DragEvent<HTMLDivElement>) => {
      setDraggedPlayerId(player.id);
      event.dataTransfer.setData('text/plain', player.id);
      event.dataTransfer.effectAllowed = 'move';
    },
    [],
  );

  const handlePitchMarkerDragEnd = useCallback(
    (player: Player, event: React.DragEvent<HTMLDivElement>) => {
      handlePlayerDragEnd(event, player);
    },
    [handlePlayerDragEnd],
  );

  const getMetricValueForPlayer = useCallback(
    (player: DisplayPlayer, metric: MetricKey): number => {
      switch (metric) {
        case 'motivation':
          return clampPercentageValue(getPlayerMotivation(player) * 100);
        case 'condition':
          return clampPercentageValue(getPlayerCondition(player) * 100);
        default:
          return normalizeRatingTo100(getPlayerPower(player));
      }
    },
    [],
  );

  const renderPitchTooltip = useCallback(
    (player: DisplayPlayer) => (
      <div className="space-y-2">
        <div className="text-xs font-semibold">{player.name}</div>
        <PerformanceGauge
          label="Güç"
          value={normalizeRatingTo100(getPlayerPower(player)) / 100}
          variant="dark"
        />
        <PerformanceGauge
          label="Kondisyon"
          value={getPlayerCondition(player)}
          variant="dark"
        />
        <PerformanceGauge
          label="Motivasyon"
          value={getPlayerMotivation(player)}
          variant="dark"
        />
        {player.originalOverall > player.overall ? (
          <div className="text-[11px] text-muted-foreground">
            Orjinal: {formatRatingLabel(player.originalOverall)} / Şuanki:{' '}
            {formatRatingLabel(player.overall)}
          </div>
        ) : null}
      </div>
    ),
    [],
  );

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

      const fallbackShape =
        (derivedFormationShape && derivedFormationShape.trim().length > 0
          ? derivedFormationShape
          : savedFormationShape && savedFormationShape.trim().length > 0
            ? savedFormationShape
            : selectedFormation) ?? selectedFormation;
      const shapeForSave = fallbackShape.trim();

      // Persist full roster and snapshot locally for Firestore
      await saveTeamPlayers(user.id, players, {
        formation: selectedFormation,
        shape: shapeForSave,
        squads: {
          starters,
          bench,
          reserves,
        },
        customFormations:
          Object.keys(customForSave).length > 0 ? customForSave : undefined,
      });

      setSavedFormationShape(shapeForSave);
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
        team = await createInitialTeam(user.id, user.teamName, user.teamName, {
          authUser: auth.currentUser,
        });
      }

      teamLeagueIdRef.current =
        typeof (team as { leagueId?: string | null } | null)?.leagueId === 'string'
          ? (team as { leagueId?: string | null }).leagueId
          : null;

      const normalized = normalizePlayers(team.players);
      setPlayers(normalized);

      const remoteFormation =
        team.plan?.formation || team.lineup?.formation || formations[0].name;
      setSelectedFormation(remoteFormation);

      const remoteCustomFormations = sanitizeCustomFormationState(
        team.plan?.customFormations || team.lineup?.customFormations || {},
      );
      setCustomFormations(remoteCustomFormations);

      const rawPlanShape =
        typeof team.plan?.shape === 'string' ? team.plan.shape.trim() : '';
      const rawLineupShape =
        typeof team.lineup?.shape === 'string' ? team.lineup.shape.trim() : '';
      const normalizedShape =
        rawPlanShape && rawPlanShape.toLowerCase() !== 'auto'
          ? rawPlanShape
          : rawLineupShape && rawLineupShape.toLowerCase() !== 'auto'
            ? rawLineupShape
            : '';
      setSavedFormationShape(normalizedShape || null);
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
    if (renamePlayer) {
      setRenameInput(renamePlayer.name);
    } else {
      setRenameInput('');
    }
  }, [renamePlayer]);

  useEffect(() => {
    const expiredIds = new Set(
      players.filter(player => isContractExpired(player)).map(player => player.id),
    );

    handledContractsRef.current.forEach(id => {
      if (!expiredIds.has(id)) {
        handledContractsRef.current.delete(id);
      }
    });

    setPendingContractIds(prev => {
      const existing = new Set(prev);
      const next = [...prev];
      players.forEach(player => {
        if (!expiredIds.has(player.id)) {
          return;
        }
        if (handledContractsRef.current.has(player.id)) {
          return;
        }
        if (!existing.has(player.id)) {
          next.push(player.id);
        }
      });
      return next;
    });
  }, [players]);

  useEffect(() => {
    if (pendingContractIds.length === 0) {
      setActiveContractId(null);
      return;
    }
    setActiveContractId(prev => (prev && pendingContractIds.includes(prev) ? prev : pendingContractIds[0]));
  }, [pendingContractIds]);

  useEffect(() => {
    if (players.length === 0) {
      return;
    }

    const startingIds = new Set(
      players.filter(player => player.squadRole === 'starting').map(player => player.id),
    );

    setCustomFormations(prev => {
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

    setManualSlotPositions(prev => {
      const entries = Object.entries(prev).filter(([playerId]) => startingIds.has(playerId));
      if (entries.length === Object.keys(prev).length) {
        return prev;
      }
      return Object.fromEntries(entries);
    });
  }, [players]);

  const startingEleven = displayPlayers.filter(p => p.squadRole === 'starting');
  const benchPlayers = displayPlayers.filter(p => p.squadRole === 'bench');
  const reservePlayers = displayPlayers.filter(p => p.squadRole === 'reserve');

  const currentFormation =
    formations.find(f => f.name === selectedFormation) ?? formations[0];

  const manualFormation = useMemo(
    () => customFormations[selectedFormation] ?? {},
    [customFormations, selectedFormation],
  );

  const formationPositions: PitchSlot[] = useMemo(() => {
    const starters = displayPlayers.filter(p => p.squadRole === 'starting');
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
      const manualOverride = manualSlotPositions[player.id];
      if (manualOverride) {
        return {
          position: manualOverride.position ?? slot.position,
          x: clampPercentageValue(manualOverride.x),
          y: clampPercentageValue(manualOverride.y),
          player,
          slotIndex: idx,
        };
      }

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
  }, [currentFormation, manualFormation, players, manualSlotPositions]);


  const findNearestSlot = useCallback(
    (coords: {x: number; y: number}): PitchSlot | null => {
      if (!formationPositions.length) return null;
      let best: PitchSlot | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      formationPositions.forEach(slot => {
        const dx = slot.x - coords.x;
        const dy = slot.y - coords.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = slot;
        }
      });
      return best;
    },
    [formationPositions],
  );

  const buildPositionsMap = useCallback(
    (slots: PitchSlot[]): Record<string, StorePlayerPosition> =>
      slots.reduce<Record<string, StorePlayerPosition>>((acc, slot) => {
        if (!slot.player) {
          return acc;
        }
        acc[slot.player.id] = {
          x: clampPercentageValue(slot.x),
          y: clampPercentageValue(slot.y),
          position: slot.position,
          slotIndex: slot.slotIndex,
        };
        return acc;
      }, {}),
    [],
  );

  useEffect(() => {
    const positions = buildPositionsMap(formationPositions);
    setPlayerPositions(positions);
    updateFormationFromPositions(positions);
  }, [
    buildPositionsMap,
    formationPositions,
    setPlayerPositions,
    updateFormationFromPositions,
  ]);

  const derivedFormationShape = useMemo(
    () => deriveFormationShape(formationPositions),
    [formationPositions],
  );

  const displayFormationName = useMemo(() => {
    const manualShape = derivedFormationShape?.trim();
    if (manualShape) {
      return manualShape;
    }
    const savedShape = savedFormationShape?.trim();
    if (savedShape) {
      return savedShape;
    }
    return selectedFormation;
  }, [derivedFormationShape, savedFormationShape, selectedFormation]);

  const manualShapeDiffers = useMemo(() => {
    if (!derivedFormationShape) {
      return false;
    }
    return derivedFormationShape.trim() !== selectedFormation.trim();
  }, [derivedFormationShape, selectedFormation]);

  const selectedPlayer = useMemo(() => {
    if (!focusedPlayerId) return null;
    return displayPlayers.find(p => p.id === focusedPlayerId) ?? null;
  }, [displayPlayers, focusedPlayerId]);

  const alternativePlayers = useMemo(() => {
    if (!selectedPlayer) {
      return [] as Player[];
    }

    const target = canonicalPosition(selectedPlayer.position);

    const alternatives = displayPlayers.filter(player => {
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

    return alternatives.sort((a, b) => {
      const roleDiff = squadRoleWeight(a.squadRole) - squadRoleWeight(b.squadRole);
      if (roleDiff !== 0) {
        return roleDiff;
      }
      return b.overall - a.overall;
    });
  }, [players, selectedPlayer]);

  const handlePositionDrop = (
    e: React.DragEvent<HTMLDivElement>,
    slot: { position: Player['position']; x: number; y: number; slotIndex: number },
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const playerId = e.dataTransfer.getData('text/plain') || draggedPlayerId;
    if (!playerId) return;

    const draggedPlayer = players.find(p => p.id === playerId);
    if (!draggedPlayer) {
      setDraggedPlayerId(null);
      return;
    }

    const targetPlayer = slot.player ?? null;
    if (targetPlayer && targetPlayer.id === draggedPlayer.id) {
      dropHandledRef.current = true;
      applyManualPosition(playerId, {
        x: slot.x,
        y: slot.y,
        position: slot.position,
      });
      setFocusedPlayerId(playerId);
      setDraggedPlayerId(null);
      return;
    }

    const previousRole = draggedPlayer.squadRole;
    if (!targetPlayer && previousRole !== 'starting') {
      const startingCount = players.filter(player => player.squadRole === 'starting').length;
      if (startingCount >= 11) {
        toast.error('Pozisyon gncellenemedi', {
          description: 'lk 11 dolu. Ayn mevkideki bir oyuncuyu karmadan yeni oyuncu ekleyemezsin.',
        });
        setDraggedPlayerId(null);
        return;
      }
    }

    const originSlot =
      formationPositions.find(entry => entry.player?.id === draggedPlayer.id) ?? null;

    let errorMessage: string | null = null;
    let updated = false;

    setPlayers(prev => {
      const draggedState = prev.find(player => player.id === playerId);
      if (!draggedState) {
        errorMessage = 'Oyuncu bulunamad.';
        return prev;
      }

      const targetState = targetPlayer
        ? prev.find(player => player.id === targetPlayer.id) ?? null
        : null;

      if (targetPlayer && !targetState) {
        errorMessage = 'Hedef oyuncu bulunamad.';
        return prev;
      }

      if (!targetState && draggedState.squadRole !== 'starting') {
        const starters = prev.filter(player => player.squadRole === 'starting').length;
        if (starters >= 11) {
          errorMessage = 'lk 11 dolu. Ayn mevkideki bir oyuncuyu karmadan yeni oyuncu ekleyemezsin.';
          return prev;
        }
      }

      const next: Player[] = [];

      prev.forEach(current => {
        if (current.id === draggedState.id) {
          if (targetState) {
            if (draggedState.squadRole === 'starting') {
              const updatedTarget: Player = {
                ...targetState,
                squadRole: 'starting',
                position: originSlot?.position ?? draggedState.position,
              };
              next.push(updatedTarget);
            } else {
              const updatedTarget: Player = {
                ...targetState,
                squadRole: draggedState.squadRole,
              };
              next.push(updatedTarget);
            }
          } else {
            const updatedDragged: Player = {
              ...current,
              squadRole: 'starting',
              position: slot.position,
            };
            next.push(updatedDragged);
          }
          updated = true;
          return;
        }

        if (targetState && current.id === targetState.id) {
          const updatedDragged: Player = {
            ...draggedState,
            squadRole: 'starting',
            position: slot.position,
          };
          next.push(updatedDragged);
          return;
        }

        next.push(current);
      });

      if (!updated) {
        errorMessage = 'Pozisyon gncellenemedi.';
        return prev;
      }

      return normalizePlayers(next);
    });

    if (errorMessage) {
      toast.error('Pozisyon gncellenemedi', { description: errorMessage });
      setDraggedPlayerId(null);
      return;
    }

    if (updated) {
      dropHandledRef.current = true;
      applyManualPosition(playerId, {
        x: slot.x,
        y: slot.y,
        position: slot.position,
      });

      if (targetPlayer) {
        if (previousRole === 'starting') {
          if (originSlot) {
            applyManualPosition(targetPlayer.id, {
              x: originSlot.x,
              y: originSlot.y,
              position: originSlot.position,
            });
          } else {
            removePlayerFromCustomFormations(targetPlayer.id);
          }
        } else {
          removePlayerFromCustomFormations(targetPlayer.id);
        }
      }

      setFocusedPlayerId(playerId);
      const successMessage = targetPlayer
        ? previousRole === 'starting'
          ? 'Oyuncular yer degistirdi'
          : 'Oyuncular degisti'
        : previousRole === 'starting'
          ? 'Oyuncu sahada yeniden konumlandırıldı'
          : 'Oyuncu ilk 11\'e tand';
      toast.success(successMessage);
    }

    setDraggedPlayerId(null);
  };

  const handleAlternativeSelection = (alternativeId: string) => {
    if (!selectedPlayer) {
      return;
    }

    const manualLayouts = Object.entries(customFormations).reduce<
      Array<{ formation: string; layout: FormationPlayerPosition }>
    >((acc, [formationKey, layout]) => {
      const entry = layout?.[selectedPlayer.id];
      if (entry) {
        acc.push({ formation: formationKey, layout: entry });
      }
      return acc;
    }, []);

    let errorMessage: string | null = null;
    let updated = false;
    let swappedPlayerId: string | null = null;

    setPlayers(prev => {
      const result = promotePlayerToStartingRoster(prev, alternativeId, selectedPlayer.position, {
        targetPlayerId: selectedPlayer.id,
      });
      if (result.error) {
        errorMessage = result.error;
        return prev;
      }
      if (!result.updated) {
        return prev;
      }
      updated = true;
      swappedPlayerId = result.swappedPlayerId ?? null;
      return result.players;
    });

    if (errorMessage) {
      toast.error('Oyuncu yerle�Ytirilemedi', { description: errorMessage });
      return;
    }
    if (!updated) {
      return;
    }

    removePlayerFromCustomFormations(alternativeId);
    manualLayouts.forEach(({ formation, layout }) => {
      applyManualPosition(
        alternativeId,
        {
          ...layout,
          position: selectedPlayer.position,
        },
        formation,
      );
    });
    removePlayerFromCustomFormations(selectedPlayer.id);
    if (swappedPlayerId && swappedPlayerId !== selectedPlayer.id) {
      removePlayerFromCustomFormations(swappedPlayerId);
    }

    setFocusedPlayerId(alternativeId);
    setActiveTab('starting');
    toast.success('Oyuncu ilk 11\'e taşındı');
  };

  return (
    <>
      <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-br from-emerald-900 via-emerald-950 to-slate-950 text-white">
        <header
          id="tp-topbar"
          className="flex flex-shrink-0 items-center justify-between border-b border-white/10 bg-black/30 px-5 py-0 backdrop-blur"
        >
          <div className="flex items-center gap-2.5">
            <BackButton />
            <div>
              <h1 className="text-base font-semibold sm:text-lg">Takım Planı</h1>
              <p className="text-[11px] text-emerald-100/70 sm:text-xs">
                Formasyonunuzu yönetin ve kadronuzu düzenleyin
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="tp-topbar-button border-white/30 bg-white/10 text-white shadow-sm transition hover:bg-white/20 hover:text-white h-9 px-3 text-xs sm:text-sm"
            >
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Formasyon
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              className="tp-topbar-button bg-emerald-400 text-emerald-950 shadow-lg transition hover:bg-emerald-300 h-9 px-3 text-xs sm:text-sm"
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              Kaydet
            </Button>
          </div>
        </header>

        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[1.12fr_0.88fr]">
          <section id="tp-left" className="relative h-full overflow-hidden">
            <div id="tp-pitch-wrapper" className="tp-pitch-shell h-full w-full">
              <Pitch
                ref={pitchRef}
                slots={formationPositions}
                onPitchDrop={handlePitchDrop}
                onPositionDrop={handlePositionDrop}
                onPlayerDragStart={handlePitchMarkerDragStart}
                onPlayerDragEnd={handlePitchMarkerDragEnd}
                onSelectPlayer={playerId => setFocusedPlayerId(playerId)}
                focusedPlayerId={focusedPlayerId}
                selectedMetric={selectedMetric}
                getMetricValue={getMetricValueForPlayer}
                renderTooltip={renderPitchTooltip}
              />
            </div>

            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 p-6">
              <div className="tp-formation-card pointer-events-auto flex max-w-xs flex-col gap-2.5 rounded-3xl border border-white/20 bg-black/40 p-[0.9rem] shadow-xl backdrop-blur">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-100/80">Formasyon</span>
                <div className="flex items-baseline gap-2.5">
                  <span className="text-xl font-bold text-white">{displayFormationName}</span>
                  {manualShapeDiffers ? (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-100">
                      {selectedFormation}
                    </span>
                  ) : null}
                </div>
                <Select value={selectedFormation} onValueChange={setSelectedFormation}>
                  <SelectTrigger className="w-full border-white/20 bg-white/10 text-white focus:ring-white/50">
                    <SelectValue placeholder="Formasyon seç" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {formations.map(formation => (
                      <SelectItem key={formation.name} value={formation.name}>
                        {formation.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="tp-squad-count-card pointer-events-auto hidden rounded-3xl border border-white/20 bg-black/40 p-[0.9rem] text-right text-[10px] font-semibold uppercase tracking-wide text-emerald-100 shadow-xl backdrop-blur sm:flex sm:flex-col sm:items-end sm:gap-1">
                <span>İlk 11 · {startingEleven.length}</span>
                <span>Yedek · {benchPlayers.length}</span>
                <span>Rezerv · {reservePlayers.length}</span>
              </div>
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-start p-6">
              <div
                id="tp-metric-panel"
                className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/40 p-1 shadow-xl backdrop-blur"
              >
                {metricOptions.map(option => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setSelectedMetric(option.key)}
                    className={cn(
                      'rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-wider transition duration-150',
                      selectedMetric === option.key
                        ? 'bg-emerald-400 text-emerald-950 shadow'
                        : 'text-emerald-100 hover:bg-white/10',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <aside className="flex h-full flex-col overflow-hidden border-l border-white/10 bg-black/35">
            <div
              id="tp-right-pane"
              className="flex h-full flex-col"
              style={{ contain: 'layout paint', willChange: 'transform' }}
            >
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex h-full flex-col"
                style={{ contain: 'layout paint', willChange: 'transform' }}
              >
                <div
                  id="tp-right-header"
                  data-collapsed={isRightHeaderCollapsed}
                  className="sticky top-0 z-20 border-b border-white/10 bg-black/50 backdrop-blur"
                >
                  <div className="px-6 py-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-100/60" />
                        <Input
                          placeholder="Oyuncu ara..."
                          value={searchTerm}
                          onChange={event => setSearchTerm(event.target.value)}
                          className="border-white/20 bg-white/10 pl-9 text-white placeholder:text-emerald-100/50 focus-visible:ring-white/50"
                        />
                      </div>
                      <Select
                        value={sortBy}
                        onValueChange={value => setSortBy(value as 'role' | 'overall' | 'potential')}
                      >
                        <SelectTrigger className="border-white/20 bg-white/10 text-white focus:ring-white/50 sm:w-40">
                          <SelectValue placeholder="Sırala" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="role">Role göre</SelectItem>
                          <SelectItem value="overall">Ortalamaya göre</SelectItem>
                          <SelectItem value="potential">Maks. potansiyel</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <TabsList className="mt-4 grid grid-cols-3 gap-2 rounded-full bg-white/10 p-1">
                      <TabsTrigger
                        value="starting"
                        className="rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 data-[state=active]:bg-emerald-400 data-[state=active]:text-emerald-950"
                      >
                        İlk 11 ({startingEleven.length})
                      </TabsTrigger>
                      <TabsTrigger
                        value="bench"
                        className="rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 data-[state=active]:bg-emerald-400 data-[state=active]:text-emerald-950"
                      >
                        Yedek ({benchPlayers.length})
                      </TabsTrigger>
                      <TabsTrigger
                        value="reserve"
                        className="rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 data-[state=active]:bg-emerald-400 data-[state=active]:text-emerald-950"
                      >
                        Rezerv ({reservePlayers.length})
                      </TabsTrigger>
                    </TabsList>
                  </div>
                </div>

                <div
                  id="tp-right-scroll"
                  ref={rightPaneScrollRef}
                  className="flex-1 overflow-y-auto px-6 py-6"
                  onScroll={handleRightPaneScroll}
                >
                  <div className="mx-auto flex max-w-3xl flex-col gap-6">
                    {selectedPlayer ? (
                      <Card className="border-white/10 bg-white/5 text-white shadow-lg backdrop-blur">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-semibold text-white">
                          {canonicalPosition(selectedPlayer.position)} için alternatifler
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {alternativePlayers.length > 0 ? (
                          <div className="grid gap-[6px] sm:grid-cols-2">
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
                          <p className="text-xs text-emerald-100/70">
                            Bu pozisyon için yedek veya rezerv oyuncu bulunmadı.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ) : null}

                  <TabsContent value="starting" className="mt-0 space-y-4">
                    {sortedPlayers.length === 0 ? (
                      <Card className="border-white/10 bg-white/5 text-center text-white shadow-lg backdrop-blur">
                        <CardContent className="p-8">
                          <div className="mb-4 text-4xl">⚽</div>
                          <h3 className="mb-2 text-base font-semibold">İlk 11'inizi oluşturun</h3>
                          <p className="text-sm text-emerald-100/70">
                            Yedek kulübesinden oyuncularınızı ilk 11'e taşıyın.
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      sortedPlayers.map(player => (
                        <PlayerCard
                          key={player.id}
                          player={player}
                          leagueId={teamLeagueIdRef.current}
                          ratingAnnotation={getRatingAnnotation(player)}
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

                  <TabsContent value="bench" className="mt-0 space-y-4">
                    {sortedPlayers.length === 0 ? (
                      <Card className="border-white/10 bg-white/5 text-center text-white shadow-lg backdrop-blur">
                        <CardContent className="p-8">
                          <div className="mb-4 text-4xl">⚽</div>
                          <h3 className="mb-2 text-base font-semibold">Yedek kulübesi boş</h3>
                          <p className="text-sm text-emerald-100/70">
                            Rezerv oyuncularınızı yedek kulübesine taşıyın.
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      sortedPlayers.map(player => (
                        <PlayerCard
                          key={player.id}
                          player={player}
                          leagueId={teamLeagueIdRef.current}
                          ratingAnnotation={getRatingAnnotation(player)}
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

                  <TabsContent value="reserve" className="mt-0 space-y-4">
                    {sortedPlayers.length === 0 ? (
                      <Card className="border-white/10 bg-white/5 text-center text-white shadow-lg backdrop-blur">
                        <CardContent className="p-8">
                          <div className="mb-4 text-4xl">⚽</div>
                          <h3 className="mb-2 text-base font-semibold">Rezerv oyuncu yok</h3>
                          <p className="text-sm text-emerald-100/70">
                            Altyapıdan oyuncu alın veya pazardan oyuncu satın.
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      sortedPlayers.map(player => (
                        <PlayerCard
                          key={player.id}
                          player={player}
                          leagueId={teamLeagueIdRef.current}
                          ratingAnnotation={getRatingAnnotation(player)}
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
                </div>
              </div>
            </Tabs>
            </div>
          </aside>
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
                <p>{formatContractCountdown(getContractExpiration(activeContractPlayer), teamLeagueIdRef.current)}</p>
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
    </>
  );
}

export default function TeamPlanning() {
  return (
    <TeamPlanningProvider>
      <TeamPlanningContent />
    </TeamPlanningProvider>
  );
}

