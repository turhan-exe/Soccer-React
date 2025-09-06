import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { queueTodayScheduledMatches } from './matches.js';


// Orchestrator endpoint for Cloud Scheduler (Option A in the plan)
export const orchestrate19TRT = functions
  .region('europe-west1')
  .https.onRequest(async (_req, res) => {
  try {
    const { totalFound, enqueued, alreadyQueued } = await queueTodayScheduledMatches();
    functions.logger.info('[SCHEDULER] 19:00 TRT orchestration complete', {
      totalFound,
      enqueued,
      alreadyQueued,
    });
    res.json({ ok: true, totalFound, enqueued, alreadyQueued });
  } catch (e: any) {
    functions.logger.error('[SCHEDULER] Orchestration failed', { error: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'unknown' });
  }
});
