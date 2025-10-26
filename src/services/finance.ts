import {
  arrayUnion,
  collection,
  doc,
  DocumentReference,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Player, Position } from '@/types';
import { addPlayerToTeam } from './team';

const DEFAULT_BALANCE = 250_000;

export type StadiumLevel = 1 | 2 | 3 | 4 | 5;

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

export interface StadiumState {
  level: StadiumLevel;
  upgradedAt?: Timestamp;
}

export interface MonthlyExpenseState {
  amount: number;
  calculatedAt: Timestamp;
}

export interface FinanceDoc {
  balance: number;
  monthly_expense?: MonthlyExpenseState | null;
  credit_purchases?: { id: string; amount: number; createdAt: Timestamp }[];
}

export type FinanceHistoryCategory = 'salary' | 'stadium' | 'match' | 'sponsor' | 'loan' | 'transfer';

export interface FinanceHistoryEntry {
  id: string;
  type: 'income' | 'expense';
  category: FinanceHistoryCategory;
  amount: number;
  timestamp: Timestamp;
  note?: string;
}

export interface NegotiationOfferEntry {
  id: string;
  amount: number;
  createdAt: Timestamp;
  accepted: boolean;
}

export interface NegotiationSession {
  id: string;
  playerName: string;
  position: Position;
  overall: number;
  patience: number;
  maxPatience: number;
  askingSalary: number;
  transferFee: number;
  offers: NegotiationOfferEntry[];
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'signed';
  createdAt: Timestamp;
  updatedAt: Timestamp;
  agreedSalary?: number;
}

export interface SponsorReward {
  amount: number;
  cadence: 'daily' | 'weekly';
}

export interface SponsorCatalogEntry {
  id: string;
  name: string;
  type: 'free' | 'premium';
  reward: SponsorReward;
  price?: number;
}

export interface UserSponsorDoc {
  id: string;
  catalogId: string;
  name: string;
  type: 'free' | 'premium';
  reward: SponsorReward;
  price?: number;
  active: boolean;
  startDate: Timestamp;
  lastPayoutAt?: Timestamp;
}

const financeDoc = (uid: string) => doc(db, 'finance', uid);
const financeHistoryDoc = (uid: string) => doc(db, 'finance_history', uid);
const stadiumDoc = (uid: string) => doc(db, 'stadium', uid);
const teamDoc = (uid: string) => doc(db, 'teams', uid);
const negotiationCollection = (uid: string) => collection(db, 'transferNegotiations', uid, 'sessions');
const negotiationDoc = (uid: string, negotiationId: string) => doc(db, 'transferNegotiations', uid, 'sessions', negotiationId);
const sponsorCatalogCollection = collection(db, 'sponsorship_catalog');
const userSponsorDoc = (uid: string, sponsorId: string) => doc(db, 'users', uid, 'sponsorships', sponsorId);

const randomId = () => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
};

const ensureDocument = async (ref: DocumentReference, defaults: Record<string, unknown>) => {
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, defaults);
  }
};

export async function ensureFinanceProfile(uid: string): Promise<void> {
  await Promise.all([
    ensureDocument(financeDoc(uid), { balance: DEFAULT_BALANCE }),
    ensureDocument(stadiumDoc(uid), { level: 1 as StadiumLevel }),
    ensureDocument(financeHistoryDoc(uid), { entries: [] }),
  ]);
}

export const getSalaryForOverall = (overall: number): number => {
  if (overall >= 90) return 25_000;
  if (overall >= 80) return 18_000;
  if (overall >= 70) return 12_000;
  if (overall >= 60) return 8_000;
  if (overall >= 50) return 5_000;
  return 3_500;
};

const appendHistory = async (uid: string, entry: FinanceHistoryEntry) => {
  await setDoc(
    financeHistoryDoc(uid),
    {
      entries: arrayUnion(entry),
    },
    { merge: true },
  );
};

const buildHistoryEntry = (
  type: 'income' | 'expense',
  category: FinanceHistoryCategory,
  amount: number,
  note?: string,
): FinanceHistoryEntry => ({
  id: randomId(),
  type,
  category,
  amount,
  timestamp: Timestamp.now(),
  note,
});

