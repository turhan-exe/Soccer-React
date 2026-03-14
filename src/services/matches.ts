import { getDatabase, ref as dbRef, onChildAdded, off, query, orderByChild } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import type { MatchTimeline } from '@/types';

export interface LiveEvent {
  ts: number;
  eventType: string;
  seq?: number;
  matchClock?: { min: number; sec: number };
  payload?: any;
}

/**
 * Storage'daki replay dosyasının indirme URL'sini döndürür.
 * Örn: replayPath = "replays/S-2025a/L-TR-1/M123.json"
 */
export async function getReplay(replayPath: string): Promise<string> {
  const fn = httpsCallable(functions, 'getReplay');
  const resp = await fn({ replayPath });
  const data = resp.data as any;
  if (data && data.ok && typeof data.url === 'string') return data.url as string;
  throw new Error('Replay URL alınamadı');
}

export async function getMatchTimeline(matchId: string): Promise<MatchTimeline> {
  const fn = httpsCallable(functions, 'getMatchTimeline');
  const resp = await fn({ matchId });
  return resp.data as MatchTimeline;
}

/**
 * RTDB canlı yayın aboneliği.
 * Node: /live/{matchId}/{autoKey}: { ts, eventType, payload }
 * return: unsubscribe()
 */
export function getLiveFeed(
  matchId: string,
  onEvent: (e: LiveEvent) => void
): () => void {
  const db = getDatabase();
  const node = dbRef(db, `live/${matchId}`);
  const q = query(node, orderByChild('ts'));
  const unsubscribe = onChildAdded(q, (snap) => {
    const v = snap.val();
    if (v) onEvent(v as LiveEvent);
  });
  return () => {
    try { off(q); } catch {}
    if (typeof unsubscribe === 'function') {
      try { (unsubscribe as any)(); } catch {}
    }
  };
}

// Alias: subscribeLive (naming used in plan)
export function subscribeLive(matchId: string, onEvent: (e: LiveEvent) => void) {
  return getLiveFeed(matchId, onEvent);
}

/* Eğer Photon (JS) ile yayın/oda kullanacaksan:
export async function connectPhotonLive(matchId: string) {
  // Photon Realtime JS SDK ile oda: "match-{matchId}"
  // client.onEvent = (code, content) => onEvent({ ts: Date.now(), type: code, payload: content })
  // return disconnect fn
}
*/
