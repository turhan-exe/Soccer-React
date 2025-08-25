import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  Timestamp,
  runTransaction,
  increment,
  collection,
  addDoc,
  getDocs,
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
  boost?: boolean;
}

export interface TrainingHistoryRecord {
  id?: string;
  playerId: string;
  playerName: string;
  trainingId: string;
  trainingName: string;
  result: 'success' | 'average' | 'fail';
  gain: number;
  completedAt: Timestamp;
}

const trainingDoc = (uid: string) => doc(db, 'users', uid, 'training', 'active');
const trainingHistoryCol = (uid: string) =>
  collection(db, 'users', uid, 'trainingHistory');

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

export async function addTrainingRecord(
  uid: string,
  record: TrainingHistoryRecord,
): Promise<void> {
  await addDoc(trainingHistoryCol(uid), record);
}

export async function getTrainingHistory(
  uid: string,
): Promise<TrainingHistoryRecord[]> {
  const snap = await getDocs(trainingHistoryCol(uid));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as TrainingHistoryRecord) }));
}

export const TRAINING_FINISH_COST = 50;
export const TRAINING_BOOST_COST = 20;

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

export async function purchaseTrainingBoost(uid: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  try {
    await runTransaction(db, async tx => {
      const userSnap = await tx.get(userRef);
      const balance = (userSnap.data() as { diamondBalance?: number })
        .diamondBalance ?? 0;
      if (balance < TRAINING_BOOST_COST) {
        throw new Error('Yetersiz elmas');
      }
      tx.update(userRef, { diamondBalance: increment(-TRAINING_BOOST_COST) });
    });
  } catch (err) {
    console.warn(err);
    toast.error((err as Error).message || 'İşlem başarısız');
    throw err;
  }
}
