import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  Unsubscribe,
  runTransaction,
  serverTimestamp,
  Timestamp,
  increment,
  deleteDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { toast } from 'sonner';
import { generateMockCandidate, CandidatePlayer } from '@/features/academy/generateMockCandidate';

interface UserDoc {
  diamondBalance?: number;
  academy?: {
    nextPullAt?: Timestamp;
  };
}

export interface AcademyCandidate {
  id: string;
  status: 'pending' | 'accepted' | 'released';
  createdAt: Timestamp;
  player: CandidatePlayer;
  source?: string;
}

export function listenPendingCandidates(
  uid: string,
  cb: (candidates: AcademyCandidate[]) => void,
): Unsubscribe {
  const col = collection(db, 'users', uid, 'academyCandidates');
  const q = query(col, where('status', '==', 'pending'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    const list: AcademyCandidate[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<AcademyCandidate, 'id'>),
    }));
    cb(list);
  });
}

export async function pullNewCandidate(uid: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const candidates = collection(userRef, 'academyCandidates');
  const now = new Date();
  const nextDate = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  try {
    await runTransaction(db, async (tx) => {
      const userSnap = await tx.get(userRef);
      const data = userSnap.data() as UserDoc;
      const nextPullAt = data.academy?.nextPullAt?.toDate();
      if (nextPullAt && nextPullAt > now) {
        throw new Error('2 saat beklemelisin');
      }
      const candidateRef = doc(candidates);
      tx.set(candidateRef, {
        status: 'pending',
        createdAt: serverTimestamp(),
        player: generateMockCandidate(),
        source: 'academy',
      });
      tx.set(
        userRef,
        {
          academy: {
            lastPullAt: serverTimestamp(),
            nextPullAt: Timestamp.fromDate(nextDate),
          },
        },
        { merge: true },
      );
    });
    toast.success('Yeni aday eklendi');
  } catch (err) {
    console.warn(err);
    toast.error((err as Error).message || 'İşlem başarısız');
    throw err;
  }
}

export async function resetCooldownWithDiamonds(uid: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const now = new Date();
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      const data = snap.data() as UserDoc;
      const balance = data.diamondBalance ?? 0;
      if (balance < 100) {
        throw new Error('Yetersiz elmas');
      }
      tx.update(userRef, {
        diamondBalance: increment(-100),
        'academy.lastPullAt': serverTimestamp(),
        'academy.nextPullAt': Timestamp.fromDate(now),
      });
    });
    toast.success('Süre sıfırlandı');
  } catch (err) {
    console.warn(err);
    toast.error((err as Error).message || 'İşlem başarısız');
    throw err;
  }
}

export async function acceptCandidate(uid: string, candidateId: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const candidateRef = doc(userRef, 'academyCandidates', candidateId);
  const squadRef = doc(userRef, 'squadPending', candidateId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(candidateRef);
      if (!snap.exists()) {
        throw new Error('Aday bulunamadı');
      }
      const data = snap.data() as { player: CandidatePlayer };
      tx.set(squadRef, {
        player: data.player,
        source: 'academy',
        createdAt: serverTimestamp(),
      });
      tx.delete(candidateRef);
    });
    toast.success('Oyuncu takıma eklendi (mock)');
  } catch (err) {
    console.warn(err);
    toast.error('İşlem başarısız');
    throw err;
  }
}

export async function releaseCandidate(uid: string, candidateId: string): Promise<void> {
  const ref = doc(db, 'users', uid, 'academyCandidates', candidateId);
  try {
    await deleteDoc(ref);
    toast.success('Oyuncu serbest bırakıldı');
  } catch (err) {
    console.warn(err);
    toast.error('İşlem başarısız');
    throw err;
  }
}
