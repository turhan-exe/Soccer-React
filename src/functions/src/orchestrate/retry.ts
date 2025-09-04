import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { v2 as cloudTasks } from '@google-cloud/tasks';
import { log } from '../logger.js';
import { startMatchInternal } from './startMatch.js';
import { sendSlack } from '../notify/slack.js';

const db = admin.firestore();
const REGION = 'europe-west1';
const START_SECRET = (functions.config() as any)?.start?.secret || (functions.config() as any)?.orchestrate?.secret || '';
const MAX_RETRIES = Number(process.env.FINALIZE_MAX_RETRIES || '3');
const WATCHDOG_DELAY_SEC = Number(process.env.FINALIZE_WATCHDOG_DELAY_SEC || `${20 * 60}`); // default 20 minutes

const tasksClient = new cloudTasks.CloudTasksClient();

export async function scheduleFinalizeWatchdog(matchId: string, leagueId: string, attempt = 0, delaySec = WATCHDOG_DELAY_SEC) {
  try {
    const queue = process.env.TASKS_QUEUE || 'start-match';
    const location = process.env.TASKS_LOCATION || REGION;
    const project = process.env.GCLOUD_PROJECT!;
    const parent = tasksClient.queuePath(project, location, queue);
    const url = `https://${REGION}-${project}.cloudfunctions.net/finalizeWatchdogHttp`;
    const payload = { matchId, leagueId, attempt };
    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url,
        headers: {
          'Content-Type': 'application/json',
          ...(START_SECRET ? { Authorization: `Bearer ${START_SECRET}` } : {}),
        },
        body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      },
      scheduleTime: { seconds: Math.floor(Date.now() / 1000) + delaySec },
    } as const;
    await tasksClient.createTask({ parent, task: task as any });
    log.debug('watchdog task scheduled', { matchId, leagueId, attempt, delaySec });
  } catch (e: any) {
    log.error('scheduleFinalizeWatchdog failed', { matchId, leagueId, attempt, errorClass: e?.code || e?.name || 'ScheduleError', err: String(e) });
  }
}

async function markPoison(matchId: string, leagueId: string, reason: string, attempt: number) {
  try {
    await db.doc(`leagues/${leagueId}/fixtures/${matchId}`).set({
      status: 'failed',
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
      failReason: reason,
    }, { merge: true });
  } catch {}
  try {
    await db.doc(`failedJobs/${matchId}`).set({
      matchId,
      leagueId,
      reason,
      attempt,
      ts: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch {}
  try {
    await sendSlack(`❌ Maç başarısız: ${matchId} (Lig: ${leagueId}) deneme=${attempt} reason=${reason}`);
  } catch {}
}

export const finalizeWatchdogHttp = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const t0 = Date.now();
    // Restrict to Tasks via bearer
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!START_SECRET || token !== START_SECRET) {
      res.status(401).send('unauthorized');
      return;
    }
    const { matchId, leagueId, attempt = 0 } = (req.body || {}) as any;
    if (!matchId || !leagueId) {
      res.status(400).send('missing params');
      return;
    }
    const fxRef = db.doc(`leagues/${leagueId}/fixtures/${matchId}`);
    const fxDoc = await fxRef.get();
    if (!fxDoc.exists) {
      await markPoison(matchId, leagueId, 'fixture_missing', attempt);
      res.json({ ok: false, reason: 'fixture_missing' });
      return;
    }
    const fx = fxDoc.data() as any;

    if (fx.status === 'played') {
      log.info('watchdog_ok_played', { matchId, leagueId, attempt, durationMs: Date.now() - t0 });
      res.json({ ok: true, played: true });
      return;
    }

    // Not played (scheduled or running)
    if (attempt + 1 < MAX_RETRIES) {
      // Try redispatch Unity if still running/scheduled
      try {
        await startMatchInternal(matchId, leagueId, { forceRedispatch: true });
      } catch {}
      await scheduleFinalizeWatchdog(matchId, leagueId, attempt + 1);
      log.warn('watchdog_retry_scheduled', { matchId, leagueId, nextAttempt: attempt + 1 });
      res.json({ ok: true, retried: true, nextAttempt: attempt + 1 });
      return;
    }

    // Poison
    await markPoison(matchId, leagueId, fx.status || 'unknown_status', attempt);
    res.json({ ok: false, poisoned: true });
  });

