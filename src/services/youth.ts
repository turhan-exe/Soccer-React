import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  Unsubscribe,
  serverTimestamp,
  Timestamp,
  runTransaction,
  increment,
  addDoc,
  QuerySnapshot,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';
import { Player } from '@/types';
import { addPlayerToTeam } from './team';

type FirestoreLikeError = { code?: string };

const isFirestorePermissionError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as FirestoreLikeError).code === 'permission-denied';

export type YouthCandidate = {
  id: string;
  status: 'pending';
  createdAt: Timestamp;
  player: Player;
};

export const YOUTH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 1 hafta
export const YOUTH_RESET_DIAMOND_COST = 160;
export const YOUTH_AD_REDUCTION_MS = 12 * 60 * 60 * 1000; // 12 saat

interface UserDoc {
  diamondBalance?: number;
  youth?: {
    nextGenerateAt?: Timestamp;
  };
}

export async function getYouthCandidates(uid: string): Promise<YouthCandidate[]> {
  const col = collection(db, 'users', uid, 'youthCandidates');

  const mapSnapshot = (snap: QuerySnapshot<DocumentData>): YouthCandidate[] =>
    snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<YouthCandidate, 'id'>) }))
      .filter((candidate) => candidate.status === 'pending')
      .sort((a, b) => {
        const getMs = (value: Timestamp | undefined) =>
          value?.toMillis?.() ?? 0;
        return getMs(b.createdAt) - getMs(a.createdAt);
      });

  try {
    const q = query(col, where('status', '==', 'pending'));
    const snap = await getDocs(q);
    return mapSnapshot(snap);
  } catch (error) {
    if (isFirestorePermissionError(error)) {
      console.warn('[youth.getYouthCandidates] Permission denied', error);
      return [];
    }

    throw error;
  }
}

export function listenYouthCandidates(
  uid: string,
  cb: (list: YouthCandidate[]) => void,
): Unsubscribe {
  const col = collection(db, 'users', uid, 'youthCandidates');

  const mapDocs = (docs: QueryDocumentSnapshot<DocumentData>[]): YouthCandidate[] =>
    docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<YouthCandidate, 'id'>) }))
      .filter((candidate) => candidate.status === 'pending')
      .sort((a, b) => {
        const getMs = (value: Timestamp | undefined) => value?.toMillis?.() ?? 0;
        return getMs(b.createdAt) - getMs(a.createdAt);
      });

  const unsubscribe = onSnapshot(
    query(col, where('status', '==', 'pending')),
    (snap) => {
      cb(mapDocs(snap.docs));
    },
    (error) => {
      if (isFirestorePermissionError(error)) {
        console.warn('[youth.listenYouthCandidates] Permission denied', error);
        cb([]);
        return;
      }

      console.error('[youth.listenYouthCandidates] Snapshot failed', error);
    },
  );

  return () => {
    unsubscribe();
  };
}

export async function createYouthCandidate(
  uid: string,
  player: Player,
  options?: { durationMultiplier?: number },
): Promise<YouthCandidate> {
  const userRef = doc(db, 'users', uid);
  const candidates = collection(userRef, 'youthCandidates');
  const now = new Date();
  const multiplierRaw = options?.durationMultiplier ?? 1;
  const normalizedMultiplier = Number.isFinite(multiplierRaw)
    ? Math.max(0.1, Math.min(1, multiplierRaw))
    : 1;
  const nextDate = new Date(now.getTime() + YOUTH_COOLDOWN_MS * normalizedMultiplier);

  // check cooldown & update user document atomically
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.data() as UserDoc | undefined;
    const nextAt = data?.youth?.nextGenerateAt?.toDate();
    if (nextAt && nextAt > now) {
      throw new Error('1 hafta beklemelisin');
    }
    tx.set(
      userRef,
      {
        youth: {
          lastGenerateAt: serverTimestamp(),
          nextGenerateAt: Timestamp.fromDate(nextDate),
        },
      },
      { merge: true },
    );
  });

  // persist candidate separately to ensure it's stored even if listener fails
  const candidateDoc = await addDoc(candidates, {
    status: 'pending' as const,
    createdAt: serverTimestamp(),
    player,
  });

  return {
    id: candidateDoc.id,
    status: 'pending',
    createdAt: Timestamp.fromDate(now),
    player,
  };
}

export async function acceptYouthCandidate(
  uid: string,
  candidateId: string,
): Promise<void> {
  const ref = doc(db, 'users', uid, 'youthCandidates', candidateId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as { player: Player };
  await addPlayerToTeam(uid, data.player);
  await deleteDoc(ref);
}

export async function releaseYouthCandidate(
  uid: string,
  candidateId: string,
): Promise<void> {
  const ref = doc(db, 'users', uid, 'youthCandidates', candidateId);
  await deleteDoc(ref);
}

export async function resetCooldownWithDiamonds(uid: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const now = new Date();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.data() as UserDoc | undefined;
    const balance = data?.diamondBalance ?? 0;
    if (balance < YOUTH_RESET_DIAMOND_COST) {
      throw new Error('Yetersiz elmas');
    }
    tx.update(userRef, {
      diamondBalance: increment(-YOUTH_RESET_DIAMOND_COST),
      'youth.lastGenerateAt': serverTimestamp(),
      'youth.nextGenerateAt': Timestamp.fromDate(now),
    });
  });
}

export async function reduceCooldownWithAd(uid: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const now = new Date();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.data() as UserDoc | undefined;
    const nextAt = data?.youth?.nextGenerateAt?.toDate();
    const targetDate = (() => {
      if (!nextAt || nextAt <= now) {
        return now;
      }
      const reduced = new Date(nextAt.getTime() - YOUTH_AD_REDUCTION_MS);
      return reduced <= now ? now : reduced;
    })();
    tx.set(
      userRef,
      {
        youth: {
          ...(data?.youth ?? {}),
          nextGenerateAt: Timestamp.fromDate(targetDate),
        },
      },
      { merge: true },
    );
  });
}