export async function upgradeStadiumLevel(uid: string): Promise<StadiumState> {
  await ensureFinanceProfile(uid);
  let historyEntry: FinanceHistoryEntry | null = null;
  const result = await runTransaction(db, async (tx) => {
    const stadiumRef = stadiumDoc(uid);
    const financeRef = financeDoc(uid);
    const stadiumSnap = await tx.get(stadiumRef);
    const financeSnap = await tx.get(financeRef);
    const currentLevel = (stadiumSnap.data()?.level ?? 1) as StadiumLevel;
    if (currentLevel >= 5) {
      throw new Error('Stadyum zaten maksimum seviyede');
    }
    const nextLevel = (currentLevel + 1) as StadiumLevel;
    const cost = STADIUM_LEVELS[nextLevel].upgradeCost;
    const balance = (financeSnap.data()?.balance ?? DEFAULT_BALANCE) as number;
    if (balance < cost) {
      throw new Error('Yetersiz bakiye');
    }
    tx.set(
      stadiumRef,
      {
        level: nextLevel,
        upgradedAt: serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      financeRef,
      {
        balance: balance - cost,
      },
      { merge: true },
    );
    historyEntry = buildHistoryEntry('expense', 'stadium', cost, `Seviye ${nextLevel} gelistirme`);
    return { level: nextLevel, upgradedAt: Timestamp.now() } satisfies StadiumState;
  });
  if (historyEntry) {
    await appendHistory(uid, historyEntry);
  }
  return result;
}

export async function calculateMonthlySalaries(uid: string): Promise<number> {
  await ensureFinanceProfile(uid);
  let historyEntry: FinanceHistoryEntry | null = null;
  const total = await runTransaction(db, async (tx) => {
    const teamRef = teamDoc(uid);
    const financeRef = financeDoc(uid);
    const teamSnap = await tx.get(teamRef);
    const financeSnap = await tx.get(financeRef);
    if (!teamSnap.exists()) {
      throw new Error('Takim bulunamadi');
    }
    const teamData = teamSnap.data() as { players?: Player[] };
    const players = teamData.players ?? [];
    if (!players.length) {
      throw new Error('Takimda oyuncu yok');
    }
    const updatedPlayers = players.map((player) => {
      const salary = getSalaryForOverall(player.overall);
      return {
        ...player,
        contract: {
          status: player.contract?.status ?? 'active',
          expiresAt: player.contract?.expiresAt ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          salary,
        },
      } as Player;
    });
    const totalSalary = updatedPlayers.reduce((sum, player) => sum + (player.contract?.salary ?? 0), 0);
    const balance = (financeSnap.data()?.balance ?? DEFAULT_BALANCE) as number;
    if (balance < totalSalary) {
      throw new Error('Yetersiz bakiye');
    }
    tx.update(teamRef, { players: updatedPlayers });
    tx.set(
      financeRef,
      {
        balance: balance - totalSalary,
        monthly_expense: {
          amount: totalSalary,
          calculatedAt: serverTimestamp(),
        },
      },
      { merge: true },
    );
    historyEntry = buildHistoryEntry('expense', 'salary', totalSalary, 'Aylik Maas');
    return totalSalary;
  });
  if (historyEntry) {
    await appendHistory(uid, historyEntry);
  }
  return total;
}

const buildNegotiatedPlayer = (session: NegotiationSession, salary: number): Player => {
  const attributeValue = Math.min(0.95, Math.max(0.4, session.overall / 100));
  const attr = () => Number(attributeValue.toFixed(3));
  return {
    id: `neg-${session.id}`,
    name: session.playerName,
    position: session.position,
    roles: [session.position],
    overall: session.overall,
    potential: Math.min(99, session.overall + 5),
    attributes: {
      strength: attr(),
      acceleration: attr(),
      topSpeed: attr(),
      dribbleSpeed: attr(),
      jump: attr(),
      tackling: attr(),
      ballKeeping: attr(),
      passing: attr(),
      longBall: attr(),
      agility: attr(),
      shooting: attr(),
      shootPower: attr(),
      positioning: attr(),
      reaction: attr(),
      ballControl: attr(),
    },
    age: 24,
    height: 182,
    weight: 78,
    condition: 0.85,
    motivation: 0.82,
    injuryStatus: 'healthy',
    squadRole: 'reserve',
    contract: {
      status: 'active',
      salary,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    },
  };
};

export interface NegotiationPayload {
  playerName: string;
  position: Position;
  overall: number;
  transferFee: number;
}

export async function createNegotiationSession(uid: string, payload: NegotiationPayload): Promise<void> {
  await ensureFinanceProfile(uid);
  const financeRef = financeDoc(uid);
  const sessionRef = doc(negotiationCollection(uid));
  const askingSalary = Math.round(payload.overall * 150);
  let historyEntry: FinanceHistoryEntry | null = null;
  await runTransaction(db, async (tx) => {
    const financeSnap = await tx.get(financeRef);
    const balance = (financeSnap.data()?.balance ?? DEFAULT_BALANCE) as number;
    if (balance < payload.transferFee) {
      throw new Error('Transfer ucreti icin bakiye yetersiz');
    }
    tx.set(
      financeRef,
      { balance: balance - payload.transferFee },
      { merge: true },
    );
    tx.set(sessionRef, {
      id: sessionRef.id,
      playerName: payload.playerName,
      position: payload.position,
      overall: payload.overall,
      patience: 3,
      maxPatience: 3,
      askingSalary,
      transferFee: payload.transferFee,
      offers: [],
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    historyEntry = buildHistoryEntry('expense', 'transfer', payload.transferFee, payload.playerName);
  });
  if (historyEntry) {
    await appendHistory(uid, historyEntry);
  }
}

export async function submitNegotiationOffer(uid: string, sessionId: string, amount: number): Promise<'pending' | 'accepted' | 'rejected'> {
  const sessionRef = negotiationDoc(uid, sessionId);
  let result: 'pending' | 'accepted' | 'rejected' = 'pending';
  await runTransaction(db, async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists()) {
      throw new Error('Gorusme bulunamadi');
    }
    const session = sessionSnap.data() as NegotiationSession;
    if (session.status !== 'pending') {
      throw new Error('Gorusme tamamlanmis');
    }
    const offers = [...(session.offers ?? [])];
    offers.push({ id: randomId(), amount, createdAt: Timestamp.now(), accepted: amount >= session.askingSalary });
    const update: Partial<NegotiationSession> = {
      offers,
      updatedAt: serverTimestamp(),
    };
    if (amount >= session.askingSalary) {
      update.status = 'accepted';
      update.agreedSalary = amount;
      result = 'accepted';
    } else {
      const nextPatience = Math.max(0, session.patience - 1);
      update.patience = nextPatience;
      if (nextPatience === 0) {
        update.status = 'rejected';
        result = 'rejected';
      }
    }
    tx.update(sessionRef, update);
  });
  if (result === 'accepted') {
    await finalizeNegotiationHire(uid, sessionId);
  }
  return result;
}

export async function acceptNegotiationSession(uid: string, sessionId: string): Promise<void> {
  const sessionRef = negotiationDoc(uid, sessionId);
  await runTransaction(db, async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists()) {
      throw new Error('Gorusme bulunamadi');
    }
    const session = sessionSnap.data() as NegotiationSession;
    if (session.status !== 'pending') {
      throw new Error('Gorusme aktif degil');
    }
    tx.update(sessionRef, {
      status: 'accepted',
      agreedSalary: session.askingSalary,
      updatedAt: serverTimestamp(),
    });
  });
  await finalizeNegotiationHire(uid, sessionId);
}

