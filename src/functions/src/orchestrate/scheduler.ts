import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { formatInTimeZone } from 'date-fns-tz';
import { sendSlack } from '../notify/slack.js';
import { createDailyBatchInternal } from '../jobs/createBatch.js';
import { GoogleAuth } from 'google-auth-library';


const db = getFirestore();
const TZ = 'Europe/Istanbul';
const REGION = 'europe-west1';
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const SCHED_SECRET = (functions.config() as any)?.scheduler?.secret || (functions.config() as any)?.orchestrate?.secret || '';

function todayTR(d = new Date()) {
  return formatInTimeZone(d, TZ, 'yyyy-MM-dd');
}

async function setHeartbeat(day: string, patch: Record<string, any>) {
  const ref = db.doc(`ops_heartbeats/${day}`);
  await ref.set({ lastUpdated: FieldValue.serverTimestamp(), ...patch }, { merge: true });
}

export const cronCreateBatch = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!SCHED_SECRET || token !== SCHED_SECRET) {
      res.status(401).send('unauthorized');
      return;
    }
    try {
      const day = todayTR();
      const r = await createDailyBatchInternal(day);
      await setHeartbeat(day, {
        batchOk: true,
        batchCount: r.count,
        batchShards: r.shardCount || r.shards?.length || 1,
        info: r.batchPath,
      });
      res.json(r);
    } catch (e: any) {
      await sendSlack(`❌ cronCreateBatch hata: ${e?.message || e}`);
      res.status(500).send(e?.message || 'error');
    }
  });

async function runUnityJob(
  batchUrl: string,
  shard: number,
  shards: number,
  jobName = process.env.UNITY_JOB_NAME || 'unity-sim'
) {
  if (!PROJECT) throw new Error('PROJECT env missing');
  const url = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${jobName}:run`;
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  await client.request({
    url,
    method: 'POST',
    data: {
      overrides: {
        containerOverrides: [{
          env: [
            { name: 'BATCH_URL', value: batchUrl },
            { name: 'UNITY_BATCH_URL', value: batchUrl },
            { name: 'BATCH_SHARD', value: String(shard) },
            { name: 'BATCH_SHARDS', value: String(shards) },
          ],
        }],
      },
    },
  });
}

async function kickUnityJobsForDay(day: string) {
  const r = await createDailyBatchInternal(day);
  const shards = r.shards || [];
  const shardCount = r.shardCount || shards.length || 1;
  const unityJobs = r.count ? shardCount : 0;
  if (!r.count) {
    functions.logger.info('[kickUnityJob] empty batch, skipping Unity jobs', {
      day,
      shardCount,
      shards: shards.length,
    });
    return { ...r, shardCount, unityJobs };
  }
  if (shards.length === 0 && r.batchReadUrl) {
    await runUnityJob(r.batchReadUrl, 0, shardCount);
    return { ...r, shardCount, unityJobs };
  }
  await Promise.all(
    shards.map((s) => runUnityJob(s.batchReadUrl, s.shard, shardCount))
  );
  return { ...r, shardCount, unityJobs };
}

export const kickUnityJob = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!SCHED_SECRET || token !== SCHED_SECRET) {
      res.status(401).send('unauthorized');
      return;
    }
    try {
      const day = todayTR();
      const r = await kickUnityJobsForDay(day);
      await setHeartbeat(day, {
        unityJobOk: true,
        unityJobs: r.unityJobs ?? r.shardCount,
        batchCount: r.count,
      });
      res.json({ ok: true });
    } catch (e: any) {
      await sendSlack(`❌ kickUnityJob hata: ${e?.message || e}`);
      res.status(500).send(e?.message || 'error');
    }
  });

export const cronWatchdog = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!SCHED_SECRET || token !== SCHED_SECRET) {
      res.status(401).send('unauthorized');
      return;
    }
    const day = todayTR();
    const snap = await db.doc(`ops_heartbeats/${day}`).get();
    const hb = snap.exists ? (snap.data() as any) : {};
    const problems: string[] = [];
    if (!hb.orchestrateOk && !hb.batchOk) problems.push('orchestrate19TRT/heartbeat eksik');

    // scheduled matches that should have started but didn't
    const scheduledPastSnap = await db
      .collectionGroup('fixtures')
      .where('status', '==', 'scheduled')
      .where('date', '<', Timestamp.now())
      .limit(50)
      .get();
    if (scheduledPastSnap.size > 0) problems.push(`scheduledPast=${scheduledPastSnap.size}`);

    // running for too long (e.g., > 20 min) but not played
    const twentyMinAgo = Timestamp.fromMillis(Date.now() - 20 * 60 * 1000);
    const longRunningSnap = await db
      .collectionGroup('fixtures')
      .where('status', '==', 'running')
      .where('startedAt', '<=', twentyMinAgo)
      .limit(50)
      .get();
    if (longRunningSnap.size > 0) problems.push(`longRunning=${longRunningSnap.size}`);

    // If you require Unity job heartbeat, uncomment:
    // if (!hb.unityJobOk) problems.push('Unity job çalismadi');
    if (problems.length) {
      await sendSlack(`🚨 Watchdog ${day} 19:10: ${problems.join(' • ')}`, { heartbeat: hb, scheduledPast: scheduledPastSnap.size });
      res.status(500).json({ ok: false, problems });
      return;
    }
    res.json({ ok: true });
      return;
  });
