import * as functions from 'firebase-functions/v1';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { dayTR } from './heartbeat.js';
import { sendSlack } from '../notify/slack.js';
import { log } from '../logger.js';

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();
const REGION = 'europe-west1';
const SCHED_SECRET = (functions.config() as any)?.scheduler?.secret || (functions.config() as any)?.orchestrate?.secret || '';

// 19:10 TRT watchdog: verify daily heartbeats and alert via Slack if missing
export const watchdog1910 = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!SCHED_SECRET || token !== SCHED_SECRET) {
      res.status(401).send('unauthorized');
      return;
    }
    const day = dayTR();
    try {
      const snap = await db.doc(`ops_heartbeats/${day}`).get();
      const hb = snap.exists ? (snap.data() as any) : {};

      const problems: string[] = [];
      if (!hb?.batchOk) problems.push('createDailyBatch ÇALIŞMADI');
      // If you must ensure Unity job heartbeat, uncomment next line
      // if (!hb?.unityJobOk) problems.push('Unity job ÇALIŞMADI');

      if (problems.length) {
        const msg = `🚨 Watchdog ${day} 19:10: ${problems.join(' • ')}`;
        log.error('watchdog failed', { day, problems, hb: hb ?? null });
        await sendSlack(msg, { heartbeat: hb || null });
        res.status(500).json({ ok: false, problems });
        return;
      }

      log.info('watchdog ok', { day });
      res.json({ ok: true });
      return;
    } catch (e: any) {
      log.error('watchdog error', { day, error: e?.message || String(e) });
      await sendSlack(`🚨 Watchdog hata: ${e?.message || e}`);
      res.status(500).json({ ok: false, error: e?.message || 'unknown' });
      return;
    }
  });
