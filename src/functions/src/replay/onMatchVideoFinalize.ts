import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const REGION = 'europe-west1';
const db = getFirestore();

export const onMatchVideoFinalize = functions
  .region(REGION)
  .storage.object()
  .onFinalize(async (obj) => {
    try {
      const name = obj.name;
      if (!name || !name.startsWith('videos/')) return;

      const parts = name.split('/').filter(Boolean);
      if (parts.length < 3) return;

      const seasonId = parts[1];
      const fileName = parts[parts.length - 1];
      const matchId = fileName.replace(/\.mp4$/i, '');
      if (!seasonId || !matchId) return;

      const matchRef = db.doc(`seasons/${seasonId}/matches/${matchId}`);
      const snap = await matchRef.get();
      if (!snap.exists) return;

      const durationMeta = Number(obj.metadata?.durationMs);
      const update: Record<string, any> = {
        videoMissing: false,
        videoError: FieldValue.delete(),
        'video.storagePath': name,
        'video.type': 'mp4-v1',
        'video.uploaded': true,
        'video.updatedAt': FieldValue.serverTimestamp(),
      };
      if (!Number.isNaN(durationMeta)) {
        update['video.durationMs'] = durationMeta;
      }

      await matchRef.set(update, { merge: true });
    } catch (err: any) {
      functions.logger.error('[onMatchVideoFinalize] failed', { err: err?.message });
    }
  });
