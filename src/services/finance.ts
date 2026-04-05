import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Player } from '@/types';
import { buildSalaryNegotiationProfile } from '@/lib/contractNegotiation';
import { resolvePlayerSalary, shouldRefreshLegacySalary } from '@/lib/salary';
import {
  clampVitalGauge,
  normalizeTeamPlayers,
  UNDERPAID_MOTIVATION_PENALTY,
  UNDERPAID_SALARY_RECOVERY_THRESHOLD,
  UNDERPAID_SALARY_THRESHOLD,
} from '@/lib/playerVitals';
import { normalizeRatingTo100 } from '@/lib/player';
import { INITIAL_CLUB_BALANCE, normalizeClubBalance } from '@/lib/clubFinance';

export type FinanceHistoryCategory =
  | 'match'
  | 'sponsor'
  | 'loan'
  | 'salary'
  | 'stadium'
  | 'transfer'
  | 'vip';

export interface FinanceHistoryEntry {
  id: string;
  type: 'income' | 'expense';
  category: FinanceHistoryCategory;
  amount: number;
  source?: string;
  timestamp: Timestamp;
  note?: string;
}

export interface FinanceDoc {
  balance: number;
  updatedAt?: Timestamp;
}

export type StadiumLevel = 1 | 2 | 3 | 4 | 5;

export interface StadiumState {
  level: StadiumLevel;
  incomePerMatch: number;
  upgradeCost: number;
  upgradedAt?: Timestamp;
}

export interface StadiumLevelConfig {
  capacity: number;
  matchIncome: number;
  upgradeCost: number;
}

export const STADIUM_LEVELS: Record<StadiumLevel, StadiumLevelConfig> = {
  1: { capacity: 1_000, matchIncome: 30_000, upgradeCost: 0 },
  2: { capacity: 3_000, matchIncome: 55_000, upgradeCost: 20_000 },
  3: { capacity: 7_500, matchIncome: 95_000, upgradeCost: 50_000 },
  4: { capacity: 15_000, matchIncome: 165_000, upgradeCost: 100_000 },
  5: { capacity: 30_000, matchIncome: 280_000, upgradeCost: 200_000 },
};

export interface CreditPackage {
  id: string;
  productId: string;
  amount: number;
  price: number;
}

export type SponsorType = 'free' | 'premium';

export interface SponsorReward {
  amount: number;
  cycle: 'daily' | 'weekly';
}

export interface SponsorCatalogEntry {
  id: string;
  catalogId: string;
  name: string;
  type: SponsorType;
  reward: SponsorReward;
  price?: number;
  storeProductId?: string | null;
}

export interface UserSponsorDoc {
  id: string;
  catalogId: string;
  name: string;
  type: SponsorType;
  reward: SponsorReward;
  price?: number;
  storeProductId?: string | null;
  active: boolean;
  activatedAt: Timestamp;
  lastPayoutAt?: Timestamp | null;
  nextPayoutAt?: Timestamp | null;
}

export interface SponsorPayoutAvailability {
  canCollect: boolean;
  nextPayoutAt: Date | null;
  remainingMs: number;
}

export interface ActivateUserSponsorResponse {
  sponsorId: string;
  sponsorName: string;
  sponsorType: SponsorType;
  active: boolean;
}

export interface CollectUserSponsorEarningsResponse {
  sponsorId: string;
  sponsorName: string;
  payout: number;
}

export interface VipDailyCreditSummary {
  lastClaimDate: string | null;
  lastClaimAmount?: number | null;
  claimCostDiamonds?: number | null;
  lastClaimAt?: Timestamp | null;
}

export interface VipDailyCreditAvailability {
  canClaim: boolean;
  claimedToday: boolean;
  todayKey: string;
  nextClaimDateKey: string;
}

export interface ClaimVipDailyCreditResponse {
  claimDate: string;
  amount: number;
  diamondCost: number;
  mode: 'free' | 'diamond';
  balance: number;
  diamondBalance: number;
  nextClaimDate: string;
}

export interface TeamSalaryRecord {
  playerId: string;
  name: string;
  position: string;
  overall: number;
  salary: number;
}