export async function cancelNegotiationSession(uid: string, sessionId: string): Promise<void> {
  const sessionRef = negotiationDoc(uid, sessionId);
  const financeRef = financeDoc(uid);
  let historyEntry: FinanceHistoryEntry | null = null;
  await runTransaction(db, async (tx) => {
    const [sessionSnap, financeSnap] = await Promise.all([tx.get(sessionRef), tx.get(financeRef)]);
    if (!sessionSnap.exists()) {
      throw new Error('Gorusme bulunamadi');
    }
    const session = sessionSnap.data() as NegotiationSession;
    if (session.status !== 'pending') {
      throw new Error('Yalnizca aktif gorusmeler iptal edilebilir');
    }
    const balance = (financeSnap.data()?.balance ?? DEFAULT_BALANCE) as number;
    tx.set(
      financeRef,
      {
        balance: balance + session.transferFee,
      },
      { merge: true },
    );
    tx.update(sessionRef, {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
    historyEntry = buildHistoryEntry('income', 'transfer', session.transferFee, 'Iade');
  });
  if (historyEntry) {
    await appendHistory(uid, historyEntry);
  }
}

async function finalizeNegotiationHire(uid: string, sessionId: string) {
  const sessionSnap = await getDoc(negotiationDoc(uid, sessionId));
  if (!sessionSnap.exists()) {
    return;
  }
  const session = sessionSnap.data() as NegotiationSession;
  if (session.status === 'signed') {
    return;
  }
  const salary = session.agreedSalary ?? session.askingSalary;
  const player = buildNegotiatedPlayer(session, salary);
  await addPlayerToTeam(uid, player);
  await updateDoc(negotiationDoc(uid, sessionId), {
    status: 'signed',
    agreedSalary: salary,
    updatedAt: serverTimestamp(),
  });
}

export interface SponsorPayload {
  name: string;
  type: 'free' | 'premium';
  reward: SponsorReward;
  price?: number;
}

export async function createSponsorCatalogEntry(payload: SponsorPayload): Promise<void> {
  const ref = doc(sponsorCatalogCollection);
  await setDoc(ref, {
    id: ref.id,
    ...payload,
    createdAt: serverTimestamp(),
  });
}

export async function attachSponsorToUser(uid: string, sponsor: SponsorCatalogEntry): Promise<void> {
  await ensureFinanceProfile(uid);
  const financeRef = financeDoc(uid);
  let historyEntry: FinanceHistoryEntry | null = null;
  await runTransaction(db, async (tx) => {
    const financeSnap = await tx.get(financeRef);
    const balance = (financeSnap.data()?.balance ?? DEFAULT_BALANCE) as number;
    if (sponsor.type === 'premium' && sponsor.price && balance < sponsor.price) {
      throw new Error('Sponsor icin yeterli bakiye yok');
    }
    if (sponsor.type === 'premium' && sponsor.price) {
      tx.set(
        financeRef,
        { balance: balance - sponsor.price },
        { merge: true },
      );
      historyEntry = buildHistoryEntry('expense', 'sponsor', sponsor.price, sponsor.name);
    }
    tx.set(
      userSponsorDoc(uid, sponsor.id),
      {
        id: sponsor.id,
        catalogId: sponsor.id,
        name: sponsor.name,
        type: sponsor.type,
        reward: sponsor.reward,
        price: sponsor.price ?? null,
        active: true,
        startDate: serverTimestamp(),
      },
      { merge: true },
    );
  });
  if (historyEntry) {
    await appendHistory(uid, historyEntry);
  }
}

export async function settleSponsorIncome(uid: string, sponsorId: string): Promise<number> {
  const sponsorRef = userSponsorDoc(uid, sponsorId);
  const financeRef = financeDoc(uid);
  let historyEntry: FinanceHistoryEntry | null = null;
  const amount = await runTransaction(db, async (tx) => {
    const [sponsorSnap, financeSnap] = await Promise.all([tx.get(sponsorRef), tx.get(financeRef)]);
    if (!sponsorSnap.exists()) {
      throw new Error('Sponsor bulunamadi');
    }
    const sponsor = sponsorSnap.data() as UserSponsorDoc;
    const now = Timestamp.now();
    const lastPayout = sponsor.lastPayoutAt ?? sponsor.startDate;
    const cadenceMs = sponsor.reward.cadence === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const due = Math.floor((now.toMillis() - lastPayout.toMillis()) / cadenceMs);
    if (due <= 0) {
      throw new Error('Bugun icin odeme yapildi');
    }
    const payout = due * sponsor.reward.amount;
    const balance = (financeSnap.data()?.balance ?? DEFAULT_BALANCE) as number;
    tx.set(
      financeRef,
      { balance: balance + payout },
      { merge: true },
    );
    tx.update(sponsorRef, {
      lastPayoutAt: now,
    });
    historyEntry = buildHistoryEntry('income', 'sponsor', payout, sponsor.name);
    return payout;
  });
  if (historyEntry) {
    await appendHistory(uid, historyEntry);
  }
  return amount;
}
