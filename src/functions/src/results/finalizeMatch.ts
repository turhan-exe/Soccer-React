import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();
const REGION = 'europe-west1';
const SECRET = functions.config().unity?.result_secret || '';

export const finalizeMatch = functions.region(REGION).https.onRequest(async (req, res) => {
  try {
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!SECRET || auth !== SECRET) return res.status(401).send('unauthorized');

    const { matchId, leagueId, seasonId, score, replay } = req.body || {};
    if (!matchId || !leagueId) return res.status(400).send('missing fields');

    await db.doc(`leagues/${leagueId}/fixtures/${matchId}`).update({
      status: 'played',
      score,
      replayPath: replay?.path || (seasonId ? `replays/${seasonId}/${leagueId}/${matchId}.json` : undefined),
      endedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).send(e?.message || 'error');
  }
});

