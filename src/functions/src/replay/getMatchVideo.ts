import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const REGION = 'europe-west1';
const db = getFirestore();
const bucket = getStorage().bucket();

function withCors(req: functions.Request, res: functions.Response<any>): boolean {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

export const getMatchVideo = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    if (withCors(req, res)) return;
    try {
      const seasonId = (req.query.seasonId as string) || (req.body?.seasonId as string) || '';
      const matchId = (req.query.matchId as string) || (req.body?.matchId as string) || '';
      let storagePath = (req.query.storagePath as string) || (req.body?.storagePath as string) || '';

      if (!seasonId || !matchId) {
        res.status(400).json({ error: 'seasonId and matchId required' });
        return;
      }

      if (storagePath && !storagePath.startsWith('videos/')) {
        res.status(400).json({ error: 'invalid storagePath' });
        return;
      }

      const matchRef = db.doc(`seasons/${seasonId}/matches/${matchId}`);
      if (!storagePath) {
        const snap = await matchRef.get();
        if (!snap.exists) {
          res.status(404).json({ error: 'match not found' });
          return;
        }
        const data = snap.data() as any;
        storagePath = data?.video?.storagePath;
        if (!storagePath) {
          res.status(404).json({ error: 'missing', reason: 'missing-video' });
          return;
        }
      }

      const file = bucket.file(storagePath);
      const [exists] = await file.exists();
      if (!exists) {
        await matchRef.set({ videoMissing: true }, { merge: true });
        res.status(404).json({ error: 'missing', reason: 'missing-file' });
        return;
      }

      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000,
      });

      await matchRef.set(
        {
          videoMissing: false,
          videoError: FieldValue.delete(),
          'video.storagePath': storagePath,
          'video.type': 'mp4-v1',
          'video.uploaded': true,
        } as any,
        { merge: true }
      );

      res.json({ ok: true, signedUrl, storagePath });
    } catch (err: any) {
      functions.logger.error('[getMatchVideo] failed', { err: err?.message });
      res.status(500).json({ error: 'internal', detail: err?.message || 'unknown' });
    }
  });
