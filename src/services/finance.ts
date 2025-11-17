import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Player } from '@/types';

export type FinanceHistoryCategory = 'match' | 'sponsor' | 'loan' | 'salary' | 'stadium' | 'transfer';

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
  1: { capacity: 1_000, matchIncome: 1_000, upgradeCost: 0 },
  2: { capacity: 3_000, matchIncome: 3_000, upgradeCost: 20_000 },
  3: { capacity: 7_500, matchIncome: 7_500, upgradeCost: 50_000 },
  4: { capacity: 15_000, matchIncome: 12_000, upgradeCost: 100_000 },
  5: { capacity: 30_000, matchIncome: 20_000, upgradeCost: 200_000 },
};

export interface CreditPackage {
  id: string;
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
  name: string;
  type: SponsorType;
  reward: SponsorReward;
  price?: number;
}

export interface UserSponsorDoc {
  id: string;
  catalogId: string;
  name: string;
  type: SponsorType;
  reward: SponsorReward;
  price?: number;
  active: boolean;
  activatedAt: Timestamp;
  lastPayoutAt?: Timestamp | null;
  nextPayoutAt?: Timestamp | null;
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

const FINANCE_DEFAULT_BALANCE = 50_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const financeDoc = (uid: string) => doc(db, 'finance', uid);
const historyCollection = (uid: string) => collection(db, 'finance', 'history', uid);
const creditCollection = (uid: string) => collection(db, 'finance', 'credits', uid);
const teamDoc = (teamId: string) => doc(db, 'teams', teamId);
const teamStadiumDoc = (teamId: string) => doc(db, 'teams', teamId, 'stadium', 'state');
const teamSalariesDoc = (teamId: string) => doc(db, 'teams', teamId, 'salaries', 'current');
const teamSalariesScheduleDoc = (teamId: string) => doc(db, 'teams', teamId, 'salaries', 'schedule');
const sponsorshipCollection = (uid: string) => collection(db, 'users', uid, 'sponsorships');

const randomId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);

export const getSalaryForOverall = (overall: number): number => {
  if (overall >= 90) return 25_000;
  if (overall >= 80) return 18_000;
  if (overall >= 70) return 12_000;
  if (overall >= 60) return 8_000;
  if (overall >= 50) return 5_000;
  return 3_500;
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
    await setDoc(ref, { balance: FINANCE_DEFAULT_BALANCE, updatedAt: serverTimestamp() });
  }
}

async function ensureStadiumDoc(teamId: string): Promise<void> {
  const ref = teamStadiumDoc(teamId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const config = STADIUM_LEVELS[1];
    await setDoc(ref, {
      level: 1,
      incomePerMatch: config.matchIncome,
      upgradeCost: STADIUM_LEVELS[2].upgradeCost,
      upgradedAt: serverTimestamp(),
    });
  }
}

export async function ensureFinanceProfile(teamId: string): Promise<void> {
  await Promise.all([ensureFinanceDoc(teamId), ensureStadiumDoc(teamId)]);
}

const buildSalaryRecords = (players: Player[]): TeamSalaryRecord[] =>
  players.map((player) => {
    const overall = typeof player.overall === 'number' ? player.overall : 0;
    const salary = getSalaryForOverall(overall);
    return {
      playerId: String(player.id),
      name: player.name,
      position: player.position,
      overall,
      salary,
    };
  });

