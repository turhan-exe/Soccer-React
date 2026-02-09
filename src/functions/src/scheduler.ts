import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { dayKeyTR } from './utils/schedule.js';
import { createDailyBatchInternal } from './jobs/createBatch.js';
import { GoogleAuth } from 'google-auth-library';

const REGION = 'europe-west1';
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

// Legacy wrapper kept for compatibility with older scheduler setups.
export const orchestrate19TRT = functions
  .region(REGION)
  .https.onRequest(async (_req, res) => {
    try {
      const day = dayKeyTR();
      const r = await createDailyBatchInternal(day);
      const shards = r.shards || [];
      const shardCount = r.shardCount || shards.length || 1;
      const unityJobs = r.count ? shardCount : 0;
      if (!r.count) {
        functions.logger.info('[scheduler] empty batch, skipping Unity jobs', {
          day,
          shardCount,
          shards: shards.length,
        });
        res.json({ ok: true, day, count: r.count, shards: unityJobs });
        return;
      }
      if (shards.length === 0 && r.batchReadUrl) {
        await runUnityJob(r.batchReadUrl, 0, shardCount);
      } else {
        await Promise.all(
          shards.map((s) => runUnityJob(s.batchReadUrl, s.shard, shardCount))
        );
      }
      res.json({ ok: true, day, count: r.count, shards: shardCount });
    } catch (e: any) {
      functions.logger.error('[scheduler] orchestrate19TRT failed', { error: e?.message });
      res.status(500).json({ ok: false, error: e?.message || 'unknown' });
    }
  });
