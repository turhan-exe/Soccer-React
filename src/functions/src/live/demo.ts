import * as functions from 'firebase-functions/v1';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase, ServerValue } from 'firebase-admin/database';

if (!getApps().length) {
  initializeApp();
}

const rtdb = getDatabase();
const SECRET = (functions.config() as any)?.live?.secret || '';

/**
 * POST /demoLive
 * Body: { matchId?: string }
 * Header: Authorization: Bearer <SECRET>
 *
 * Writes demo data following schema:
 *   live/{matchId}/events/{seq}
 *   live/{matchId}/meta
 */
export const demoLive = functions.region('europe-west1').https.onRequest(async (req, res) => {
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

    const matchId = ((req.body || {}).matchId as string) || 'MDEMO';

    const events = [
      { type: 'kickoff' },
      { type: 'chance', payload: { team: 'home' } },
      { type: 'goal', payload: { team: 'home', scorerId: 'H9' } },
      { type: 'chance', payload: { team: 'away' } },
      { type: 'yellow', payload: { playerId: 'A6' } },
      { type: 'half_time' },
      { type: 'goal', payload: { team: 'away', scorerId: 'A10' } },
      { type: 'full_time', payload: { score: { h: 1, a: 1 } } },
    ];

    const metaRef = rtdb.ref(`live/${matchId}/meta`);
    const metaSnap = await metaRef.get();
    let lastSeq = metaSnap.exists() ? (metaSnap.val().lastSeq || 0) : 0;

    const updates: Record<string, any> = {};
    for (const ev of events) {
      lastSeq += 1;
      updates[`live/${matchId}/events/${lastSeq}`] = { ts: Date.now(), ...ev };
    }

    updates[`live/${matchId}/meta/lastSeq`] = lastSeq;
    updates[`live/${matchId}/meta/status`] = 'ended';
    updates[`live/${matchId}/meta/startedAt`] = ServerValue.TIMESTAMP;
    updates[`live/${matchId}/meta/endedAt`] = ServerValue.TIMESTAMP;
    updates[`live/${matchId}/meta/score`] = { h: 1, a: 1 };

    await rtdb.ref().update(updates);

    res.json({ ok: true, count: events.length, matchId, lastSeq });
    return;
  } catch (e: any) {
    functions.logger.error('[demoLive] Failed', { error: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'unknown' });
    return;
  }
});

