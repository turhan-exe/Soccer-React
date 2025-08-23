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
  getDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { toast } from 'sonner';
import { generateMockCandidate, CandidatePlayer } from '@/features/academy/generateMockCandidate';
import { addPlayerToTeam } from './team';
import type { Player } from '@/types';
import { calculateOverall, getRoles } from '@/lib/player';

export const ACADEMY_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 saat

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

export async function pullNewCandidate(uid: string): Promise<AcademyCandidate> {
  const userRef = doc(db, 'users', uid);
  const candidates = collection(userRef, 'academyCandidates');
  const now = new Date();
  const nextDate = new Date(now.getTime() + ACADEMY_COOLDOWN_MS);
  // create candidate data locally so we can optimistically update UI
  const player = generateMockCandidate();
  const candidateRef = doc(candidates);
  const newCandidate: AcademyCandidate = {
    id: candidateRef.id,
    status: 'pending',
    createdAt: Timestamp.fromDate(now),
    player,
    source: 'academy',
  };
  try {
    await runTransaction(db, async (tx) => {
      const userSnap = await tx.get(userRef);
      const data = userSnap.data() as UserDoc;
      const nextPullAt = data.academy?.nextPullAt?.toDate();
      if (nextPullAt && nextPullAt > now) {
        throw new Error('2 saat beklemelisin');
      }
      tx.set(candidateRef, {
        status: 'pending',
        createdAt: serverTimestamp(),
        player,
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
    return newCandidate;
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

function mapPosition(pos: string): Player['position'] {
  const mapping: Record<string, Player['position']> = {
    GK: 'GK',
    DEF: 'CB',
    MID: 'CM',
    FWD: 'ST',
  };
  return mapping[pos] ?? 'CM';
}

function candidateToPlayer(id: string, c: CandidatePlayer): Player {
  const randomAttr = () => parseFloat(Math.random().toFixed(3));
  const position = mapPosition(c.position);
  const attributes: Player['attributes'] = {
    strength: randomAttr(),
    acceleration: randomAttr(),
    topSpeed: c.attributes.topSpeed,
    dribbleSpeed: randomAttr(),
    jump: randomAttr(),
    tackling: randomAttr(),
    ballKeeping: randomAttr(),
    passing: randomAttr(),
    longBall: randomAttr(),
    agility: randomAttr(),
    shooting: c.attributes.shooting,
    shootPower: randomAttr(),
    positioning: randomAttr(),
    reaction: randomAttr(),
    ballControl: randomAttr(),
  };
  return {
    id,
    name: c.name,
    position,
    roles: getRoles(position),
    overall: calculateOverall(position, attributes),
    potential: c.potential,
    attributes,
    age: c.age,
    height: 180,
    weight: 75,
    squadRole: 'reserve',
  };
}

export async function acceptCandidate(uid: string, candidateId: string): Promise<void> {
  const candidateRef = doc(db, 'users', uid, 'academyCandidates', candidateId);
  try {
    const snap = await getDoc(candidateRef);
    if (!snap.exists()) {
      throw new Error('Aday bulunamadı');
    }
    const data = snap.data() as { player: CandidatePlayer };
    const player = candidateToPlayer(candidateId, data.player);
    await addPlayerToTeam(uid, player);
    await updateDoc(candidateRef, { status: 'accepted' });
    toast.success('Oyuncu takıma eklendi');
  } catch (err) {
    console.warn(err);
    toast.error('İşlem başarısız');
    throw err;
  }
}

export async function releaseCandidate(uid: string, candidateId: string): Promise<void> {
  const ref = doc(db, 'users', uid, 'academyCandidates', candidateId);
  try {
    await updateDoc(ref, { status: 'released' });
    toast.success('Oyuncu serbest bırakıldı');
  } catch (err) {
    console.warn(err);
    toast.error('İşlem başarısız');
    throw err;
  }
}