export async function syncTeamSalaries(teamId: string): Promise<TeamSalariesDoc> {
  const teamSnap = await getDoc(teamDoc(teamId));
  if (!teamSnap.exists()) {
    throw new Error('Takim bulunamadi.');
  }
  const team = teamSnap.data() as { players?: Player[] };
  const players = buildSalaryRecords(team.players ?? []);
  const total = players.reduce((sum, record) => sum + record.salary, 0);
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
    const salaryRecords = salariesSnap.exists()
      ? ((salariesSnap.data() as TeamSalariesDoc).players ?? [])
      : buildSalaryRecords(teamData?.players ?? []);
    const total = salaryRecords.reduce((sum, record) => sum + record.salary, 0);
    if (total <= 0) {
      chargedAmount = null;
      return;
    }

    const balanceSource = Number.isFinite(teamData?.budget)
      ? Number(teamData?.budget)
      : Number.isFinite(teamData?.transferBudget)
        ? Number(teamData?.transferBudget)
        : (financeSnap.data()?.balance ?? FINANCE_DEFAULT_BALANCE);
    const balance = Math.max(0, Math.round(balanceSource));
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
    const teamData = teamSnap.data() as { budget?: number; transferBudget?: number } | undefined;
    const balanceSource = Number.isFinite(teamData?.budget)
      ? Number(teamData?.budget)
      : Number.isFinite(teamData?.transferBudget)
        ? Number(teamData?.transferBudget)
        : (financeSnap.data()?.balance ?? FINANCE_DEFAULT_BALANCE);
    const balance = Math.max(0, Math.round(balanceSource));
    if (balance < nextConfig.upgradeCost) {
      throw new Error('Yetersiz bakiye.');
    }

    tx.set(
      stadiumRef,
      {
        level: nextLevel,
        incomePerMatch: nextConfig.matchIncome,
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
      incomePerMatch: nextConfig.matchIncome,
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
    const currentBalanceSource = Number.isFinite(teamData?.budget)
      ? Number(teamData?.budget)
      : Number.isFinite(teamData?.transferBudget)
        ? Number(teamData?.transferBudget)
        : (financeSnap.data()?.balance ?? FINANCE_DEFAULT_BALANCE);
    const nextBalance = Math.max(0, Math.round(currentBalanceSource + pack.amount));
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

export async function activateSponsor(teamId: string, sponsor: SponsorCatalogEntry): Promise<void> {
  await ensureFinanceProfile(teamId);
  const col = sponsorshipCollection(teamId);
  const existing = await getDocs(col);
  const batch = writeBatch(db);

  existing.forEach((docSnap) => {
    const isSelectedSponsor = docSnap.id === sponsor.id;
    batch.set(
      docSnap.ref,
      {
        active: isSelectedSponsor,
        ...(isSelectedSponsor
          ? {
              catalogId: sponsor.id,
              name: sponsor.name,
              type: sponsor.type,
              reward: sponsor.reward,
              price: sponsor.price ?? null,
              activatedAt: serverTimestamp(),
              lastPayoutAt: null,
              nextPayoutAt: null,
            }
          : {}),
      },
      { merge: true },
    );
  });

  if (!existing.docs.some((docSnap) => docSnap.id === sponsor.id)) {
    const ref = doc(col, sponsor.id);
    batch.set(ref, {
      id: sponsor.id,
      catalogId: sponsor.id,
      name: sponsor.name,
      type: sponsor.type,
      reward: sponsor.reward,
      price: sponsor.price ?? null,
      active: true,
      activatedAt: serverTimestamp(),
      lastPayoutAt: null,
      nextPayoutAt: null,
    });
  }

  await batch.commit();
}

export async function applySponsorEarnings(teamId: string, sponsorId: string): Promise<number> {
  await ensureFinanceProfile(teamId);
  const ref = doc(sponsorshipCollection(teamId), sponsorId);
  const financeRef = financeDoc(teamId);
  const teamRef = teamDoc(teamId);
  let payout = 0;

  await runTransaction(db, async (tx) => {
    const [sponsorSnap, financeSnap, teamSnap] = await Promise.all([tx.get(ref), tx.get(financeRef), tx.get(teamRef)]);
    if (!sponsorSnap.exists()) {
      throw new Error('Sponsor bulunamadi.');
    }
    const data = sponsorSnap.data() as UserSponsorDoc;
    if (!data.active) {
      throw new Error('Sponsor aktif degil.');
    }
    const reward = data.reward;
    const cadenceMs = reward.cycle === 'weekly' ? 7 * DAY_MS : DAY_MS;
    const nowMs = sponsorSnap.readTime?.toMillis() ?? Date.now();
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
    const balanceSource = Number.isFinite(teamData?.budget)
      ? Number(teamData?.budget)
      : Number.isFinite(teamData?.transferBudget)
        ? Number(teamData?.transferBudget)
        : (financeSnap.data()?.balance ?? FINANCE_DEFAULT_BALANCE);
    const balance = Math.max(0, Math.round(balanceSource));

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
}

export interface ExpectedRevenueBreakdown {
  monthly: number;
  matchEstimate: number;
  sponsorEstimate: number;
  matchesPerMonth: number;
}

export function getExpectedRevenue(stadium: StadiumState | null, sponsors: UserSponsorDoc[]): ExpectedRevenueBreakdown {
  const matchesPerMonth = 4;
  const matchIncome = stadium?.incomePerMatch ?? STADIUM_LEVELS[stadium?.level ?? 1].matchIncome;
  const matchEstimate = Math.max(0, matchIncome * matchesPerMonth);
  const sponsorEstimate = sponsors
    .filter((sponsor) => sponsor.active)
    .reduce((sum, sponsor) => {
      const multiplier = sponsor.reward.cycle === 'daily' ? 30 : 4;
      return sum + sponsor.reward.amount * multiplier;
    }, 0);
  return {
    monthly: matchEstimate + sponsorEstimate,
    matchEstimate,
    sponsorEstimate,
    matchesPerMonth,
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

export async function syncFinanceBalanceWithTeam(teamId: string): Promise<number> {
  await ensureFinanceProfile(teamId);
  const teamSnap = await getDoc(teamDoc(teamId));
  if (!teamSnap.exists()) {
    throw new Error('Takim bulunamadi.');
  }
  const team = teamSnap.data() as { budget?: number; transferBudget?: number } | undefined;
  const rawBalance = Number.isFinite(team?.transferBudget)
    ? Number(team?.transferBudget)
    : Number.isFinite(team?.budget)
      ? Number(team?.budget)
      : FINANCE_DEFAULT_BALANCE;
  const balance = Math.max(0, Math.round(rawBalance));
  await setDoc(
    financeDoc(teamId),
    {
      balance,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return balance;
}

export { ensureMonthlySalaryCharge as calculateMonthlySalaries };
