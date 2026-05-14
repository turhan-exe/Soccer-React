import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import {
  FieldValue,
  getFirestore,
  Timestamp,
} from 'firebase-admin/firestore';

const db = getFirestore();
const region = 'europe-west1';
const TZ = 'Europe/Istanbul';
const FINANCE_DEFAULT_BALANCE = 50_000;
const SALARY_ROUNDING_UNIT = 250;
const LEGACY_SALARY_MAX = 5_000;
const LEGACY_REFRESH_RATIO = 1.35;
const UNDERPAID_SALARY_THRESHOLD = 0.7;
const UNDERPAID_SALARY_RECOVERY_THRESHOLD = 0.85;
const UNDERPAID_MOTIVATION_PENALTY = 0.05;

type PlayerSnapshot = Record<string, unknown> & {
  id?: string;
  name?: string;
  position?: string;
  overall?: number;
  motivation?: number;
  contract?: {
    expiresAt?: string;
    status?: string;
    salary?: number;
    extensions?: number;
  } | null;
  motivationState?: {
    underpaidActive?: boolean;
    underpaidLastAppliedMonth?: string;
  } | null;
};

type TeamDoc = {
  ownerUid?: string;
  budget?: number;
  transferBudget?: number;
  players?: PlayerSnapshot[];
};

type SalaryRecord = {
  playerId: string;
  name: string;
  position: string;
  overall: number;
  salary: number;
};

type SalaryChargeResult = {
  chargedAmount: number | null;
  monthKey: string;
  playerCount: number;
  skippedReason?: 'already_charged' | 'no_salary' | 'team_not_found' | 'insufficient_balance';
  balance?: number;
  nextBalance?: number;
};

const monthKeyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
});

const getIstanbulMonthKey = (date = new Date()): string => {
  const parts = monthKeyFormatter.formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value ?? String(date.getUTCFullYear());
  const month = parts.find(part => part.type === 'month')?.value ?? String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const normalizeClubBalance = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.round(fallback));
  }
  return Math.max(0, Math.round(numeric));
};

const normalizeRawRating = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 2.0) return value * 100;
  if (value <= 10.0) return value * 10;
  return value;
};

const normalizeRatingTo100 = (value?: number | null): number => {
  if (typeof value !== 'number') return 0;
  return Math.max(0, Math.min(99, Math.round(normalizeRawRating(value))));
};

const roundSalary = (value: number): number => {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return Math.max(
    SALARY_ROUNDING_UNIT,
    Math.round(normalized / SALARY_ROUNDING_UNIT) * SALARY_ROUNDING_UNIT,
  );
};

const interpolate = (
  rating: number,
  minRating: number,
  maxRating: number,
  minSalary: number,
  maxSalary: number,
): number => {
  if (maxRating <= minRating) return minSalary;
  const progress = Math.max(0, Math.min(1, (rating - minRating) / (maxRating - minRating)));
  return minSalary + (maxSalary - minSalary) * progress;
};

const getSalaryForOverall = (overall: number): number => {
  const rating = normalizeRatingTo100(overall);
  if (rating <= 45) return roundSalary(interpolate(rating, 0, 45, 1_800, 4_000));
  if (rating <= 55) return roundSalary(interpolate(rating, 45, 55, 4_000, 6_500));
  if (rating <= 65) return roundSalary(interpolate(rating, 55, 65, 6_500, 9_500));
  if (rating <= 75) return roundSalary(interpolate(rating, 65, 75, 9_500, 14_500));
  if (rating <= 85) return roundSalary(interpolate(rating, 75, 85, 14_500, 22_000));
  if (rating <= 95) return roundSalary(interpolate(rating, 85, 95, 22_000, 34_000));
  return roundSalary(interpolate(rating, 95, 99, 34_000, 42_000));
};

const normalizeCurrentSalary = (salary: number | null | undefined): number => {
  if (typeof salary !== 'number' || !Number.isFinite(salary) || salary <= 0) {
    return 0;
  }
  return roundSalary(salary);
};

const shouldRefreshLegacySalary = (
  currentSalary: number | null | undefined,
  overall: number,
): boolean => {
  const normalizedCurrent = normalizeCurrentSalary(currentSalary);
  if (normalizedCurrent <= 0 || normalizedCurrent > LEGACY_SALARY_MAX) {
    return false;
  }
  const recommended = getSalaryForOverall(overall);
  return recommended >= normalizedCurrent * LEGACY_REFRESH_RATIO;
};

