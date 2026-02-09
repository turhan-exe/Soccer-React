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
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/services/firebase';
import { getTeam, saveTeamPlayers } from '@/services/team';
import { trainings } from '@/lib/data';
import { runTrainingSimulation } from '@/lib/trainingSession';
import type { Player, Training } from '@/types';
import { toast } from 'sonner';

type FirestoreLikeError = { code?: string };

const isPermissionError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as FirestoreLikeError).code === 'permission-denied';

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

export function listenActiveTraining(
  uid: string,
  cb: (session: ActiveTrainingSession | null) => void,
): Unsubscribe {
  const ref = trainingDoc(uid);
  return onSnapshot(
    ref,
    snap => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      cb(snap.data() as ActiveTrainingSession);
    },
    error => {
      if (isPermissionError(error)) {
        console.warn('[training.listenActiveTraining] Permission denied', error);
        cb(null);
        return;
      }

      console.error('[training.listenActiveTraining] Snapshot failed', error);
    },
  );
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

export const TRAINING_FINISH_COST = 80;
export const TRAINING_BOOST_COST = 35;

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
  try {
    const q = query(trainingHistoryCol(uid), where('viewed', '==', false));
    const snap = await getDocs(q);
    return snap.size;
  } catch (error) {
    if (isPermissionError(error)) {
      console.warn('[training.getUnviewedTrainingCount] Permission denied', error);
      return 0;
    }
    throw error;
  }
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

      const reductionSeconds = remainingSeconds;
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

export async function finalizeExpiredTrainingSession(uid: string): Promise<boolean> {
  const session = await getActiveTraining(uid);
  if (!session) {
    return false;
  }

  const startDate = session.startAt.toDate();
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - startDate.getTime()) / 1000),
  );

  if (elapsedSeconds < session.durationSeconds) {
    return false;
  }

  try {
    const team = await getTeam(uid);
    if (!team) {
      await clearActiveTraining(uid);
      return true;
    }

    const sessionPlayers = session.playerIds
      .map(id => team.players.find(player => player.id === id))
      .filter((player): player is Player => Boolean(player));

    const sessionTrainings = session.trainingIds
      .map(id => trainings.find(training => training.id === id))
      .filter((training): training is Training => Boolean(training));

    if (sessionPlayers.length === 0 || sessionTrainings.length === 0) {
      await clearActiveTraining(uid);
      return true;
    }

    const { updatedPlayers, records } = runTrainingSimulation(
      sessionPlayers,
      sessionTrainings,
    );

    const mergedPlayers = team.players.map(player => {
      const updated = updatedPlayers.find(p => p.id === player.id);
      return updated ?? player;
    });

    try {
      await saveTeamPlayers(uid, mergedPlayers);
    } catch (error) {
      console.warn('[training.finalizeExpiredTrainingSession] save players failed', error);
    }

    const completionTime = Timestamp.now();

    for (const record of records) {
      try {
        await addTrainingRecord(uid, {
          ...record,
          completedAt: completionTime,
          viewed: false,
        });
      } catch (error) {
        console.warn('[training.finalizeExpiredTrainingSession] record persist failed', error);
      }
    }

    try {
      await clearActiveTraining(uid);
    } catch (error) {
      console.warn('[training.finalizeExpiredTrainingSession] clear active failed', error);
    }

    return true;
  } catch (error) {
    console.warn('[training.finalizeExpiredTrainingSession] failed', error);
    return false;
  }
}
