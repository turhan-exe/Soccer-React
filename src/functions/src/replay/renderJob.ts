import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getStorage } from 'firebase-admin/storage';
import { v2 as cloudTasks } from '@google-cloud/tasks';
import { GoogleAuth } from 'google-auth-library';

const REGION = 'europe-west1';
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const RENDER_SECRET =
  (functions.config() as any)?.render?.secret ||
  (functions.config() as any)?.orchestrate?.secret ||
  '';
const RENDER_QUEUE = process.env.RENDER_QUEUE || 'render-video';
const RENDER_JOB_NAME = process.env.RENDER_JOB_NAME || 'unity-render';
const tasksClient = new cloudTasks.CloudTasksClient();

type RenderJobPayload = {
  matchId: string;
  leagueId: string;
  seasonId: string;
  replayPath: string;
  videoPath: string;
};

async function runRenderJob(payload: RenderJobPayload, signed: { replayUrl: string; videoUploadUrl: string }) {
  if (!PROJECT) throw new Error('PROJECT env missing');
  const url =
    `https://run.googleapis.com/v2/projects/${PROJECT}` +
    `/locations/${REGION}/jobs/${RENDER_JOB_NAME}:run`;
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const env = [
    { name: 'MATCH_ID', value: payload.matchId },
    { name: 'LEAGUE_ID', value: payload.leagueId },
    { name: 'SEASON_ID', value: payload.seasonId },
    { name: 'REPLAY_PATH', value: payload.replayPath },
    { name: 'VIDEO_PATH', value: payload.videoPath },
    { name: 'VIDEO_STORAGE_PATH', value: payload.videoPath },
    { name: 'REPLAY_URL', value: signed.replayUrl },
    { name: 'VIDEO_UPLOAD_URL', value: signed.videoUploadUrl },
  ];
  await client.request({
    url,
    method: 'POST',
    data: { overrides: { containerOverrides: [{ env }] } },
  });
}

export async function enqueueRenderJob(payload: RenderJobPayload) {
  const location = process.env.TASKS_LOCATION || 'europe-west1';
  const project = process.env.GCLOUD_PROJECT!;
  const parent = tasksClient.queuePath(project, location, RENDER_QUEUE);
  const url = `https://${REGION}-${project}.cloudfunctions.net/renderMatchHttp`;
  const task = {
    httpRequest: {
      httpMethod: 'POST' as const,
      url,
      headers: {
        'Content-Type': 'application/json',
        ...(RENDER_SECRET ? { Authorization: `Bearer ${RENDER_SECRET}` } : {}),
      },
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
    },
    name: `${parent}/tasks/render-${payload.matchId}`,
  } as const;

  try {
    await tasksClient.createTask({ parent, task: task as any });
  } catch (e: any) {
    if (e?.code === 6 || /ALREADY_EXISTS/i.test(e?.message || '')) return;
    throw e;
  }
}

export const renderMatchHttp = functions
  .runWith({ maxInstances: 50, timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!RENDER_SECRET || token !== RENDER_SECRET) {
      res.status(401).send('unauthorized');
      return;
    }

    const { matchId, leagueId, seasonId, replayPath, videoPath } = req.body || {};
    if (!matchId || !leagueId || !seasonId || !replayPath || !videoPath) {
      res.status(400).send('missing params');
      return;
    }

    try {
      const bucket = getStorage().bucket();
      const [replayUrl] = await bucket.file(replayPath).getSignedUrl({
        action: 'read',
        expires: Date.now() + 2 * 60 * 60 * 1000,
      });
      const [videoUploadUrl] = await bucket.file(videoPath).getSignedUrl({
        action: 'write',
        expires: Date.now() + 2 * 60 * 60 * 1000,
        contentType: 'video/mp4',
      });
      await runRenderJob(
        { matchId, leagueId, seasonId, replayPath, videoPath },
        { replayUrl, videoUploadUrl }
      );
      res.json({ ok: true });
    } catch (e: any) {
      functions.logger.error('[renderMatchHttp] failed', {
        matchId,
        leagueId,
        err: e?.message || String(e),
      });
      res.status(500).send(e?.message || 'error');
    }
  });
