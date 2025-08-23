import {
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  doc,
  getDoc,
  deleteDoc,
  Unsubscribe,
  serverTimestamp,
  Timestamp,
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

export async function createYouthCandidate(uid: string, player: Player): Promise<void> {
  const col = collection(db, 'users', uid, 'youthCandidates');
  await addDoc(col, {
    status: 'pending',
    createdAt: serverTimestamp(),
    player,
  });
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
