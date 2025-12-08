import { clampPerformanceGauge } from '@/components/ui/performance-gauge';
import { calculatePowerIndex } from '@/lib/player';
import { CustomFormationMap, Player } from '@/types';
import { clampNumber } from '@/lib/contractNegotiation';
import type { MetricKey } from './useTeamPlanningStore';

export const DEFAULT_GAUGE_VALUE = 0.75;

export const PLAYER_RENAME_DIAMOND_COST = 45;
export const PLAYER_RENAME_AD_COOLDOWN_HOURS = 24;
export const CONTRACT_EXTENSION_MONTHS = 18;
export const MIN_SALARY_OFFER = 0;

export const HOURS_IN_MS = 60 * 60 * 1000;

export const metricOptions: Array<{ key: MetricKey; label: string }> = [
  { key: 'power', label: 'G�o��' },
  { key: 'motivation', label: 'MOT��VASYON' },
  { key: 'condition', label: 'KOND��SYON' },
];

export const KNOWN_POSITIONS: Player['position'][] = [
  'GK',
  'CB',
  'LB',
  'RB',
  'CM',
  'LM',
  'RM',
  'CAM',
  'LW',
  'RW',
  'ST',
];

export const POSITION_ALIAS_MAP: Record<string, Player['position']> = {
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

export type FormationPlayerPosition = {
  x: number;
  y: number;
  position: Player['position'];
};

export type CustomFormationState = CustomFormationMap;

export type PlayerBaseline = {
  naturalPosition: Player['position'];
  naturalOverall: number;
};

export type DisplayPlayer = Player & {
  originalOverall: number;
  assignedOverall: number;
  isOutOfPosition: boolean;
};

const POSITION_ATTRIBUTE_WEIGHTS: Record<
  Player['position'],
  Record<keyof Player['attributes'], number>
> = {
  GK: {
    strength: 0.15,
    acceleration: 0.05,
    topSpeed: 0.05,
    dribbleSpeed: 0.05,
    jump: 0.2,
    tackling: 0.1,
    ballKeeping: 0.15,
    passing: 0.1,
    longBall: 0.05,
    agility: 0.05,
    shooting: 0,
    shootPower: 0.05,
    positioning: 0.05,
    reaction: 0.1,
    ballControl: 0.05,
  },
  CB: {
    strength: 0.25,
    acceleration: 0.1,
    topSpeed: 0.05,
    dribbleSpeed: 0,
    jump: 0.2,
    tackling: 0.25,
    ballKeeping: 0,
    passing: 0.05,
    longBall: 0.1,
    agility: 0.05,
    shooting: 0,
    shootPower: 0,
    positioning: 0.15,
    reaction: 0.15,
    ballControl: 0.05,
  },
  LB: {
    strength: 0.15,
    acceleration: 0.2,
    topSpeed: 0.15,
    dribbleSpeed: 0.1,
    jump: 0.05,
    tackling: 0.2,
    ballKeeping: 0,
    passing: 0.1,
    longBall: 0.1,
    agility: 0.1,
    shooting: 0,
    shootPower: 0,
    positioning: 0.05,
    reaction: 0.1,
    ballControl: 0.05,
  },
  RB: {
    strength: 0.15,
    acceleration: 0.2,
    topSpeed: 0.15,
    dribbleSpeed: 0.1,
    jump: 0.05,
    tackling: 0.2,
    ballKeeping: 0,
    passing: 0.1,
    longBall: 0.1,
    agility: 0.1,
    shooting: 0,
    shootPower: 0,
    positioning: 0.05,
    reaction: 0.1,
    ballControl: 0.05,
  },
  CM: {
    strength: 0.1,
    acceleration: 0.1,
    topSpeed: 0.05,
    dribbleSpeed: 0.15,
    jump: 0,
    tackling: 0.15,
    ballKeeping: 0.05,
    passing: 0.2,
    longBall: 0.15,
    agility: 0.15,
    shooting: 0.05,
    shootPower: 0.05,
    positioning: 0.1,
    reaction: 0.1,
    ballControl: 0.2,
  },
  LM: {
    strength: 0.05,
    acceleration: 0.2,
    topSpeed: 0.15,
    dribbleSpeed: 0.2,
    jump: 0,
    tackling: 0.05,
    ballKeeping: 0,
    passing: 0.2,
    longBall: 0.1,
    agility: 0.15,
    shooting: 0.1,
    shootPower: 0.05,
    positioning: 0.05,
    reaction: 0.05,
    ballControl: 0.25,
  },
  RM: {
    strength: 0.05,
    acceleration: 0.2,
    topSpeed: 0.15,
    dribbleSpeed: 0.2,
    jump: 0,
    tackling: 0.05,
    ballKeeping: 0,
    passing: 0.2,
    longBall: 0.1,
    agility: 0.15,
    shooting: 0.1,
    shootPower: 0.05,
    positioning: 0.05,
    reaction: 0.05,
    ballControl: 0.25,
  },
  CAM: {
    strength: 0.05,
    acceleration: 0.15,
    topSpeed: 0.1,
    dribbleSpeed: 0.2,
    jump: 0,
    tackling: 0.05,
    ballKeeping: 0,
    passing: 0.25,
    longBall: 0.1,
    agility: 0.15,
    shooting: 0.2,
    shootPower: 0.15,
    positioning: 0.1,
    reaction: 0.1,
    ballControl: 0.25,
  },
  LW: {
    strength: 0.05,
    acceleration: 0.25,
    topSpeed: 0.2,
    dribbleSpeed: 0.2,
    jump: 0,
    tackling: 0,
    ballKeeping: 0,
    passing: 0.15,
    longBall: 0.05,
    agility: 0.2,
    shooting: 0.25,
    shootPower: 0.2,
    positioning: 0.1,
    reaction: 0.05,
    ballControl: 0.25,
  },
  RW: {
    strength: 0.05,
    acceleration: 0.25,
    topSpeed: 0.2,
    dribbleSpeed: 0.2,
    jump: 0,
    tackling: 0,
    ballKeeping: 0,
    passing: 0.15,
    longBall: 0.05,
    agility: 0.2,
    shooting: 0.25,
    shootPower: 0.2,
    positioning: 0.1,
    reaction: 0.05,
    ballControl: 0.25,
  },
  ST: {
    strength: 0.15,
    acceleration: 0.2,
    topSpeed: 0.25,
    dribbleSpeed: 0.15,
    jump: 0.05,
    tackling: 0,
    ballKeeping: 0,
    passing: 0.1,
    longBall: 0.05,
    agility: 0.1,
    shooting: 0.25,
    shootPower: 0.25,
    positioning: 0.2,
    reaction: 0.1,
    ballControl: 0.15,
  },
};

const DEFAULT_WEIGHTS = Object.fromEntries(
  Object.keys(POSITION_ATTRIBUTE_WEIGHTS.ST).map(key => [key, 1]),
) as Record<keyof Player['attributes'], number>;

const getPositionAttributeWeights = (position: Player['position']) =>
  POSITION_ATTRIBUTE_WEIGHTS[position] || DEFAULT_WEIGHTS;

export const clampPercentageValue = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
};

