import * as functions from 'firebase-functions/v1';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import '../_firebase.js';
import {
  assertSponsorActivationAllowed,
  buildSponsorActivationMutations,
} from './sponsorActivation.js';
import { getSponsorCatalogConfig, normalizeSponsorString } from './sponsorCatalog.js';

const db = getFirestore();
const DAY_MS = 24 * 60 * 60 * 1000;
const FINANCE_DEFAULT_BALANCE = 50_000;

const financeDoc = (uid: string) => db.collection('finance').doc(uid);
const teamDoc = (uid: string) => db.collection('teams').doc(uid);
const sponsorCollection = (uid: string) => db.collection('users').doc(uid).collection('sponsorships');
const financeHistoryCollection = (uid: string) => db.collection('finance').doc('history').collection(uid);

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

export const activateUserSponsor = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
    const uid = validateAuth(context);
    const sponsorId = normalizeSponsorString(data?.sponsorId);
    if (!sponsorId) {
      throw new functions.https.HttpsError('invalid-argument', 'sponsorId zorunludur.');
    }

    const sponsorConfig = await getSponsorCatalogConfig(sponsorId);
    assertSponsorActivationAllowed('free', sponsorConfig);
    const sponsorshipsRef = sponsorCollection(uid);

    await db.runTransaction(async (tx) => {
      const sponsorshipsSnap = await tx.get(sponsorshipsRef);
      const mutations = buildSponsorActivationMutations(
        sponsorshipsSnap.docs.map((docSnap) => docSnap.id),
        sponsorConfig,
        FieldValue.serverTimestamp(),
      );
      const refById = new Map(sponsorshipsSnap.docs.map((docSnap) => [docSnap.id, docSnap.ref]));

      mutations.forEach((mutation) => {
        const ref = refById.get(mutation.sponsorId) ?? sponsorshipsRef.doc(mutation.sponsorId);
        tx.set(ref, mutation.payload, { merge: true });
      });
    });

    functions.logger.info('activate_user_sponsor_success', {
      uid,
      sponsorId,
      sponsorType: sponsorConfig.type,
      path: 'free',
    });

    return {
      sponsorId,
      sponsorName: sponsorConfig.sponsorName,
      sponsorType: sponsorConfig.type,
      active: true,
    };
  });

export const collectUserSponsorEarnings = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
    const uid = validateAuth(context);
    const sponsorId = normalizeSponsorString(data?.sponsorId);
    if (!sponsorId) {
      throw new functions.https.HttpsError('invalid-argument', 'sponsorId zorunludur.');
    }

    const sponsorRef = sponsorCollection(uid).doc(sponsorId);
    const financeRef = financeDoc(uid);
    const teamRef = teamDoc(uid);
    const historyRef = financeHistoryCollection(uid).doc();

    let payout = 0;
    let sponsorName = sponsorId;

    await db.runTransaction(async (tx) => {
      const [sponsorSnap, financeSnap, teamSnap] = await Promise.all([
        tx.get(sponsorRef),
        tx.get(financeRef),
        tx.get(teamRef),
      ]);

      if (!sponsorSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Sponsor bulunamadi.');
      }

      const sponsorData = sponsorSnap.data() as {
        name?: string;
        active?: boolean;
        reward?: { amount?: number; cycle?: 'daily' | 'weekly' };
        activatedAt?: { toMillis?: () => number };
        lastPayoutAt?: { toMillis?: () => number } | null;
        nextPayoutAt?: { toMillis?: () => number } | null;
      };

      sponsorName = normalizeSponsorString(sponsorData.name) || sponsorId;

      if (!sponsorData.active) {
        throw new functions.https.HttpsError('failed-precondition', 'Sponsor aktif degil.');
      }

      const reward = sponsorData.reward;
      if (!reward || !Number.isFinite(reward.amount)) {
        throw new functions.https.HttpsError('failed-precondition', 'Sponsor odeme bilgisi eksik.');
      }

      const cadenceMs = reward.cycle === 'weekly' ? 7 * DAY_MS : DAY_MS;
      const nowMs = Date.now();
      const activatedAtMs = sponsorData.activatedAt?.toMillis?.();
      const lastPayoutMs = sponsorData.lastPayoutAt?.toMillis?.();
      const nextPayoutAtMs = sponsorData.nextPayoutAt?.toMillis?.();
      const lastPayoutAt = lastPayoutMs ?? activatedAtMs ?? nowMs;

      if (nextPayoutAtMs && nowMs < nextPayoutAtMs) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Bir sonraki sponsorluk odemesi henuz hazir degil.',
        );
      }

      const periods = Math.floor((nowMs - lastPayoutAt) / cadenceMs);
      if (periods <= 0) {
        throw new functions.https.HttpsError('failed-precondition', 'Bugun icin odeme yapildi.');
      }

      payout = periods * Number(reward.amount);

      const financeData = (financeSnap.data() as { balance?: number } | undefined) ?? undefined;
      const teamData =
        (teamSnap.data() as { budget?: number; transferBudget?: number } | undefined) ?? undefined;
      const balance = resolveTeamBalance(teamData, financeData);
      const nextBalance = balance + payout;

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
        sponsorRef,
        {
          lastPayoutAt: FieldValue.serverTimestamp(),
          nextPayoutAt: new Date(nowMs + cadenceMs),
        },
        { merge: true },
      );
      tx.set(historyRef, {
        id: historyRef.id,
        type: 'income',
        category: 'sponsor',
        amount: payout,
        source: sponsorName,
        note: `${sponsorName} sponsor odemesi`,
        timestamp: FieldValue.serverTimestamp(),
      });
    });

    functions.logger.info('collect_user_sponsor_earnings_success', {
      uid,
      sponsorId,
      payout,
    });

    return {
      sponsorId,
      sponsorName,
      payout,
    };
  });
