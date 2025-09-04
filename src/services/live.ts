import { getDatabase, onChildAdded, onValue, ref, off } from 'firebase/database';
import { auth as _auth } from './firebase';

export type LiveEvent = {
  seq?: string | number;
  ts: number;
  type: string;
  payload?: any;
};

export type LiveMeta = {
  startedAt?: number;
  endedAt?: number;
  lastSeq?: number;
  status?: 'live' | 'ended' | string;
  score?: { h: number; a: number };
};

export function subscribeLive(
  matchId: string,
  onEvent: (ev: LiveEvent) => void,
  onMeta?: (meta: LiveMeta | null) => void
) {
  const db = getDatabase();
  const evRef = ref(db, `live/${matchId}/events`);
  const metaRef = ref(db, `live/${matchId}/meta`);

  const unsubscribeEvents = onChildAdded(evRef, (snap) => {
    const val = snap.val();
    if (!val) return;
    onEvent({ seq: snap.key || undefined, ...val });
  });

  const unsubscribeMeta = onValue(metaRef, (snap) => {
    onMeta?.((snap.val() as LiveMeta) || null);
  });

  return () => {
    off(evRef);
    off(metaRef);
    try { unsubscribeEvents(); } catch {}
    try { unsubscribeMeta(); } catch {}
  };
}

export function subscribeLiveMeta(
  matchId: string,
  onMeta: (meta: LiveMeta | null) => void
) {
  const db = getDatabase();
  const metaRef = ref(db, `live/${matchId}/meta`);
  const unsubscribeMeta = onValue(metaRef, (snap) => {
    onMeta((snap.val() as LiveMeta) || null);
  });
  return () => {
    off(metaRef);
    try { unsubscribeMeta(); } catch {}
  };
}
