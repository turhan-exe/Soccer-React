import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getStorage } from 'firebase-admin/storage';
import { requireAuth, requireAppCheck } from '../mw/auth.js';
import { log } from '../logger.js';

const REGION = 'europe-west1';

/**
 * Callable that returns a signed READ URL for a given replayPath.
 * Input: { replayPath: string }
 * Output: { ok: true, url: string }
 */
export const getReplay = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const t0 = Date.now();
    // Enforce Auth + App Check (Plan step 7)
    requireAuth(context);
    requireAppCheck(context);
    const replayPath: string | undefined = data?.replayPath;
    if (!replayPath || typeof replayPath !== 'string') {
      log.warn('getReplay invalid-argument', { ok: false, errorClass: 'invalid-argument' });
      throw new functions.https.HttpsError('invalid-argument', 'replayPath is required');
    }

    // Firebase Admin app is initialized via side-effect import above.
    const bucket = getStorage().bucket();
    try {
      const [exists] = await bucket.file(replayPath).exists();
      if (!exists) {
        log.warn('getReplay not-found', { ok: false, durationMs: Date.now() - t0, errorClass: 'not-found', replayPath });
        throw new functions.https.HttpsError('not-found', 'Replay not found');
      }
      const [url] = await bucket.file(replayPath).getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000, // 1 hour
      });
      const durationMs = Date.now() - t0;
      log.info('getReplay ok', { ok: true, durationMs, replayPath });
      return { ok: true, url, durationMs };
    } catch (e: any) {
      const durationMs = Date.now() - t0;
      log.error('getReplay err', { ok: false, durationMs, errorClass: e?.code || e?.name || 'Internal', err: e?.message || String(e), replayPath });
      throw new functions.https.HttpsError('internal', e?.message || 'Failed to sign URL');
    }
  });

