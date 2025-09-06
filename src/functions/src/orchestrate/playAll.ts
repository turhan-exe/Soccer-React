import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore } from 'firebase-admin/firestore';
import { betweenTR_19_to_2359, dayKeyTR, ts } from '../utils/schedule.js';
import { requireAppCheck, requireAuth } from '../mw/auth.js';
import { startMatchInternal } from './startMatch.js';
import { log } from '../logger.js';


const db = getFirestore();
const REGION = 'europe-west1';

/**
 * Admin/operator callable: Start all fixtures scheduled for a given TR day.
 * If no dayKey provided, uses today in TR.
 * Note: startMatchInternal will ensure matchPlans snapshot if missing.
 */
export const playAllForDayFn = functions
  .region(REGION)
  .https.onCall(async (request) => {
    requireAppCheck(request as any);
    requireAuth(request as any);

    // Optional: restrict to users with a custom claim (admin/operator)
    const claims = (request.auth as any)?.token || {};
    const isOperator = !!(claims.admin || claims.operator);
    if (!isOperator) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Operator permission required'
      );
    }

    const dayKey = (request.data as any)?.dayKey as string | undefined;
    const targetDay = dayKey || dayKeyTR();
    const { start, end } = betweenTR_19_to_2359(targetDay);

    const q = db
      .collectionGroup('fixtures')
      .where('date', '>=', ts(start))
      .where('date', '<=', ts(end))
      .where('status', '==', 'scheduled');

    const snap = await q.get();
    log.info('playAllForDay_start', { dayKey: targetDay, count: snap.size });

    let started = 0;
    for (const d of snap.docs) {
      const leagueId = d.ref.parent.parent?.id;
      if (!leagueId) continue;
      try {
        await startMatchInternal(d.id, leagueId);
        started++;
      } catch (e) {
        log.error('playAllForDay_err_one', {
          matchId: d.id,
          leagueId,
          err: (e as any)?.message || String(e),
        });
      }
    }

    log.info('playAllForDay_done', { dayKey: targetDay, started, total: snap.size });
    return { ok: true, dayKey: targetDay, total: snap.size, started };
  });