export interface TeamSalariesDoc {
  players: TeamSalaryRecord[];
  total: number;
  updatedAt?: Timestamp;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MATCHES_PER_MONTH = 4;
const DEFAULT_TEAM_STRENGTH = 58;
const MIN_STARTERS_FOR_REAL_STRENGTH = 8;
const REVENUE_ROUNDING_UNIT = 50;
export const VIP_DAILY_CREDIT_AMOUNT = 6_000;
export const VIP_DAILY_CREDIT_DIAMOND_COST = 0;

const istanbulDateKeyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const financeDoc = (uid: string) => doc(db, 'finance', uid);
const historyCollection = (uid: string) => collection(db, 'finance', 'history', uid);
const creditCollection = (uid: string) => collection(db, 'finance', 'credits', uid);
const teamDoc = (teamId: string) => doc(db, 'teams', teamId);
const teamStadiumDoc = (teamId: string) => doc(db, 'teams', teamId, 'stadium', 'state');
const teamSalariesDoc = (teamId: string) => doc(db, 'teams', teamId, 'salaries', 'current');
const teamSalariesScheduleDoc = (teamId: string) => doc(db, 'teams', teamId, 'salaries', 'schedule');
const financeHistoryPreviewQuery = (uid: string) => query(historyCollection(uid), limit(1));

export { getSalaryForOverall } from '@/lib/salary';

const roundRevenue = (value: number): number => {
  const safeValue = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.round(safeValue / REVENUE_ROUNDING_UNIT) * REVENUE_ROUNDING_UNIT);
};

const roundSignedAmount = (value: number): number => {
  const safeValue = Number.isFinite(value) ? value : 0;
  return Math.round(safeValue / REVENUE_ROUNDING_UNIT) * REVENUE_ROUNDING_UNIT;
};

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

type TeamBudgetSource = {
  budget?: number;
  transferBudget?: number;
};

type FinanceBalanceSource = {
  balance?: number;
};

const hasFiniteValue = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const getDatePartValue = (
  parts: Intl.DateTimeFormatPart[],
  type: 'year' | 'month' | 'day',
): string => parts.find((part) => part.type === type)?.value ?? '';

export const getIstanbulDateKey = (date = new Date()): string => {
  const parts = istanbulDateKeyFormatter.formatToParts(date);
  const year = getDatePartValue(parts, 'year');
  const month = getDatePartValue(parts, 'month');
  const day = getDatePartValue(parts, 'day');
  return `${year}-${month}-${day}`;
};

export const getNextIstanbulDateKey = (date = new Date()): string =>
  getIstanbulDateKey(new Date(date.getTime() + DAY_MS));

export const resolveCanonicalClubBalance = (
  teamData?: TeamBudgetSource | null,
  financeData?: FinanceBalanceSource | null,
  options?: { hasHistory?: boolean },
): number => {
  const transferBudget = hasFiniteValue(teamData?.transferBudget)
    ? normalizeClubBalance(teamData?.transferBudget)
    : null;
  const budget = hasFiniteValue(teamData?.budget)
    ? normalizeClubBalance(teamData?.budget)
    : null;
  const financeBalance = hasFiniteValue(financeData?.balance)
    ? normalizeClubBalance(financeData?.balance)
    : null;

  const hasHistory = options?.hasHistory === true;
  const legacyInitialMismatch =
    !hasHistory &&
    transferBudget === 0 &&
    budget === 0 &&
    financeBalance === INITIAL_CLUB_BALANCE;

  if (legacyInitialMismatch) {
    return INITIAL_CLUB_BALANCE;
  }

  const teamLooksStaleAtZero =
    hasHistory &&
    financeBalance != null &&
    financeBalance > 0 &&
    transferBudget === 0 &&
    (budget == null || budget === 0);

  if (teamLooksStaleAtZero) {
    return financeBalance;
  }

  if (transferBudget != null) {
    return transferBudget;
  }

  if (budget != null) {
    return budget;
  }

  if (financeBalance != null) {
    return financeBalance;
  }

  return INITIAL_CLUB_BALANCE;
};

const resolveTimestampMillis = (
  value?: Pick<Timestamp, 'toMillis'> | null,
): number | null => {
  if (!value || typeof value.toMillis !== 'function') {
    return null;
  }

  const millis = value.toMillis();
  return Number.isFinite(millis) ? millis : null;
};

