import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { dayKeyTR } from '../utils/schedule.js';
import { log } from '../logger.js';
import { createDailyBatchInternal } from '../jobs/createBatch.js';
import { GoogleAuth } from 'google-auth-library';

const db = getFirestore();
const REGION = 'europe-west1';
const ORCH_SECRET = (functions.config() as any)?.orchestrate?.secret || '';
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';

async function runUnityJob(
  batchUrl: string,
  shard: number,
  shards: number,
  jobName = process.env.UNITY_JOB_NAME || 'unity-sim'
) {
  if (!PROJECT) throw new Error('PROJECT env missing');
  const url =
    `https://run.googleapis.com/v2/projects/${PROJECT}` +
    `/locations/${REGION}/jobs/${jobName}:run`;
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
    functions.logger.info('[orchestrate19TRT] empty batch, skipping Unity jobs', {
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

/** 19:00 TRT -> Unity batch create + job kickoff */
export const orchestrate19TRT = functions
  .runWith({ maxInstances: 50, timeoutSeconds: 540, memory: '512MB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const t0 = Date.now();
    const reqCtx = { requestId: req.headers['x-cloud-trace-context'] || undefined };
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!ORCH_SECRET || token !== ORCH_SECRET) {
      res.status(401).send('unauthorized');
      return;
    }

    try {
      const day = dayKeyTR();
      const r = await kickUnityJobsForDay(day);
      const requestId = log.info('orchestrate19TRT_start', {
        function: 'orchestrate19TRT',
        day,
        count: r.count,
        shards: r.shardCount,
      });

      try {
        await db.doc(`ops_heartbeats/${day}`).set({
          lastUpdated: FieldValue.serverTimestamp(),
          orchestrateOk: true,
          batchOk: true,
          batchCount: r.count,
          batchShards: r.shardCount,
          unityJobs: r.unityJobs ?? r.shardCount,
        }, { merge: true });
      } catch {}

      const durationMs = Date.now() - t0;
      log.info('orchestrate19TRT_done', {
        requestId,
        function: 'orchestrate19TRT',
        ok: true,
        durationMs,
        day,
        count: r.count,
        shards: r.shardCount,
      });
      res.json({ ok: true, day, count: r.count, shards: r.shardCount, durationMs });
    } catch (e: any) {
      const durationMs = Date.now() - t0;
      functions.logger.error('orchestrate19TRT_http_err', { ...reqCtx, err: e?.message || String(e), stack: e?.stack, durationMs });
      res.status(500).json({ ok: false, error: e?.message || 'internal error' });
    }
  });
