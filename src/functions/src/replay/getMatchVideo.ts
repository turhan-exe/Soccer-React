import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore, FieldPath, FieldValue } from 'firebase-admin/firestore';
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
      const leagueId = (req.query.leagueId as string) || (req.body?.leagueId as string) || '';
      const matchId = (req.query.matchId as string) || (req.body?.matchId as string) || '';
      let storagePath = (req.query.storagePath as string) || (req.body?.storagePath as string) || '';

      if (!matchId || (!leagueId && !seasonId)) {
        res.status(400).json({ error: 'leagueId or seasonId and matchId required' });
        return;
      }

      if (storagePath && !storagePath.startsWith('videos/')) {
        res.status(400).json({ error: 'invalid storagePath' });
        return;
      }

      let matchRef: FirebaseFirestore.DocumentReference;
      let matchSnap: FirebaseFirestore.DocumentSnapshot;
      if (leagueId) {
        matchRef = db.doc(`leagues/${leagueId}/fixtures/${matchId}`);
        matchSnap = await matchRef.get();
        if (!matchSnap.exists) {
          res.status(404).json({ error: 'match not found' });
          return;
        }
      } else {
        const cg = await db
          .collectionGroup('fixtures')
          .where(FieldPath.documentId(), '==', matchId)
          .limit(1)
          .get();
        if (cg.empty && seasonId) {
          matchRef = db.doc(`seasons/${seasonId}/matches/${matchId}`);
          matchSnap = await matchRef.get();
        } else if (!cg.empty) {
          matchRef = cg.docs[0].ref;
          matchSnap = cg.docs[0];
        } else {
          res.status(404).json({ error: 'match not found' });
          return;
        }
        if (!matchSnap.exists) {
          res.status(404).json({ error: 'match not found' });
          return;
        }
      }

      if (!storagePath) {
        const data = matchSnap.data() as any;
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