export const getSponsorCadenceMs = (cycle: SponsorReward['cycle']): number =>
  cycle === 'weekly' ? 7 * DAY_MS : DAY_MS;

export const getSponsorPayoutAvailability = (
  sponsor: Pick<UserSponsorDoc, 'activatedAt' | 'lastPayoutAt' | 'nextPayoutAt' | 'reward'>,
  nowMs = Date.now(),
): SponsorPayoutAvailability => {
  const cadenceMs = getSponsorCadenceMs(sponsor.reward.cycle);
  const activatedAtMs = resolveTimestampMillis(sponsor.activatedAt);
  const lastPayoutAtMs = resolveTimestampMillis(sponsor.lastPayoutAt ?? null);
  const explicitNextPayoutAtMs = resolveTimestampMillis(sponsor.nextPayoutAt ?? null);
  const payoutBaseMs = lastPayoutAtMs ?? activatedAtMs;
  const nextPayoutAtMs =
    explicitNextPayoutAtMs ??
    (payoutBaseMs != null ? payoutBaseMs + cadenceMs : null);

  if (nextPayoutAtMs == null) {
    return {
      canCollect: false,
      nextPayoutAt: null,
      remainingMs: 0,
    };
  }

  return {
    canCollect: nowMs >= nextPayoutAtMs,
    nextPayoutAt: new Date(nextPayoutAtMs),
    remainingMs: Math.max(0, nextPayoutAtMs - nowMs),
  };
};

export const getVipDailyCreditAvailability = (
  vipActive: boolean,
  summary?: VipDailyCreditSummary | null,
  now = new Date(),
): VipDailyCreditAvailability => {
  const todayKey = getIstanbulDateKey(now);
  const claimedToday = (summary?.lastClaimDate?.trim() ?? '') === todayKey;

  return {
    canClaim: vipActive && !claimedToday,
    claimedToday,
    todayKey,
    nextClaimDateKey: getNextIstanbulDateKey(now),
  };
};

const isRevenueEligiblePlayer = (player: Player): boolean => {
  if (!player) {
    return false;
  }
  if (player.injuryStatus === 'injured') {
    return false;
  }
  const status = player.contract?.status;
  if (status === 'expired' || status === 'released') {
    return false;
  }
  return true;
};

export const getTeamStrength = (players: Player[] = []): number => {
  const eligiblePlayers = players.filter(isRevenueEligiblePlayer);
  if (!eligiblePlayers.length) {
    return DEFAULT_TEAM_STRENGTH;
  }

  const rankedPlayers = [...eligiblePlayers].sort(
    (left, right) => normalizeRatingTo100(right.overall) - normalizeRatingTo100(left.overall),
  );
  const starters = rankedPlayers.filter((player) => player.squadRole === 'starting');

  let selected = starters.slice(0, 11);
  if (selected.length < MIN_STARTERS_FOR_REAL_STRENGTH) {
    selected = rankedPlayers.slice(0, 11);
  } else if (selected.length < 11) {
    const selectedIds = new Set(selected.map((player) => player.id));
    for (const player of rankedPlayers) {
      if (selectedIds.has(player.id)) {
        continue;
      }
      selected.push(player);
      selectedIds.add(player.id);
      if (selected.length >= 11) {
        break;
      }
    }
  }

  if (!selected.length) {
    return DEFAULT_TEAM_STRENGTH;
  }

  const total = selected.reduce((sum, player) => sum + normalizeRatingTo100(player.overall), 0);
  return Math.max(35, Math.round(total / selected.length));
};

export interface ExpectedRevenueBreakdown {
  monthly: number;
  matchEstimate: number;
  sponsorEstimate: number;
  matchesPerMonth: number;
  teamStrength: number;
  attendanceRate: number;
  occupiedSeats: number;
  projectedDailyIncome: number;
  monthlyMatchEstimate: number;
  projectedMonthlyExpense: number;
  projectedMonthlyNet: number;
}

