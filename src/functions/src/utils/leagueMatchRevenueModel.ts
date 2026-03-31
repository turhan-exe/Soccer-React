export type RevenueSide = 'home' | 'away';

export type RevenueEligiblePlayer = {
  overall?: number | null;
  injuryStatus?: string | null;
  squadRole?: string | null;
  contract?: {
    status?: string | null;
  } | null;
};

export type MatchRevenueEntry = {
  side: RevenueSide;
  teamId: string;
  amount: number;
  appliedAt?: unknown;
};

export type MatchRevenuePlanSideInput = {
  side: RevenueSide;
  teamId?: string | null;
  players?: RevenueEligiblePlayer[] | null;
  stadiumLevel?: number | null;
  skipReason?: 'missing_team_id' | 'missing_team_doc';
};

export type MatchRevenuePlanSide = {
  side: RevenueSide;
  teamId: string;
  amount: number;
};

export type MatchRevenueSkippedSide = {
  side: RevenueSide;
  reason: 'already_applied' | 'missing_team_id' | 'missing_team_doc';
};

export type MatchRevenuePlan = {
  pendingSides: MatchRevenuePlanSide[];
  skippedSides: MatchRevenueSkippedSide[];
  nextAppliedSides: RevenueSide[];
  nextEntries: MatchRevenueEntry[];
  existingAppliedSides: RevenueSide[];
  existingEntries: MatchRevenueEntry[];
};

export type FixtureTeamLookupInput = {
  homeSlotTeamId?: string | null;
  awaySlotTeamId?: string | null;
};

export type ResolvedFixtureRevenueTeamIds = {
  home: string | null;
  away: string | null;
};

type StadiumLevelConfig = {
  capacity: number;
  matchIncome: number;
  upgradeCost: number;
};

const MATCHES_PER_MONTH = 4;
const DEFAULT_TEAM_STRENGTH = 58;
const MIN_STARTERS_FOR_REAL_STRENGTH = 8;
const REVENUE_ROUNDING_UNIT = 50;
const RATING_THRESHOLD_LOW = 2.0;
const RATING_THRESHOLD_MEDIUM = 10.0;

export const STADIUM_LEVELS: Record<1 | 2 | 3 | 4 | 5, StadiumLevelConfig> = {
  1: { capacity: 1_000, matchIncome: 30_000, upgradeCost: 0 },
  2: { capacity: 3_000, matchIncome: 55_000, upgradeCost: 120_000 },
  3: { capacity: 7_500, matchIncome: 95_000, upgradeCost: 320_000 },
  4: { capacity: 15_000, matchIncome: 165_000, upgradeCost: 800_000 },
  5: { capacity: 30_000, matchIncome: 280_000, upgradeCost: 1_600_000 },
};

const normalizeTeamId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isSlotTeamId = (teamId: string): boolean => teamId.startsWith('slot-');

const normalizeRawRating = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= RATING_THRESHOLD_LOW) {
    return value * 100;
  }
  if (value <= RATING_THRESHOLD_MEDIUM) {
    return value * 10;
  }
  return value;
};

export const normalizeRatingTo100Value = (value?: number | null): number => {
  if (typeof value !== 'number') {
    return 0;
  }
  const normalized = Math.round(normalizeRawRating(value));
  return Math.max(0, Math.min(99, normalized));
};

const roundRevenue = (value: number): number => {
  const safeValue = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.round(safeValue / REVENUE_ROUNDING_UNIT) * REVENUE_ROUNDING_UNIT);
};

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

const isRevenueEligiblePlayer = (player: RevenueEligiblePlayer | null | undefined): boolean => {
  if (!player) {
    return false;
  }
  if (player.injuryStatus === 'injured') {
    return false;
  }
  const contractStatus = player.contract?.status;
  if (contractStatus === 'expired' || contractStatus === 'released') {
    return false;
  }
  return true;
};

export const getTeamStrengthForRevenue = (players: RevenueEligiblePlayer[] = []): number => {
  const eligiblePlayers = players.filter(isRevenueEligiblePlayer);
  if (!eligiblePlayers.length) {
    return DEFAULT_TEAM_STRENGTH;
  }

  const rankedPlayers = [...eligiblePlayers].sort(
    (left, right) =>
      normalizeRatingTo100Value(right.overall ?? 0) - normalizeRatingTo100Value(left.overall ?? 0),
  );
  const starters = rankedPlayers.filter((player) => player.squadRole === 'starting');

  let selected = starters.slice(0, 11);
  if (selected.length < MIN_STARTERS_FOR_REAL_STRENGTH) {
    selected = rankedPlayers.slice(0, 11);
  } else if (selected.length < 11) {
    const selectedPlayers = new Set(selected);
    for (const player of rankedPlayers) {
      if (selectedPlayers.has(player)) {
        continue;
      }
      selected.push(player);
      selectedPlayers.add(player);
      if (selected.length >= 11) {
        break;
      }
    }
  }

  if (!selected.length) {
    return DEFAULT_TEAM_STRENGTH;
  }

  const total = selected.reduce(
    (sum, player) => sum + normalizeRatingTo100Value(player.overall ?? 0),
    0,
  );
  return Math.max(35, Math.round(total / selected.length));
};

const normalizeStadiumLevel = (value?: number | null): 1 | 2 | 3 | 4 | 5 => {
  if (!Number.isFinite(value)) {
    return 1;
  }
  const normalized = Math.trunc(Number(value));
  if (normalized <= 1) return 1;
  if (normalized === 2) return 2;
  if (normalized === 3) return 3;
  if (normalized === 4) return 4;
  return 5;
};

