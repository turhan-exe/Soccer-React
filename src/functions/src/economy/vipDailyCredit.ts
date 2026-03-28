import * as functions from 'firebase-functions/v1';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { formatInTimeZone } from 'date-fns-tz';
import '../_firebase.js';

const db = getFirestore();
const TIME_ZONE = 'Europe/Istanbul';
const DAY_MS = 24 * 60 * 60 * 1000;
const FINANCE_DEFAULT_BALANCE = 50_000;
const VIP_DAILY_CREDIT_AMOUNT = 2_000;
const VIP_DAILY_CREDIT_DIAMOND_COST = 0;

const financeDoc = (uid: string) => db.collection('finance').doc(uid);
const teamDoc = (uid: string) => db.collection('teams').doc(uid);
const userDoc = (uid: string) => db.collection('users').doc(uid);
const claimDoc = (uid: string, claimDate: string) =>
  db.collection('users').doc(uid).collection('vipDailyCreditClaims').doc(claimDate);
const financeHistoryCollection = (uid: string) => db.collection('finance').doc('history').collection(uid);

type VipPlan = 'monthly' | 'semiAnnual' | 'yearly';

type StoredVipState = {
  isActive?: unknown;
  expiresAt?: unknown;
  plan?: unknown;
};

type ResolvedVipState = {
  isActive: boolean;
  expiresAtMs: number | null;
  expiresAtIso: string | null;
  plan: VipPlan | null;
};

const validateAuth = (context: functions.https.CallableContext): string => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Bu islem icin oturum acmaniz gerekir.');
  }
  return uid;
};

const resolveTeamBalance = (
  teamData: { budget?: number; transferBudget?: number } | undefined,
  financeData: { balance?: number } | undefined,
): number => {
  const balanceSource = Number.isFinite(teamData?.transferBudget)
    ? Number(teamData?.transferBudget)
    : Number.isFinite(teamData?.budget)
      ? Number(teamData?.budget)
      : (financeData?.balance ?? FINANCE_DEFAULT_BALANCE);

  return Math.max(0, Math.round(balanceSource));
};

const parseMillis = (value: unknown): number | null => {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'toMillis' in value &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    const millis = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value === 'string') {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }

  return null;
};

const resolveVipPlan = (value: unknown): VipPlan | null => {
  if (value === 'weekly') {
    return 'monthly';
  }

  return value === 'monthly' || value === 'semiAnnual' || value === 'yearly'
    ? value
    : null;
};

export const getVipDailyCreditDateKey = (date = new Date()): string =>
  formatInTimeZone(date, TIME_ZONE, 'yyyy-MM-dd');

export const getNextVipDailyCreditDateKey = (date = new Date()): string =>
  getVipDailyCreditDateKey(new Date(date.getTime() + DAY_MS));

export const isVipStateActive = (
  vipState: StoredVipState | null | undefined,
  nowMs = Date.now(),
): boolean => {
  if (!vipState || vipState.isActive !== true) {
    return false;
  }

  if (vipState.expiresAt == null) {
    return true;
  }

  const expiresAtMs = parseMillis(vipState.expiresAt);
  if (expiresAtMs === null) {
    return false;
  }

  return expiresAtMs > nowMs;
};

const resolveVipState = (
  vipState: StoredVipState | null | undefined,
  nowMs = Date.now(),
): ResolvedVipState => {
  const expiresAtMs = parseMillis(vipState?.expiresAt);
  return {
    isActive: isVipStateActive(vipState, nowMs),
    expiresAtMs,
    expiresAtIso: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
    plan: resolveVipPlan(vipState?.plan),
  };
};

