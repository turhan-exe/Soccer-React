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
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/services/firebase';
import { toast } from 'sonner';

export interface ActiveTrainingSession {
  playerIds: string[];
  trainingIds: string[];
  startAt: Timestamp;
  durationSeconds: number;
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
  viewed?: boolean;
}

const trainingDoc = (uid: string) => doc(db, 'users', uid, 'training', 'active');
const trainingHistoryCol = (uid: string) =>
  collection(db, 'users', uid, 'trainingHistory');
const trainingHistoryDoc = (uid: string, id: string) =>
  doc(db, 'users', uid, 'trainingHistory', id);

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
): Promise<string> {
  const ref = await addDoc(trainingHistoryCol(uid), record);
  return ref.id;
}

export async function getTrainingHistory(
  uid: string,
): Promise<TrainingHistoryRecord[]> {
  const snap = await getDocs(trainingHistoryCol(uid));
  return snap.docs.map((d) => {
    const data = d.data() as TrainingHistoryRecord;
    return { id: d.id, ...data, viewed: data.viewed ?? false };
  });
}

export const TRAINING_FINISH_COST = 50;
export const TRAINING_BOOST_COST = 20;

export async function finishTrainingWithDiamonds(
  uid: string,
  diamondCost: number,
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
      if (balance < diamondCost) {
        throw new Error('Yetersiz elmas');
      }

      tx.update(userRef, { diamondBalance: increment(-diamondCost) });
      tx.delete(sessionRef);

      return sessionSnap.data() as ActiveTrainingSession;
    });

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

export async function markTrainingRecordsViewed(
  uid: string,
  recordIds: string[],
): Promise<void> {
  if (!recordIds.length) return;

  const batch = writeBatch(db);
  for (const id of recordIds) {
    batch.update(trainingHistoryDoc(uid, id), { viewed: true });
  }

  await batch.commit();
}

export async function getUnviewedTrainingCount(uid: string): Promise<number> {
  const q = query(trainingHistoryCol(uid), where('viewed', '==', false));
  const snap = await getDocs(q);
  return snap.size;
}

export async function reduceTrainingTimeWithAd(
  uid: string,
): Promise<ActiveTrainingSession> {
  const sessionRef = trainingDoc(uid);

  try {
    const session = await runTransaction(db, async tx => {
      const snap = await tx.get(sessionRef);
      if (!snap.exists()) {
        throw new Error('Aktif antrenman yok');
      }

      const data = snap.data() as ActiveTrainingSession;
      const startDate = data.startAt.toDate();
      const elapsedSeconds = Math.max(
        0,
        Math.floor((Date.now() - startDate.getTime()) / 1000),
      );
      const remainingSeconds = Math.max(data.durationSeconds - elapsedSeconds, 0);

      if (remainingSeconds <= 0) {
        throw new Error('Antrenman zaten tamamlanmış');
      }

      const reductionSeconds = Math.max(1, Math.floor(remainingSeconds * 0.25));
      const newDurationSeconds = Math.max(
        elapsedSeconds,
        data.durationSeconds - reductionSeconds,
      );

      tx.update(sessionRef, { durationSeconds: newDurationSeconds });

      return { ...data, durationSeconds: newDurationSeconds };
    });

    return session;
  } catch (err) {
    console.warn(err);
    toast.error((err as Error).message || 'İşlem başarısız');
    throw err;
  }
}
