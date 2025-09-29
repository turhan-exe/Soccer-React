import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
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
} from 'firebase/firestore';
import { db } from './firebase';
import { Player } from '@/types';
import { addPlayerToTeam } from './team';

export type YouthCandidate = {
  id: string;
  status: 'pending';
  createdAt: Timestamp;
  player: Player;
};

export const YOUTH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 1 hafta
export const YOUTH_RESET_DIAMOND_COST = 100;
export const YOUTH_AD_REDUCTION_MS = 12 * 60 * 60 * 1000; // 12 saat

interface UserDoc {
  diamondBalance?: number;
  youth?: {
    nextGenerateAt?: Timestamp;
  };
}

export async function getYouthCandidates(uid: string): Promise<YouthCandidate[]> {
  const col = collection(db, 'users', uid, 'youthCandidates');
  const q = query(col, where('status', '==', 'pending'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<YouthCandidate, 'id'>),
  }));
}

export function listenYouthCandidates(
  uid: string,
  cb: (list: YouthCandidate[]) => void,
): Unsubscribe {
  const col = collection(db, 'users', uid, 'youthCandidates');
  const q = query(col, where('status', '==', 'pending'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    const list: YouthCandidate[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<YouthCandidate, 'id'>),
    }));
    cb(list);
  });
}

export async function createYouthCandidate(
  uid: string,
  player: Player,
): Promise<YouthCandidate> {
  const userRef = doc(db, 'users', uid);
  const candidates = collection(userRef, 'youthCandidates');
  const now = new Date();
  const nextDate = new Date(now.getTime() + YOUTH_COOLDOWN_MS);

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
