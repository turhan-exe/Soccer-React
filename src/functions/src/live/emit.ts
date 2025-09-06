import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getDatabase, ServerValue } from 'firebase-admin/database';


const rtdb = getDatabase();
const LIVE_SHARDS = Number(process.env.LIVE_SHARDS || '1');

// NOTE: set with: firebase functions:config:set live.secret="YOUR_LIVE_SECRET"
const SECRET = (functions.config() as any)?.live?.secret || '';

/**
 * POST /emitLive
 * Body (preferred):
 * {
 *   matchId: string,
 *   events: Array<{ ts:number; type:string; payload?:any }>
 * }
 *
 * Back-compat (optional single):
 * {
 *   matchId: string,
 *   eventType: string,
 *   matchClock?: { min:number; sec:number },
 *   payload?: any
 * }
 * Header: Authorization: Bearer <SECRET>
 *
 * Writes to:
 *   live/{matchId}/events/{seq} -> event
 *   live/{matchId}/meta -> { startedAt, lastSeq }
 */
export const emitLive = functions.region('europe-west1').https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('POST only');
    return;
  }

  try {
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!SECRET || token !== SECRET) {
      res.status(401).send('unauthorized');
      return;
    }

    const body = req.body || {};
    const matchId = body.matchId as string | undefined;
    if (!matchId) {
      res.status(400).send('bad request: matchId required');
      return;
    }

    // Normalize to batched events [{ ts, type, payload }]
    let events: Array<{ ts?: number; type?: string; payload?: any }> | undefined = Array.isArray(body.events)
      ? (body.events as any[])
      : undefined;

    if (!events) {
      // Back-compat: single event payload shape
      const { eventType, matchClock, payload } = body as any;
      if (!eventType) {
        res.status(400).send('bad request: events[] or eventType required');
        return;
      }
      const ev: any = { ts: Date.now(), type: eventType };
      if (matchClock) ev.matchClock = matchClock;
      if (payload) ev.payload = payload;
      events = [ev];
    }

    // Ensure timestamps and minimal validation
    const normalized = events
      .filter((e) => e && typeof e.type === 'string')
      .map((e) => ({ ts: e.ts ?? Date.now(), type: e.type as string, ...(e.payload !== undefined ? { payload: e.payload } : {}) }));

    if (!normalized.length) {
      res.status(400).send('bad request: no valid events');
      return;
    }

    // Fetch meta to get current lastSeq
    const metaRef = rtdb.ref(`live/${matchId}/meta`);
    const metaSnap = await metaRef.get();
    const lastSeq = metaSnap.exists() ? (metaSnap.val().lastSeq || 0) : 0;

    const updates: Record<string, any> = {};
    let seq = lastSeq;
    for (const ev of normalized) {
      seq += 1;
      updates[`live/${matchId}/events/${seq}`] = ev;
      if (LIVE_SHARDS > 1) {
        const shard = seq % LIVE_SHARDS;
        updates[`live/${matchId}/events_s${shard}/${seq}`] = ev;
      }
    }

    updates[`live/${matchId}/meta/lastSeq`] = seq;
    if (!metaSnap.exists()) updates[`live/${matchId}/meta/startedAt`] = ServerValue.TIMESTAMP;
    if (LIVE_SHARDS > 1) updates[`live/${matchId}/meta/shards`] = LIVE_SHARDS;

    await rtdb.ref().update(updates);

    res.json({ ok: true, appended: normalized.length, lastSeq: seq });
    return;
  } catch (e: any) {
    functions.logger.error('[emitLive] Failed', { error: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'unknown' });
    return;
  }
});

