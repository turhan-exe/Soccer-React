import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore, FieldPath, FieldValue } from 'firebase-admin/firestore';

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
      if (parts.length < 2) return;

      const fileName = parts[parts.length - 1];
      const matchId = fileName.replace(/\.mp4$/i, '');
      if (!matchId) return;

      const snap = await db
        .collectionGroup('fixtures')
        .where(FieldPath.documentId(), '==', matchId)
        .limit(1)
        .get();
      if (snap.empty) return;
      const matchRef = snap.docs[0].ref;

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