export const squadRoleWeight = (role?: Player['squadRole'] | 'youth'): number => {
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

export const computePositionOverall = (
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
    score += value * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return 0;
  return parseFloat((score / totalWeight).toFixed(2));
};

export const canonicalPosition = (value?: string | null): Player['position'] => {
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

const POSITION_LABELS_TR: Record<Player['position'], string> = {
  GK: 'Kaleci',
  CB: 'Stoper',
  LB: 'Sol Bek',
  RB: 'Sağ Bek',
  CM: 'Merkez Orta Saha',
  LM: 'Sol Orta Saha',
  RM: 'Sağ Orta Saha',
  CAM: 'Ofansif Orta Saha',
  LW: 'Sol Kanat',
  RW: 'Sağ Kanat',
  ST: 'Santrafor',
};

export const getPositionLabel = (value?: string | null): string => {
  const canonical = canonicalPosition(value);
  return POSITION_LABELS_TR[canonical] ?? canonical;
};

export function buildDisplayPlayer(
  player: Player,
  baseline?: PlayerBaseline,
): DisplayPlayer {
  const baselinePosition = canonicalPosition(baseline?.naturalPosition ?? player.position);
  const canonicalAssigned = canonicalPosition(player.position);
  const allowedPositions = new Set<Player['position']>(
    (player.roles ?? [player.position]).map(role => canonicalPosition(role)),
  );
  if (allowedPositions.size === 0) {
    allowedPositions.add(baselinePosition);
  }

  const originalOverall = baseline?.naturalOverall ?? player.overall;
  const isOutOfPosition =
    player.squadRole === 'starting' && !allowedPositions.has(canonicalAssigned);
  const computedOverall = isOutOfPosition
    ? Math.max(
        0,
        Math.min(originalOverall, computePositionOverall(canonicalAssigned, player.attributes)),
      )
    : originalOverall;

  return {
    ...player,
    overall: computedOverall,
    originalOverall,
    assignedOverall: computedOverall,
    isOutOfPosition,
  };
}

export const clampPercentage = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return clampPercentageValue(numeric);
};

export const sanitizeCustomFormationState = (
  input: unknown,
): CustomFormationState => {
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

      const x = clampPercentage((value as { x?: unknown }).x);
      const y = clampPercentage((value as { y?: unknown }).y);
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

export const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date);
  const targetMonth = result.getMonth() + months;
  result.setMonth(targetMonth);
  return result;
};