export const getMatchRevenueEstimate = (
  level: StadiumLevel,
  players: Player[] = [],
): Omit<ExpectedRevenueBreakdown, 'monthly' | 'sponsorEstimate' | 'projectedMonthlyExpense' | 'projectedMonthlyNet'> => {
  const config = STADIUM_LEVELS[level];
  const teamStrength = getTeamStrength(players);
  const attendanceRate = clamp(0.55 + teamStrength * 0.003 + level * 0.04, 0.6, 0.96);
  const occupiedSeats = Math.round(config.capacity * attendanceRate);
  const ticketYield = 10 + teamStrength * 0.12 + level * 1.5;
  const commercialBoost = 5_000 + config.capacity * 2 + teamStrength * 120 + level * 2_500;
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

async function addFinanceHistoryEntry(
  uid: string,
  entry: Omit<FinanceHistoryEntry, 'id' | 'timestamp'> & { timestamp?: Timestamp },
): Promise<void> {
  const col = historyCollection(uid);
  const ref = doc(col);
  await setDoc(ref, {
    id: ref.id,
    type: entry.type,
    category: entry.category,
    amount: entry.amount,
    source: entry.source ?? null,
    note: entry.note ?? null,
    timestamp: entry.timestamp ?? serverTimestamp(),
  });
}

async function ensureFinanceDoc(uid: string): Promise<void> {
  const ref = financeDoc(uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const teamSnap = await getDoc(teamDoc(uid));
    const teamData = teamSnap.exists()
      ? ((teamSnap.data() as TeamBudgetSource | undefined) ?? undefined)
      : undefined;
    const initialBalance = resolveCanonicalClubBalance(teamData, undefined);
    await setDoc(ref, { balance: initialBalance, updatedAt: serverTimestamp() });
  }
}

async function ensureStadiumDoc(teamId: string): Promise<void> {
  const ref = teamStadiumDoc(teamId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      level: 1,
      incomePerMatch: getMatchRevenueEstimate(1).matchEstimate,
      upgradeCost: STADIUM_LEVELS[2].upgradeCost,
      upgradedAt: serverTimestamp(),
    });
  }
}

export async function ensureFinanceProfile(teamId: string): Promise<void> {
  await Promise.all([ensureFinanceDoc(teamId), ensureStadiumDoc(teamId)]);
}

const buildSalaryState = (
  players: Player[],
): { records: TeamSalaryRecord[]; normalizedPlayers: Player[]; changed: boolean } => {
  let changed = false;
  const roster = normalizeTeamPlayers(players);
  if (JSON.stringify(roster) !== JSON.stringify(players)) {
    changed = true;
  }

  const normalizedPlayers = roster.map((player) => {
    const overall = typeof player.overall === 'number' ? player.overall : 0;
    const resolvedSalary = resolvePlayerSalary(player);
    const shouldPersistSalary =
      !!player.contract &&
      (typeof player.contract?.salary !== 'number' ||
        shouldRefreshLegacySalary(player.contract?.salary, overall));

    if (!shouldPersistSalary) {
      return player;
    }

    changed = true;
    return {
      ...player,
      contract: {
        ...player.contract,
        salary: resolvedSalary,
      },
    };
  });

  const records = normalizedPlayers.map((player) => ({
    playerId: String(player.id),
    name: player.name,
    position: player.position,
    overall: typeof player.overall === 'number' ? player.overall : 0,
    salary: resolvePlayerSalary(player),
  }));

  return { records, normalizedPlayers, changed };
};

export const applyUnderpaidSalaryPenaltyForMonth = (
  players: Player[],
  monthKey: string,
): { players: Player[]; changed: boolean; penalizedPlayerIds: string[] } => {
  let changed = false;
  const penalizedPlayerIds: string[] = [];

  const adjustedPlayers = players.map((player) => {
    const contractStatus = player.contract?.status ?? 'active';
    if (!player.contract || contractStatus === 'expired' || contractStatus === 'released') {
      return player;
    }

    const demand = Math.max(1, buildSalaryNegotiationProfile(player).demand);
    const salary = Math.max(0, resolvePlayerSalary(player));
    const ratio = salary / demand;
    const currentState = player.motivationState ?? {};
    let nextState = currentState;
    let nextMotivation = player.motivation;
    let playerChanged = false;

    if (ratio < UNDERPAID_SALARY_THRESHOLD) {
      if (currentState.underpaidLastAppliedMonth !== monthKey) {
        nextMotivation = clampVitalGauge(
          player.motivation - UNDERPAID_MOTIVATION_PENALTY,
        );
        penalizedPlayerIds.push(player.id);
        playerChanged = true;
      }

      if (
        currentState.underpaidActive !== true ||
        currentState.underpaidLastAppliedMonth !== monthKey
      ) {
        nextState = {
          ...currentState,
          underpaidActive: true,
          underpaidLastAppliedMonth: monthKey,
        };
        playerChanged = true;
      }
    } else if (ratio >= UNDERPAID_SALARY_RECOVERY_THRESHOLD) {
      if (currentState.underpaidActive) {
        nextState = {
          ...currentState,
          underpaidActive: false,
        };
        playerChanged = true;
      }
    }

    if (!playerChanged && nextState === currentState && nextMotivation === player.motivation) {
      return player;
    }

    changed = true;

    return {
      ...player,
      motivation: nextMotivation,
      motivationState: nextState,
    };
  });

  return {
    players: normalizeTeamPlayers(adjustedPlayers),
    changed,
    penalizedPlayerIds,
  };
};