export const claimVipDailyCredits = functions
  .region('europe-west1')
  .https.onCall(async (_data, context) => {
    const uid = validateAuth(context);
    const now = new Date();
    const nowMs = now.getTime();
    const claimDate = getVipDailyCreditDateKey(now);
    const nextClaimDate = getNextVipDailyCreditDateKey(now);
    const userRef = userDoc(uid);
    const financeRef = financeDoc(uid);
    const teamRef = teamDoc(uid);
    const dailyClaimRef = claimDoc(uid, claimDate);
    const historyRef = financeHistoryCollection(uid).doc();

    let balance = 0;
    let diamondBalance = 0;

    await db.runTransaction(async (tx) => {
      const [userSnap, financeSnap, teamSnap, dailyClaimSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(financeRef),
        tx.get(teamRef),
        tx.get(dailyClaimRef),
      ]);

      const userData = (userSnap.data() as Record<string, unknown> | undefined) ?? {};
      const vipState = resolveVipState(
        (userData.vip as StoredVipState | undefined) ?? undefined,
        nowMs,
      );

      if (!vipState.isActive) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Bu gunluk kredi bonusu sadece aktif VIP uyeler icin kullanilabilir.',
          {
            reason: 'vip_inactive',
            expiresAt: vipState.expiresAtIso,
          },
        );
      }

      if (dailyClaimSnap.exists) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Bugunku VIP kredi bonusunu zaten aldin.',
          {
            reason: 'already_claimed',
            claimDate,
            nextClaimDate,
          },
        );
      }

      const currentDiamondBalance = Number(userData.diamondBalance ?? 0);
      if (
        VIP_DAILY_CREDIT_DIAMOND_COST > 0 &&
        (!Number.isFinite(currentDiamondBalance) || currentDiamondBalance < VIP_DAILY_CREDIT_DIAMOND_COST)
      ) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'VIP kredi bonusu icin yeterli elmasin yok.',
          {
            reason: 'insufficient_diamonds',
            diamondBalance: Number.isFinite(currentDiamondBalance) ? currentDiamondBalance : 0,
            requiredDiamonds: VIP_DAILY_CREDIT_DIAMOND_COST,
          },
        );
      }

      const financeData = (financeSnap.data() as { balance?: number } | undefined) ?? undefined;
      const teamData =
        (teamSnap.data() as { budget?: number; transferBudget?: number } | undefined) ?? undefined;

      balance = resolveTeamBalance(teamData, financeData) + VIP_DAILY_CREDIT_AMOUNT;
      diamondBalance = Number.isFinite(currentDiamondBalance)
        ? Math.max(0, Math.round(currentDiamondBalance - VIP_DAILY_CREDIT_DIAMOND_COST))
        : 0;

      tx.set(
        financeRef,
        {
          balance,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      tx.set(
        teamRef,
        {
          budget: balance,
          transferBudget: balance,
        },
        { merge: true },
      );

      const userUpdate: Record<string, unknown> = {
        vipDailyCredit: {
          lastClaimDate: claimDate,
          lastClaimAmount: VIP_DAILY_CREDIT_AMOUNT,
          claimCostDiamonds: VIP_DAILY_CREDIT_DIAMOND_COST,
          lastClaimAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
      };

      if (VIP_DAILY_CREDIT_DIAMOND_COST > 0) {
        userUpdate.diamondBalance = diamondBalance;
      }

      tx.set(userRef, userUpdate, { merge: true });
      tx.create(dailyClaimRef, {
        id: claimDate,
        claimDate,
        amount: VIP_DAILY_CREDIT_AMOUNT,
        diamondCost: VIP_DAILY_CREDIT_DIAMOND_COST,
        mode: VIP_DAILY_CREDIT_DIAMOND_COST > 0 ? 'diamond' : 'free',
        vipPlan: vipState.plan,
        vipExpiresAt: vipState.expiresAtIso,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(historyRef, {
        id: historyRef.id,
        type: 'income',
        category: 'vip',
        amount: VIP_DAILY_CREDIT_AMOUNT,
        source: 'VIP',
        note:
          VIP_DAILY_CREDIT_DIAMOND_COST > 0
            ? `VIP gunluk kredi bonusu (${VIP_DAILY_CREDIT_DIAMOND_COST} elmas)`
            : 'VIP gunluk kredi bonusu',
        timestamp: FieldValue.serverTimestamp(),
      });
    });

    functions.logger.info('claim_vip_daily_credits_success', {
      uid,
      claimDate,
      amount: VIP_DAILY_CREDIT_AMOUNT,
      diamondCost: VIP_DAILY_CREDIT_DIAMOND_COST,
    });

    return {
      claimDate,
      amount: VIP_DAILY_CREDIT_AMOUNT,
      diamondCost: VIP_DAILY_CREDIT_DIAMOND_COST,
      mode: VIP_DAILY_CREDIT_DIAMOND_COST > 0 ? 'diamond' : 'free',
      balance,
      diamondBalance,
      nextClaimDate,
    };
  });
