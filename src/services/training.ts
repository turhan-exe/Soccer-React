import { doc, setDoc, getDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/services/firebase';

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