export async function syncTeamSalaries(teamId: string): Promise<TeamSalariesDoc> {
  const teamSnap = await getDoc(teamDoc(teamId));
  if (!teamSnap.exists()) {
    throw new Error('Takim bulunamadi.');
  }
  const team = teamSnap.data() as { players?: Player[] };
  const salaryState = buildSalaryState(team.players ?? []);
  const players = salaryState.records;
  const total = players.reduce((sum, record) => sum + record.salary, 0);
  if (salaryState.changed) {
    await setDoc(
      teamDoc(teamId),
      {
        players: salaryState.normalizedPlayers,
      },
      { merge: true },
    );
  }
  await setDoc(
    teamSalariesDoc(teamId),
    {
      players,
      total,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return { players, total };
}

export async function ensureMonthlySalaryCharge(teamId: string): Promise<number | null> {
  await ensureFinanceProfile(teamId);
  let chargedAmount: number | null = null;
  const monthKey = new Date().toISOString().slice(0, 7);

  await runTransaction(db, async (tx) => {
    const financeRef = financeDoc(teamId);
    const salariesRef = teamSalariesDoc(teamId);
    const scheduleRef = teamSalariesScheduleDoc(teamId);
    const teamRef = teamDoc(teamId);

    const [financeSnap, salariesSnap, scheduleSnap, teamSnap] = await Promise.all([
      tx.get(financeRef),
      tx.get(salariesRef),
      tx.get(scheduleRef),
      tx.get(teamRef),
    ]);

    const schedule = scheduleSnap.exists() ? (scheduleSnap.data() as { lastChargedMonth?: string }) : {};
    if (schedule.lastChargedMonth === monthKey) {
      chargedAmount = null;
      return;
    }

    const teamData = teamSnap.data() as { players?: Player[]; budget?: number; transferBudget?: number } | undefined;
    const computedSalaryState = buildSalaryState(teamData?.players ?? []);
    const salaryMotivationState = applyUnderpaidSalaryPenaltyForMonth(
      computedSalaryState.normalizedPlayers,
      monthKey,
    );
    const salaryRecords = computedSalaryState.records.length
      ? computedSalaryState.records
      : (salariesSnap.exists()
          ? ((salariesSnap.data() as TeamSalariesDoc).players ?? [])
          : []);
    const total = salaryRecords.reduce((sum, record) => sum + record.salary, 0);
    if (total <= 0) {
      chargedAmount = null;
      return;
    }

    const balanceSource = Number.isFinite(teamData?.transferBudget)
      ? Number(teamData?.transferBudget)
      : Number.isFinite(teamData?.budget)
        ? Number(teamData?.budget)
        : (financeSnap.data()?.balance ?? INITIAL_CLUB_BALANCE);
    const balance = normalizeClubBalance(balanceSource);
    if (balance < total) {
      throw new Error('Yetersiz bakiye.');
    }

    tx.set(
      teamSalariesDoc(teamId),
      {
        players: salaryRecords,
        total,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    if (computedSalaryState.changed || salaryMotivationState.changed) {
      tx.set(
        teamRef,
        {
          players: salaryMotivationState.players,
        },
        { merge: true },
      );
    }
    const nextBalance = balance - total;
    tx.update(financeRef, {
      balance: nextBalance,
      updatedAt: serverTimestamp(),
    });
    tx.set(
      teamRef,
      {
        budget: nextBalance,
        transferBudget: nextBalance,
      },
      { merge: true },
    );
    tx.set(
      scheduleRef,
      {
        lastChargedMonth: monthKey,
        lastChargedAt: serverTimestamp(),
        lastAmount: total,
      },
      { merge: true },
    );
    chargedAmount = total;
  });

  if (chargedAmount && chargedAmount > 0) {
    await addFinanceHistoryEntry(teamId, {
      type: 'expense',
      category: 'salary',
      amount: chargedAmount,
      note: `${monthKey} maas odemesi`,
    });
  }

  return chargedAmount;
}

export async function upgradeStadiumLevel(teamId: string): Promise<StadiumState> {
  await ensureFinanceProfile(teamId);
  let upgraded: StadiumState | null = null;
  const teamRef = teamDoc(teamId);

  await runTransaction(db, async (tx) => {
    const stadiumRef = teamStadiumDoc(teamId);
    const financeRef = financeDoc(teamId);
    const [stadiumSnap, financeSnap, teamSnap] = await Promise.all([
      tx.get(stadiumRef),
      tx.get(financeRef),
      tx.get(teamRef),
    ]);
    const currentLevel = (stadiumSnap.data()?.level ?? 1) as StadiumLevel;
    if (currentLevel >= 5) {
      throw new Error('Stadyum zaten maksimum seviyede.');
    }
    const nextLevel = (currentLevel + 1) as StadiumLevel;
    const nextConfig = STADIUM_LEVELS[nextLevel];
    const teamData = teamSnap.data() as { budget?: number; transferBudget?: number; players?: Player[] } | undefined;
    const balanceSource = Number.isFinite(teamData?.transferBudget)
      ? Number(teamData?.transferBudget)
      : Number.isFinite(teamData?.budget)
        ? Number(teamData?.budget)
        : (financeSnap.data()?.balance ?? INITIAL_CLUB_BALANCE);
    const balance = normalizeClubBalance(balanceSource);
    if (balance < nextConfig.upgradeCost) {
      throw new Error('Yetersiz bakiye.');
    }

    tx.set(
      stadiumRef,
      {
        level: nextLevel,
        incomePerMatch: getMatchRevenueEstimate(nextLevel, teamData?.players ?? []).matchEstimate,
        upgradeCost: STADIUM_LEVELS[Math.min(5, nextLevel + 1) as StadiumLevel]?.upgradeCost ?? 0,
        upgradedAt: serverTimestamp(),
      },
      { merge: true },
    );
    const nextBalance = balance - nextConfig.upgradeCost;
    tx.update(financeRef, {
      balance: nextBalance,
      updatedAt: serverTimestamp(),
    });
    tx.set(
      teamRef,
      {
        budget: nextBalance,
        transferBudget: nextBalance,
      },
      { merge: true },
    );
  upgraded = {
      level: nextLevel,
      incomePerMatch: getMatchRevenueEstimate(nextLevel, teamData?.players ?? []).matchEstimate,
      upgradeCost: STADIUM_LEVELS[Math.min(5, nextLevel + 1) as StadiumLevel]?.upgradeCost ?? 0,
    };
  });

  if (!upgraded) {
    throw new Error('Stadyum guncellenemedi.');
  }

  await addFinanceHistoryEntry(teamId, {
    type: 'expense',
    category: 'stadium',
    amount: STADIUM_LEVELS[upgraded.level].upgradeCost,
    note: `Stadyum ${upgraded.level}. seviye`,
  });

  return upgraded;
}

export async function recordCreditPurchase(teamId: string, pack: CreditPackage): Promise<void> {
  await ensureFinanceProfile(teamId);
  await runTransaction(db, async (tx) => {
    const financeRef = financeDoc(teamId);
    const teamRef = teamDoc(teamId);
    const [financeSnap, teamSnap] = await Promise.all([tx.get(financeRef), tx.get(teamRef)]);
    const teamData = teamSnap.data() as { budget?: number; transferBudget?: number } | undefined;
    const currentBalanceSource = Number.isFinite(teamData?.transferBudget)
      ? Number(teamData?.transferBudget)
      : Number.isFinite(teamData?.budget)
        ? Number(teamData?.budget)
        : (financeSnap.data()?.balance ?? INITIAL_CLUB_BALANCE);
    const nextBalance = normalizeClubBalance(currentBalanceSource + pack.amount);
    tx.set(
      financeRef,
      {
        balance: nextBalance,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      teamRef,
      {
        budget: nextBalance,
        transferBudget: nextBalance,
      },
      { merge: true },
    );
  });

  const creditsRef = doc(creditCollection(teamId));
  await setDoc(creditsRef, {
    id: creditsRef.id,
    packageId: pack.id,
    amount: pack.amount,
    price: pack.price,
    purchasedAt: serverTimestamp(),
  });

  await addFinanceHistoryEntry(teamId, {
    type: 'income',
    category: 'loan',
    amount: pack.amount,
    note: `Kredi paketi (${pack.id})`,
  });
}

export async function activateSponsor(
  sponsor: SponsorCatalogEntry,
): Promise<ActivateUserSponsorResponse> {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import('firebase/functions'),
    import('./firebase'),
  ]);
  const activateUserSponsorCallable = httpsCallable<
    { sponsorId: string },
    ActivateUserSponsorResponse
  >(functions, 'activateUserSponsor');
  const response = await activateUserSponsorCallable({ sponsorId: sponsor.id });
  return response.data;
}

export async function applySponsorEarnings(
  sponsorId: string,
): Promise<CollectUserSponsorEarningsResponse> {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import('firebase/functions'),
    import('./firebase'),
  ]);
  const collectUserSponsorEarningsCallable = httpsCallable<
    { sponsorId: string },
    CollectUserSponsorEarningsResponse
  >(functions, 'collectUserSponsorEarnings');
  const response = await collectUserSponsorEarningsCallable({ sponsorId });
  return response.data;

  /*

  
    const lastPayoutMs = data.lastPayoutAt?.toMillis();
    const lastPayout = lastPayoutMs ?? data.activatedAt.toMillis();
    const nextPayoutAt = data.nextPayoutAt?.toMillis();
    if (nextPayoutAt && nowMs < nextPayoutAt) {
      throw new Error('Bir sonraki sponsorluk odemesi henüz hazir degil.');
    }
    const periods = Math.floor((nowMs - lastPayout) / cadenceMs);
    if (periods <= 0) {
      throw new Error('Bugun icin odeme yapildi.');
    }
    payout = periods * reward.amount;
    const teamData = teamSnap.data() as { budget?: number; transferBudget?: number } | undefined;
    const balanceSource = Number.isFinite(teamData?.transferBudget)
      ? Number(teamData?.transferBudget)
      : Number.isFinite(teamData?.budget)
        ? Number(teamData?.budget)
        : (financeSnap.data()?.balance ?? INITIAL_CLUB_BALANCE);
    const balance = normalizeClubBalance(balanceSource);

    const nextBalance = balance + payout;
    tx.update(financeRef, {
      balance: nextBalance,
      updatedAt: serverTimestamp(),
    });
    tx.set(
      teamRef,
      {
        budget: nextBalance,
        transferBudget: nextBalance,
      },
      { merge: true },
    );
    tx.update(ref, {
      lastPayoutAt: Timestamp.fromMillis(nowMs),
      nextPayoutAt: Timestamp.fromMillis(nowMs + cadenceMs),
      updatedAt: serverTimestamp(),
    });
  });

  await addFinanceHistoryEntry(teamId, {
    type: 'income',
    category: 'sponsor',
    amount: payout,
    note: 'Sponsor getirisi',
  });

  return payout;
  */
}

export async function claimVipDailyCredits(): Promise<ClaimVipDailyCreditResponse> {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import('firebase/functions'),
    import('./firebase'),
  ]);
  const claimVipDailyCreditsCallable = httpsCallable<
    Record<string, never>,
    ClaimVipDailyCreditResponse
  >(functions, 'claimVipDailyCredits');
  const response = await claimVipDailyCreditsCallable({});
  return response.data;
}