export const getContractExpiration = (player: Player): Date | null => {
  if (!player.contract?.expiresAt) {
    return null;
  }
  const expires = new Date(player.contract.expiresAt);
  return Number.isNaN(expires.getTime()) ? null : expires;
};

export const isContractExpired = (player: Player): boolean => {
  if (!player.contract || player.contract.status === 'released') {
    return false;
  }
  const expires = getContractExpiration(player);
  if (!expires) {
    return false;
  }
  return expires.getTime() <= Date.now();
};

export const getRenameAdAvailability = (player: Player): Date | null => {
  if (!player.rename?.adAvailableAt) {
    return null;
  }
  const date = new Date(player.rename.adAvailableAt);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const isRenameAdReady = (player: Player): boolean => {
  const next = getRenameAdAvailability(player);
  if (!next) {
    return true;
  }
  return next.getTime() <= Date.now();
};

export function normalizePlayer(player: Player): Player {
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

export function normalizePlayers(list: Player[]): Player[] {
  return list.map(normalizePlayer);
}

export type PromoteToStartingResult = {
  players: Player[];
  error?: string;
  updated: boolean;
  swappedPlayerId?: string | null;
  targetPosition?: Player['position'];
};

export type PromotePlayerOptions = {
  targetPlayerId?: string | null;
};

export function promotePlayerToStartingRoster(
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
  const targetPlayerId =
    options.targetPlayerId && options.targetPlayerId !== playerId
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

export type FormationSnapshot = {
  player: Player | null;
  x: number;
  y: number;
};

const LINE_GROUP_TOLERANCE = 10;

export const deriveFormationShape = (positions: FormationSnapshot[]): string | null => {
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

export function getPlayerCondition(player: Player): number {
  return clampPerformanceGauge(player.condition, DEFAULT_GAUGE_VALUE);
}

export function getPlayerMotivation(player: Player): number {
  return clampPerformanceGauge(player.motivation, DEFAULT_GAUGE_VALUE);
}

export function getPlayerPower(player: Player): number {
  return calculatePowerIndex({
    ...player,
    condition: getPlayerCondition(player),
    motivation: getPlayerMotivation(player),
  });
}

export const negotiationConfidenceFromOffer = (
  negotiationOffer: number,
  salaryNegotiationProfile:
    | ReturnType<typeof import('@/lib/contractNegotiation').buildSalaryNegotiationProfile>
    | null,
  negotiationPlayer: Player | null,
): number => {
  if (!salaryNegotiationProfile) {
    return 0;
  }
  const ceiling = salaryNegotiationProfile.ceiling;
  const demand = Math.max(1, salaryNegotiationProfile.demand);
  const relativeToCeiling = clampNumber(
    negotiationOffer / Math.max(1, ceiling),
    0,
    1,
  );
  const demandRatio = clampNumber(negotiationOffer / demand, 0, 2);
  const demandPenalty = demandRatio < 1 ? Math.pow(1 - demandRatio, 1.2) * 0.5 : 0;
  const offerStrength =
    relativeToCeiling * 0.5 + Math.max(0, demandRatio - 1) * 0.25;
  const motivationBonus =
    (clampPerformanceGauge(negotiationPlayer?.motivation) - DEFAULT_GAUGE_VALUE) * 0.18;
  const rawChance = 0.08 + offerStrength + motivationBonus - demandPenalty;
  return clampNumber(rawChance, 0.03, 0.75);
};
