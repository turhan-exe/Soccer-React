import * as functions from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase, ServerValue } from 'firebase-admin/database';

if (!getApps().length) {
  initializeApp();
}

const rtdb = getDatabase();
const SECRET = (functions.config() as any)?.live?.secret || '';

/**
 * POST /endLive
 * Body: { matchId: string, score?: { h: number; a: number } }
 * Header: Authorization: Bearer <SECRET>
 *
 * Writes to:
 *   live/{matchId}/meta -> { endedAt, status: 'ended', score? }
 */
export const endLive = functions.region('europe-west1').https.onRequest(async (req, res) => {
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

    const { matchId, score } = (req.body || {}) as { matchId?: string; score?: { h: number; a: number } };
    if (!matchId) {
      res.status(400).send('bad request: matchId required');
      return;
    }

    await rtdb.ref(`live/${matchId}/meta`).update({
      status: 'ended',
      endedAt: ServerValue.TIMESTAMP,
      ...(score ? { score } : {}),
    });

    res.json({ ok: true });
    return;
  } catch (e: any) {
    functions.logger.error('[endLive] Failed', { error: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'unknown' });
    return;
  }
});
