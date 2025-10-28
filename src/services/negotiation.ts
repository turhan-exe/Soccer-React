import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';

export type NegotiationSource = 'transfer' | 'academy';

export interface NegotiationOffer {
  amount: number;
  accepted: boolean;
  createdAt: Timestamp;
}

export interface NegotiationAttemptDoc {
  playerId: string;
  playerName: string;
  overall: number;
  transferFee?: number;
  baseSalary: number;
  patienceLeft: number;
  accepted: boolean;
  rejected: boolean;
  source: NegotiationSource;
  offerHistory: NegotiationOffer[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  agreedSalary?: number;
  contextId?: string;
  ownerUid: string;
}

export interface NegotiationAttempt extends NegotiationAttemptDoc {
  id: string;
}

export interface NegotiationStartPayload {
  playerId: string;
  playerName: string;
  overall: number;
  transferFee?: number;
  source: NegotiationSource;
  contextId?: string;
}

const attemptsCollection = (uid: string) => collection(db, 'transfer_attempts', uid, 'attempts');

export async function startNegotiationAttempt(
  uid: string,
  payload: NegotiationStartPayload,
): Promise<NegotiationAttempt> {
  if (!payload.contextId) {
    throw new Error('contextId required for negotiation');
  }
  const ref = doc(attemptsCollection(uid));
  const baseSalary = Math.round(payload.overall * 150);
  const docData: NegotiationAttemptDoc = {
    playerId: payload.playerId,
    playerName: payload.playerName,
    overall: payload.overall,
    transferFee: payload.transferFee,
    baseSalary,
    patienceLeft: 3,
    accepted: false,
    rejected: false,
    source: payload.source,
    offerHistory: [],
    createdAt: serverTimestamp() as Timestamp,
    updatedAt: serverTimestamp() as Timestamp,
    contextId: payload.contextId,
    ownerUid: uid,
  };
  await setDoc(ref, docData);
  return {
    id: ref.id,
    ...docData,
  };
}

export interface NegotiationOfferResult {
  status: 'pending' | 'accepted' | 'rejected';
  patienceLeft: number;
  baseSalary: number;
  offers: NegotiationOffer[];
}

export async function submitNegotiationOffer(
  uid: string,
  attemptId: string,
  amount: number,
): Promise<NegotiationOfferResult> {
  const ref = doc(attemptsCollection(uid), attemptId);
  let result: NegotiationOfferResult | null = null;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new Error('Pazarlik bulunamadi.');
    }
    const data = snap.data() as NegotiationAttemptDoc;
    if (data.accepted || data.rejected) {
      throw new Error('Pazarlik tamamlanmis.');
    }

    const offer: NegotiationOffer = {
      amount,
      accepted: amount >= data.baseSalary,
      createdAt: Timestamp.now(),
    };
    const updatedOffers = [...(data.offerHistory ?? []), offer];
    let patienceLeft = Math.max(0, data.patienceLeft ?? 0);
    let status: NegotiationOfferResult['status'] = 'pending';
    let accepted = data.accepted;
    let rejected = data.rejected;

    if (offer.accepted) {
      accepted = true;
      status = 'accepted';
    } else {
      patienceLeft = Math.max(0, patienceLeft - 1);
      if (patienceLeft === 0) {
        rejected = true;
        status = 'rejected';
      }
    }

    tx.update(ref, {
      offerHistory: updatedOffers,
      patienceLeft,
      accepted,
      rejected,
      updatedAt: serverTimestamp(),
    });

    result = {
      status,
      patienceLeft,
      baseSalary: data.baseSalary,
      offers: updatedOffers,
    };
  });

  if (!result) {
    throw new Error('Pazarlik guncellenemedi.');
  }
  return result;
}

export async function finalizeNegotiationAttempt(
  uid: string,
  attemptId: string,
  payload: { accepted: boolean; salary?: number },
): Promise<void> {
  const ref = doc(attemptsCollection(uid), attemptId);
  await updateDoc(ref, {
    accepted: payload.accepted,
    rejected: payload.accepted ? false : true,
    agreedSalary: payload.salary ?? null,
    updatedAt: serverTimestamp(),
    completedAt: serverTimestamp(),
  });
}

const transferHistoryCollection = (uid: string) => collection(db, 'transfers', 'history', uid);

export interface TransferHistoryRecord {
  playerId: string;
  playerName: string;
  overall: number;
  transferFee?: number;
  salary?: number;
  source: NegotiationSource;
  attemptId?: string;
  contextId?: string;
  accepted: boolean;
}

export async function recordTransferHistory(
  uid: string,
  payload: TransferHistoryRecord,
): Promise<void> {
  const col = transferHistoryCollection(uid);
  const ref = doc(col);
  await setDoc(ref, {
    ...payload,
    createdAt: serverTimestamp(),
  });
}

export async function getNegotiationAttempt(uid: string, attemptId: string): Promise<NegotiationAttempt | null> {
  const ref = doc(attemptsCollection(uid), attemptId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return null;
  }
  return {
    id: attemptId,
    ...(snap.data() as NegotiationAttemptDoc),
  };
}
