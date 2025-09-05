import * as functions from 'firebase-functions/v1';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();
const REGION = 'europe-west1';
const SECRET = functions.config().unity?.result_secret || '';

export const finalizeMatch = functions.region(REGION).https.onRequest(async (req, res) => {
  try {
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!SECRET || auth !== SECRET) res.status(401).send('unauthorized');
      return;

    const { matchId, leagueId, seasonId, score, replay } = req.body || {};
    if (!matchId || !leagueId) res.status(400).send('missing fields');
      return;

    await db.doc(`leagues/${leagueId}/fixtures/${matchId}`).update({
      status: 'played',
      score,
      replayPath: replay?.path || (seasonId ? `replays/${seasonId}/${leagueId}/${matchId}.json` : undefined),
      endedAt: FieldValue.serverTimestamp()
    });

    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).send(e?.message || 'error');
  }
});




