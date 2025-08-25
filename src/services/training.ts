import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  Timestamp,
  runTransaction,
  increment,
} from 'firebase/firestore';
import { db } from '@/services/firebase';
import { toast } from 'sonner';

export interface ActiveTrainingSession {
  playerId: string;
  playerName: string;
  trainingId: string;
  trainingName: string;
  startAt: Timestamp;
  endAt: Timestamp;
}

const trainingDoc = (uid: string) => doc(db, 'users', uid, 'training', 'active');

export async function getActiveTraining(uid: string): Promise<ActiveTrainingSession | null> {
  const snap = await getDoc(trainingDoc(uid));
  return snap.exists() ? (snap.data() as ActiveTrainingSession) : null;
}

export async function setActiveTraining(uid: string, session: ActiveTrainingSession): Promise<void> {
  await setDoc(trainingDoc(uid), session);
}

export async function clearActiveTraining(uid: string): Promise<void> {
  await deleteDoc(trainingDoc(uid));
}

export const TRAINING_FINISH_COST = 50;

export async function finishTrainingWithDiamonds(
  uid: string,
): Promise<ActiveTrainingSession> {
  const userRef = doc(db, 'users', uid);
  const sessionRef = trainingDoc(uid);
  try {
    const session = await runTransaction(db, async (tx) => {
      const [userSnap, sessionSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(sessionRef),
      ]);

      if (!sessionSnap.exists()) {
        throw new Error('Aktif antrenman yok');
      }

      const balance = (userSnap.data() as { diamondBalance?: number })
        .diamondBalance ?? 0;
      if (balance < TRAINING_FINISH_COST) {
        throw new Error('Yetersiz elmas');
      }

      tx.update(userRef, { diamondBalance: increment(-TRAINING_FINISH_COST) });
      tx.delete(sessionRef);

      return sessionSnap.data() as ActiveTrainingSession;
    });

    toast.success('Antrenman tamamlandı');
    return session;
  } catch (err) {
    console.warn(err);
    toast.error((err as Error).message || 'İşlem başarısız');
    throw err;
  }
}
