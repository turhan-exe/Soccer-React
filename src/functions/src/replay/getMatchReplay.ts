import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const REGION = 'europe-west1';
const db = getFirestore();
const bucket = getStorage().bucket();

export const getMatchReplay = functions.region(REGION).https.onRequest(async (req, res) => {
  try {
    const seasonId = (req.query.seasonId as string) || (req.body?.seasonId as string);
    const matchId = (req.query.matchId as string) || (req.body?.matchId as string);
    if (!seasonId || !matchId) {
      res.status(400).json({ error: 'seasonId and matchId are required' });
      return;
    }

    const snap = await db.doc(`seasons/${seasonId}/matches/${matchId}`).get();
    if (!snap.exists) {
      res.status(404).json({ error: 'match not found' });
      return;
    }
    const data = snap.data() as any;
    const storagePath: string | undefined = data?.replay?.storagePath;
    if (!storagePath) {
      res.status(404).json({ error: 'replay missing' });
      return;
    }

    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: 'replay file missing' });
      return;
    }
    const [buf] = await file.download();
    res.set('Content-Type', 'application/json');
    res.set('Cache-Control', 'public, max-age=60');
    res.status(200).send(buf.toString());
  } catch (err: any) {
    functions.logger.error('[getMatchReplay] failed', { err: err?.message });
    res.status(500).json({ error: 'internal', detail: err?.message || 'unknown' });
  }
});