export function getExpectedRevenue(
  stadium: StadiumState | null,
  sponsors: UserSponsorDoc[],
  players: Player[] = [],
  monthlyExpense = 0,
): ExpectedRevenueBreakdown {
  const level = stadium?.level ?? 1;
  const baseEstimate = players.length
    ? getMatchRevenueEstimate(level, players)
    : {
        ...getMatchRevenueEstimate(level),
        matchEstimate: stadium?.incomePerMatch ?? STADIUM_LEVELS[level].matchIncome,
        monthlyMatchEstimate: roundRevenue((stadium?.incomePerMatch ?? STADIUM_LEVELS[level].matchIncome) * MATCHES_PER_MONTH),
      };
  const sponsorEstimate = sponsors
    .filter((sponsor) => sponsor.active)
    .reduce((sum, sponsor) => {
      const multiplier = sponsor.reward.cycle === 'daily' ? 30 : 30 / 7;
      return sum + sponsor.reward.amount * multiplier;
    }, 0);
  const monthly = roundRevenue(baseEstimate.monthlyMatchEstimate + sponsorEstimate);
  const projectedMonthlyExpense = roundRevenue(monthlyExpense);
  return {
    monthly,
    matchEstimate: baseEstimate.matchEstimate,
    sponsorEstimate,
    matchesPerMonth: baseEstimate.matchesPerMonth,
    teamStrength: baseEstimate.teamStrength,
    attendanceRate: baseEstimate.attendanceRate,
    occupiedSeats: baseEstimate.occupiedSeats,
    projectedDailyIncome: roundRevenue(monthly / 30),
    monthlyMatchEstimate: baseEstimate.monthlyMatchEstimate,
    projectedMonthlyExpense,
    projectedMonthlyNet: roundSignedAmount(monthly - projectedMonthlyExpense),
  };
}