export type MatchRevenueEstimate = {
  matchEstimate: number;
  matchesPerMonth: number;
  teamStrength: number;
  attendanceRate: number;
  occupiedSeats: number;
  projectedDailyIncome: number;
  monthlyMatchEstimate: number;
};

export const getServerMatchRevenueEstimate = (
  level: number,
  players: RevenueEligiblePlayer[] = [],
): MatchRevenueEstimate => {
  const normalizedLevel = normalizeStadiumLevel(level);
  const config = STADIUM_LEVELS[normalizedLevel];
  const teamStrength = getTeamStrengthForRevenue(players);
  const attendanceRate = clamp(0.55 + teamStrength * 0.003 + normalizedLevel * 0.04, 0.6, 0.96);
  const occupiedSeats = Math.round(config.capacity * attendanceRate);
  const ticketYield = 10 + teamStrength * 0.12 + normalizedLevel * 1.5;
  const commercialBoost = 5_000 + config.capacity * 2 + teamStrength * 120 + normalizedLevel * 2_500;
  const matchEstimate = roundRevenue(occupiedSeats * ticketYield + commercialBoost);
  const monthlyMatchEstimate = roundRevenue(matchEstimate * MATCHES_PER_MONTH);

  return {
    matchEstimate,
    matchesPerMonth: MATCHES_PER_MONTH,
    teamStrength,
    attendanceRate,
    occupiedSeats,
    projectedDailyIncome: roundRevenue(monthlyMatchEstimate / 30),
    monthlyMatchEstimate,
  };
};

const normalizeAppliedSides = (value: unknown): RevenueSide[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: RevenueSide[] = [];
  for (const item of value) {
    if ((item === 'home' || item === 'away') && !result.includes(item)) {
      result.push(item);
    }
  }
  return result;
};

const normalizeRevenueEntries = (value: unknown): MatchRevenueEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: MatchRevenueEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const side = (item as { side?: unknown }).side;
    const teamId = normalizeTeamId((item as { teamId?: unknown }).teamId);
    const amount = Number((item as { amount?: unknown }).amount);
    if ((side !== 'home' && side !== 'away') || !teamId || !Number.isFinite(amount)) {
      continue;
    }
    entries.push({
      side,
      teamId,
      amount: Math.max(0, Math.round(amount)),
      appliedAt: (item as { appliedAt?: unknown }).appliedAt,
    });
  }
  return entries;
};

export const buildMatchRevenuePlan = (
  input: {
    existingAppliedSides?: unknown;
    existingEntries?: unknown;
    sides: MatchRevenuePlanSideInput[];
  },
  options?: {
    appliedAt?: Date;
  },
): MatchRevenuePlan => {
  const existingAppliedSides = normalizeAppliedSides(input.existingAppliedSides);
  const existingEntries = normalizeRevenueEntries(input.existingEntries);
  const alreadyAppliedSides = new Set<RevenueSide>([
    ...existingAppliedSides,
    ...existingEntries.map((entry) => entry.side),
  ]);

  const pendingSides: MatchRevenuePlanSide[] = [];
  const skippedSides: MatchRevenueSkippedSide[] = [];

  for (const sideInput of input.sides) {
    if (sideInput.skipReason) {
      skippedSides.push({ side: sideInput.side, reason: sideInput.skipReason });
      continue;
    }

    const teamId = normalizeTeamId(sideInput.teamId);
    if (!teamId) {
      skippedSides.push({ side: sideInput.side, reason: 'missing_team_id' });
      continue;
    }

    if (alreadyAppliedSides.has(sideInput.side)) {
      skippedSides.push({ side: sideInput.side, reason: 'already_applied' });
      continue;
    }

    pendingSides.push({
      side: sideInput.side,
      teamId,
      amount: getServerMatchRevenueEstimate(
        sideInput.stadiumLevel ?? 1,
        Array.isArray(sideInput.players) ? sideInput.players : [],
      ).matchEstimate,
    });
  }

  const nextAppliedSides = [...existingAppliedSides];
  for (const entry of existingEntries) {
    if (!nextAppliedSides.includes(entry.side)) {
      nextAppliedSides.push(entry.side);
    }
  }
  for (const pending of pendingSides) {
    if (!nextAppliedSides.includes(pending.side)) {
      nextAppliedSides.push(pending.side);
    }
  }

  const appliedAt = options?.appliedAt ?? new Date();
  const nextEntries = [
    ...existingEntries,
    ...pendingSides.map((pending) => ({
      side: pending.side,
      teamId: pending.teamId,
      amount: pending.amount,
      appliedAt,
    })),
  ];

  return {
    pendingSides,
    skippedSides,
    nextAppliedSides,
    nextEntries,
    existingAppliedSides,
    existingEntries,
  };
};

export const resolveFixtureRevenueTeamIdsFromLookups = (
  fixture: {
    homeTeamId?: unknown;
    awayTeamId?: unknown;
  },
  lookups: FixtureTeamLookupInput,
): ResolvedFixtureRevenueTeamIds => {
  let homeTeamId = normalizeTeamId(fixture.homeTeamId);
  let awayTeamId = normalizeTeamId(fixture.awayTeamId);

  if (!homeTeamId || isSlotTeamId(homeTeamId)) {
    homeTeamId = normalizeTeamId(lookups.homeSlotTeamId);
  }
  if (!awayTeamId || isSlotTeamId(awayTeamId)) {
    awayTeamId = normalizeTeamId(lookups.awaySlotTeamId);
  }

  return {
    home: homeTeamId,
    away: awayTeamId,
  };
};
