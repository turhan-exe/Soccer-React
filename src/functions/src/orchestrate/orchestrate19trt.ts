import * as functions from 'firebase-functions/v1';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { betweenTR_19_to_2359, dayKeyTR, ts } from '../utils/schedule.js';
import { log } from '../logger.js';
import { enqueueStartMatch, startMatchInternal } from './startMatch.js';

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();
const REGION = 'europe-west1';
const ORCH_SECRET = (functions.config() as any)?.orchestrate?.secret || '';

const MODE: 'TASKS' | 'SERIAL' = (process.env.ORCH_MODE as any) || 'SERIAL';

/** 19:00 TRT -> bugünün scheduled maçlarını bul ve başlat */
export const orchestrate19TRT = functions
  .runWith({ maxInstances: 50, timeoutSeconds: 540, memory: '512MB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
  const t0 = Date.now();
  // Simple bearer secret to restrict invocations to Scheduler/Operators
  const authz = (req.headers.authorization as string) || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!ORCH_SECRET || token !== ORCH_SECRET) {
    res.status(401).send('unauthorized');
    return;
  }

  const day = dayKeyTR();
  const { start, end } = betweenTR_19_to_2359(day);

  const q = db.collectionGroup('fixtures')
    .where('date', '>=', ts(start))
    .where('date', '<=', ts(end))
    .where('status', '==', 'scheduled');
  const snap = await q.get();

  const requestId = log.info('orchestrate19TRT_start', { function: 'orchestrate19TRT', day, count: snap.size, mode: MODE });

  if (MODE === 'TASKS') {
    for (const d of snap.docs) {
      const leagueId = d.ref.parent.parent?.id;
      if (!leagueId) continue;
      await enqueueStartMatch(d.id, leagueId);
    }
  } else {
    for (const d of snap.docs) {
      const leagueId = d.ref.parent.parent?.id;
      if (!leagueId) continue;
      await startMatchInternal(d.id, leagueId);
    }
  }

  // Mark heartbeat for watchdogs (Plan 8)
  try {
    await db.doc(`ops_heartbeats/${day}`).set({
      lastUpdated: FieldValue.serverTimestamp(),
      orchestrateOk: true,
      matchesScheduled: snap.size,
    }, { merge: true });
  } catch {}

  const durationMs = Date.now() - t0;
  log.info('orchestrate19TRT_done', { requestId, function: 'orchestrate19TRT', ok: true, durationMs, day, count: snap.size, mode: MODE });
  res.json({ ok: true, day, count: snap.size, mode: MODE, durationMs });
});
