import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { betweenTR_19_to_2359, dayKeyTR, ts } from '../utils/schedule.js';
import { log } from '../logger.js';
import { enqueueStartMatch, startMatchInternal } from './startMatch.js';

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
    const reqCtx = { requestId: req.headers['x-cloud-trace-context'] || undefined };
    // Simple bearer secret to restrict invocations to Scheduler/Operators
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!ORCH_SECRET || token !== ORCH_SECRET) {
      res.status(401).send('unauthorized');
      return;
    }

    try {
      const day = dayKeyTR();
      const { start, end } = betweenTR_19_to_2359(day);

      // Bug fix: catch up any geciken (date < today 19:00) scheduled maçlar as well.
      const q = db.collectionGroup('fixtures')
        .where('date', '>=', ts(start))
        .where('date', '<=', ts(end));
      const snap = await q.get();
      const todaysDocs = snap.docs.filter((d) => (d.data() as any)?.status === 'scheduled');

      // Overdue window: anything scheduled before today's 19:00 that is still 'scheduled' (limit to avoid huge scans)
      const overdueSnap = await db.collectionGroup('fixtures')
        .where('date', '<', ts(start))
        .orderBy('date', 'asc')
        .limit(200)
        .get();
      const overdueDocs = overdueSnap.docs.filter((d) => (d.data() as any)?.status === 'scheduled');

      // Merge without duplicates
      const seen = new Set<string>();
      const docs = [...todaysDocs, ...overdueDocs].filter((d) => {
        const id = d.ref.path;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      const requestId = log.info('orchestrate19TRT_start', {
        function: 'orchestrate19TRT',
        day,
        count: docs.length,
        today: todaysDocs.length,
        overdue: overdueDocs.length,
        mode: MODE,
      });

      if (MODE === 'TASKS') {
        for (const d of docs) {
          const leagueId = d.ref.parent.parent?.id;
          if (!leagueId) continue;
          await enqueueStartMatch(d.id, leagueId);
        }
      } else {
        for (const d of docs) {
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
          matchesScheduled: docs.length,
        }, { merge: true });
      } catch {}

      const durationMs = Date.now() - t0;
      log.info('orchestrate19TRT_done', { requestId, function: 'orchestrate19TRT', ok: true, durationMs, day, count: docs.length, mode: MODE });
      res.json({ ok: true, day, count: docs.length, mode: MODE, durationMs });
    } catch (e: any) {
      const durationMs = Date.now() - t0;
      functions.logger.error('orchestrate19TRT_http_err', { ...reqCtx, err: e?.message || String(e), stack: e?.stack, durationMs });
      res.status(500).json({ ok: false, error: e?.message || 'internal error' });
    }
  });