export interface TransferFinanceRecordOptions {
  amount: number;
  playerName?: string;
  contextId?: string;
  note?: string;
}

export async function recordTransferExpense(teamId: string, payload: TransferFinanceRecordOptions): Promise<void> {
  if (!payload.amount || payload.amount <= 0) {
    return;
  }
  await ensureFinanceProfile(teamId);
  await addFinanceHistoryEntry(teamId, {
    type: 'expense',
    category: 'transfer',
    amount: payload.amount,
    source: payload.contextId ?? payload.playerName ?? undefined,
    note: payload.note ?? (payload.playerName ? `${payload.playerName} transfer ucreti` : 'Transfer ucreti'),
  });
}

export async function recordTransferRefund(teamId: string, payload: TransferFinanceRecordOptions): Promise<void> {
  if (!payload.amount || payload.amount <= 0) {
    return;
  }
  await ensureFinanceProfile(teamId);
  await addFinanceHistoryEntry(teamId, {
    type: 'income',
    category: 'transfer',
    amount: payload.amount,
    source: payload.contextId ?? payload.playerName ?? undefined,
    note: payload.note ?? (payload.playerName ? `${payload.playerName} transfer iadesi` : 'Transfer iadesi'),
  });
}

const reconcileInFlight = new Map<string, Promise<number>>();