const resolvePlayerSalary = (player: PlayerSnapshot): number => {
  const overall = typeof player.overall === 'number' ? player.overall : 0;
  const recommended = getSalaryForOverall(overall);
  const currentSalary = normalizeCurrentSalary(player.contract?.salary);
  if (currentSalary <= 0) return recommended;
  if (shouldRefreshLegacySalary(currentSalary, overall)) return recommended;
  return currentSalary;
};

const clampVitalGauge = (value: unknown, fallback = 0.75): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(3));
};

const buildSalaryState = (
  players: PlayerSnapshot[],
): { records: SalaryRecord[]; normalizedPlayers: PlayerSnapshot[]; changed: boolean } => {
  let changed = false;
  const normalizedPlayers = players.map(player => {
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

  const records = normalizedPlayers.map(player => ({
    playerId: String(player.id ?? ''),
    name: typeof player.name === 'string' ? player.name : 'Oyuncu',
    position: typeof player.position === 'string' ? player.position : '-',
    overall: typeof player.overall === 'number' ? player.overall : 0,
    salary: resolvePlayerSalary(player),
  }));

  return { records, normalizedPlayers, changed };
};

const getSalaryDemand = (player: PlayerSnapshot): number => {
  const salary = resolvePlayerSalary(player);
  const rating = normalizeRatingTo100(typeof player.overall === 'number' ? player.overall : 0);
  const premium = Math.max(1, rating / 60);
  return Math.max(1, Math.round(salary * premium));
};

const applyUnderpaidSalaryPenaltyForMonth = (
  players: PlayerSnapshot[],
  monthKey: string,
): { players: PlayerSnapshot[]; changed: boolean; penalizedPlayerIds: string[] } => {
  let changed = false;
  const penalizedPlayerIds: string[] = [];

  const adjustedPlayers = players.map(player => {
    const contractStatus = player.contract?.status ?? 'active';
    if (!player.contract || contractStatus === 'expired' || contractStatus === 'released') {
      return player;
    }

    const demand = Math.max(1, getSalaryDemand(player));
    const salary = Math.max(0, resolvePlayerSalary(player));
    const ratio = salary / demand;
    const currentState = player.motivationState ?? {};
    let nextState = currentState;
    let nextMotivation = typeof player.motivation === 'number' ? player.motivation : 0.75;
    let playerChanged = false;

    if (ratio < UNDERPAID_SALARY_THRESHOLD) {
      if (currentState.underpaidLastAppliedMonth !== monthKey) {
        nextMotivation = clampVitalGauge(nextMotivation - UNDERPAID_MOTIVATION_PENALTY);
        penalizedPlayerIds.push(String(player.id ?? ''));
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
    } else if (ratio >= UNDERPAID_SALARY_RECOVERY_THRESHOLD && currentState.underpaidActive) {
      nextState = {
        ...currentState,
        underpaidActive: false,
      };
      playerChanged = true;
    }

    if (!playerChanged) return player;
    changed = true;
    return {
      ...player,
      motivation: nextMotivation,
      motivationState: nextState,
    };
  });

  return { players: adjustedPlayers, changed, penalizedPlayerIds };
};

const resolveTeamBalance = (
  teamData: TeamDoc | undefined,
  financeData: { balance?: number } | undefined,
): number => {
  const balanceSource = Number.isFinite(teamData?.transferBudget)
    ? Number(teamData?.transferBudget)
    : Number.isFinite(teamData?.budget)
      ? Number(teamData?.budget)
      : (financeData?.balance ?? FINANCE_DEFAULT_BALANCE);
  return normalizeClubBalance(balanceSource);
};

export async function chargeMonthlySalaryForTeam(
  teamId: string,
  options: { now?: Date; force?: boolean } = {},
): Promise<SalaryChargeResult> {
  const monthKey = getIstanbulMonthKey(options.now ?? new Date());
  const teamRef = db.collection('teams').doc(teamId);
  const financeRef = db.collection('finance').doc(teamId);
  const salariesRef = teamRef.collection('salaries').doc('current');
  const scheduleRef = teamRef.collection('salaries').doc('schedule');
  const historyRef = db.collection('finance').doc('history').collection(teamId).doc(`salary-${monthKey}`);

  return db.runTransaction(async tx => {
    const [teamSnap, financeSnap, scheduleSnap] = await Promise.all([
      tx.get(teamRef),
      tx.get(financeRef),
      tx.get(scheduleRef),
    ]);

    if (!teamSnap.exists) {
      return { chargedAmount: null, monthKey, playerCount: 0, skippedReason: 'team_not_found' };
    }

    const teamData = (teamSnap.data() as TeamDoc | undefined) ?? {};
    const schedule = scheduleSnap.exists
      ? (scheduleSnap.data() as { lastChargedMonth?: string } | undefined)
      : undefined;
    if (!options.force && schedule?.lastChargedMonth === monthKey) {
      return { chargedAmount: null, monthKey, playerCount: 0, skippedReason: 'already_charged' };
    }

    const computedSalaryState = buildSalaryState(Array.isArray(teamData.players) ? teamData.players : []);
    const salaryMotivationState = applyUnderpaidSalaryPenaltyForMonth(
      computedSalaryState.normalizedPlayers,
      monthKey,
    );
    const salaryRecords = computedSalaryState.records;
    const total = salaryRecords.reduce((sum, record) => sum + record.salary, 0);

    tx.set(
      salariesRef,
      {
        players: salaryRecords,
        total,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (computedSalaryState.changed || salaryMotivationState.changed) {
      tx.set(teamRef, { players: salaryMotivationState.players }, { merge: true });
    }

    if (total <= 0) {
      return {
        chargedAmount: null,
        monthKey,
        playerCount: salaryRecords.length,
        skippedReason: 'no_salary',
      };
    }

    const financeData = (financeSnap.data() as { balance?: number } | undefined) ?? undefined;
    const balance = resolveTeamBalance(teamData, financeData);
    if (balance < total) {
      tx.set(
        scheduleRef,
        {
          lastFailedMonth: monthKey,
          lastFailedAt: FieldValue.serverTimestamp(),
          lastFailureReason: 'insufficient_balance',
          lastFailedAmount: total,
        },
        { merge: true },
      );
      return {
        chargedAmount: null,
        monthKey,
        playerCount: salaryRecords.length,
        skippedReason: 'insufficient_balance',
        balance,
      };
    }

    const nextBalance = normalizeClubBalance(balance - total);
    tx.set(
      financeRef,
      {
        balance: nextBalance,
        updatedAt: FieldValue.serverTimestamp(),
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
    tx.set(
      scheduleRef,
      {
        lastChargedMonth: monthKey,
        lastChargedAt: FieldValue.serverTimestamp(),
        lastAmount: total,
      },
      { merge: true },
    );
    tx.set(
      historyRef,
      {
        id: historyRef.id,
        type: 'expense',
        category: 'salary',
        amount: total,
        source: null,
        note: `${monthKey} maas odemesi`,
        timestamp: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      chargedAmount: total,
      monthKey,
      playerCount: salaryRecords.length,
      balance,
      nextBalance,
    };
  });
}

export const ensureMonthlySalaryCharge = functions
  .region(region)
  .https.onCall(async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Giris yapmalisin.');
    }

    const teamId = typeof data?.teamId === 'string' && data.teamId.trim()
      ? data.teamId.trim()
      : uid;
    const teamSnap = await db.collection('teams').doc(teamId).get();
    const ownerUid = String((teamSnap.data() as TeamDoc | undefined)?.ownerUid ?? teamId);
    if (ownerUid !== uid && teamId !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'Bu takim icin yetkin yok.');
    }

    return chargeMonthlySalaryForTeam(teamId);
  });

export const chargeMonthlyTeamSalariesDaily = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(region)
  .pubsub.schedule('17 3 * * *')
  .timeZone(TZ)
  .onRun(async () => {
    const teamsSnap = await db.collection('teams').select('ownerUid').get();
    let chargedTeams = 0;
    let skippedTeams = 0;
    let failedTeams = 0;
    let chargedTotal = 0;

    for (const docSnap of teamsSnap.docs) {
      try {
        const result = await chargeMonthlySalaryForTeam(docSnap.id);
        if (result.chargedAmount && result.chargedAmount > 0) {
          chargedTeams += 1;
          chargedTotal += result.chargedAmount;
        } else {
          skippedTeams += 1;
        }
      } catch (error) {
        failedTeams += 1;
        functions.logger.error('[salaries] charge failed', {
          teamId: docSnap.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    functions.logger.info('[salaries] daily salary charge complete', {
      chargedTeams,
      skippedTeams,
      failedTeams,
      chargedTotal,
    });

    return { chargedTeams, skippedTeams, failedTeams, chargedTotal };
  });