export async function reconcileClubFinance(teamId: string): Promise<number> {
  const existing = reconcileInFlight.get(teamId);
  if (existing) {
    return existing;
  }

  const task = (async () => {
    await ensureFinanceProfile(teamId);

    const [teamSnap, financeSnap, historySnap] = await Promise.all([
      getDoc(teamDoc(teamId)),
      getDoc(financeDoc(teamId)),
      getDocs(financeHistoryPreviewQuery(teamId)),
    ]);

    if (!teamSnap.exists()) {
      throw new Error('Takim bulunamadi.');
    }

    const teamData = (teamSnap.data() as TeamBudgetSource | undefined) ?? undefined;
    const financeData = financeSnap.exists()
      ? ((financeSnap.data() as FinanceBalanceSource | undefined) ?? undefined)
      : undefined;
    const balance = resolveCanonicalClubBalance(teamData, financeData, {
      hasHistory: !historySnap.empty,
    });

    await Promise.all([
      setDoc(
        financeDoc(teamId),
        {
          balance,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
      setDoc(
        teamDoc(teamId),
        {
          budget: balance,
          transferBudget: balance,
        },
        { merge: true },
      ),
    ]);

    return balance;
  })().finally(() => {
    reconcileInFlight.delete(teamId);
  });

  reconcileInFlight.set(teamId, task);
  return task;
}

export async function syncFinanceBalanceWithTeam(teamId: string): Promise<number> {
  return reconcileClubFinance(teamId);
}

export { ensureMonthlySalaryCharge as calculateMonthlySalaries };
