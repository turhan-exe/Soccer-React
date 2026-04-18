import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createHmac, timingSafeEqual } from 'crypto';
import { log } from '../logger.js';
import { sendSlack } from '../notify/slack.js';
import { enqueueRenderJob } from '../replay/renderJob.js';
import {
  applyLeagueLineupMotivationEffects,
  applyLeagueMatchRevenueInTx,
  applyStandingResultInTx,
  resolveFixtureRevenueTeamIds,
} from '../utils/leagueMatchFinalize.js';
import { isKnockoutCompetition } from '../utils/competition.js';


const db = getFirestore();
const REGION = 'europe-west1';
const BATCH_SECRET = functions.config().unity?.batch_secret || process.env.BATCH_SECRET || '';

function verifyRequestToken(token: string, matchId: string, seasonId: string): boolean {
  if (!BATCH_SECRET) return false;
  const [issuedAtRaw, sig] = token.split('.', 2);
  const issuedAtMs = Number(issuedAtRaw);
  if (!issuedAtRaw || !sig || !Number.isFinite(issuedAtMs)) return false;
  const payload = `${matchId}:${seasonId}:${issuedAtMs}`;
  const expected = createHmac('sha256', BATCH_SECRET).update(payload).digest('hex');
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

async function resolveReplayPath(
  bucketName: string,
  seasonId: string,
  leagueId: string,
  matchId: string,
  resultJson: any
) {
  // Prefer explicit path from result JSON if provided
  const explicit: string | undefined = resultJson?.replay?.path || resultJson?.replayPath;
  if (explicit) return explicit;

  const bucket = getStorage().bucket(bucketName);
  const jsonPath = `replays/${seasonId}/${leagueId}/${matchId}.json`;
  const gzPath = `${jsonPath}.gz`;

  try {
    const [hasGz] = await bucket.file(gzPath).exists();
    if (hasGz) return gzPath;
  } catch {}

  // Fallback to .json (even if not found yet)
  return jsonPath;
}

export const onResultFinalize = functions
  .region(REGION)
  .storage.object().onFinalize(async (obj) => {
    try {
      if (!obj.name) return;
      const path = obj.name; // results/{season}/{league}/{matchId}.json
      if (!path.startsWith('results/')) return;

      const parts = path.split('/');
      if (parts.length < 4) return;
      const seasonId = parts[1];
      const leagueId = parts[2];
      const matchId = parts[3].replace('.json', '');

      const fileRef = getStorage().bucket(obj.bucket).file(path);
      const [buf] = await fileRef.download();
      const result = JSON.parse(buf.toString());

      if (BATCH_SECRET) {
        const token = result?.requestToken;
        if (!token || typeof token !== 'string') {
          throw new Error('requestToken missing in result payload');
        }
        if (!verifyRequestToken(token, matchId, seasonId)) {
          throw new Error('requestToken verification failed');
        }
      }

      const scoreAny = result?.score || result?.result || null;
      // Normalize score shape to { home, away }
      const score = typeof scoreAny?.home === 'number' && typeof scoreAny?.away === 'number'
        ? { home: scoreAny.home, away: scoreAny.away }
        : (typeof scoreAny?.h === 'number' && typeof scoreAny?.a === 'number'
            ? { home: scoreAny.h, away: scoreAny.a }
            : null);

      const replayPath = await resolveReplayPath(obj.bucket!, seasonId, leagueId, matchId, result);
      const videoPath = `videos/${seasonId}/${matchId}.mp4`;

      const fxRef = db.doc(`leagues/${leagueId}/fixtures/${matchId}`);
      const fixtureBeforeSnap = await fxRef.get();
      if (!fixtureBeforeSnap.exists) {
        return;
      }
      const resolvedTeamIds = await resolveFixtureRevenueTeamIds(
        leagueId,
        (fixtureBeforeSnap.data() as Record<string, unknown>) ?? {},
      );
      // Update fixture and standings atomically
      await db.runTransaction(async (tx) => {
        const fxSnap = await tx.get(fxRef);
        if (!fxSnap.exists) return;
        const cur = (fxSnap.data() as Record<string, unknown>) ?? {};
        const currentStatus = String(cur.status || 'scheduled');
        const currentVideo = (cur['video'] as Record<string, unknown> | undefined) ?? undefined;
        const updatePatch: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
          status: 'played',
          replayPath,
          videoMissing: true,
          'video.storagePath': videoPath,
          'video.type': 'mp4-v1',
          'video.source': String(currentVideo?.source || 'render'),
          'video.uploaded': false,
          'video.updatedAt': FieldValue.serverTimestamp(),
          'live.state': 'ended',
          'live.endedAt': FieldValue.serverTimestamp(),
          'live.lastLifecycleAt': FieldValue.serverTimestamp(),
          'live.resultMissing': false,
          'live.reason': FieldValue.delete(),
        };
        if (score) {
          updatePatch.score = score;
        }
        if (currentStatus !== 'played') {
          updatePatch.endedAt = FieldValue.serverTimestamp();
          updatePatch.playedAt = FieldValue.serverTimestamp();
        }
        tx.update(fxRef, updatePatch);

        if (score && currentStatus !== 'played') {
          await applyStandingResultInTx(tx, fxRef, cur, score);
        }
        await applyLeagueMatchRevenueInTx(tx, fxRef, cur, resolvedTeamIds);
      });

      try {
        await applyLeagueLineupMotivationEffects(leagueId, matchId);
      } catch (error: any) {
        log.warn('lineup motivation effects skipped', {
          leagueId,
          matchId,
          error: error?.message || String(error),
        });
      }

      // Log sim duration metrics (if startedAt exists)
      try {
        const fxAfter = await db.doc(`leagues/${leagueId}/fixtures/${matchId}`).get();
        const fxd = (fxAfter.data() as any) || {};
        const startedAt = fxd?.startedAt?.toDate?.() as Date | undefined;
        const endedAt = fxd?.endedAt?.toDate?.() as Date | undefined;
        const simDurationMs = startedAt && endedAt ? (endedAt.getTime() - startedAt.getTime()) : undefined;
        log.info('result finalized', { leagueId, matchId, replayPath, simDurationMs });

        const video = fxd?.video || {};
        const videoSource = String(video?.source || '');
        const alreadyQueued = !!video?.renderQueuedAt;
        const alreadyUploaded = !!video?.uploaded;
        const shouldUseLiveUpload = videoSource === 'live' || !!fxd?.live?.matchId;
        if (!alreadyQueued && !alreadyUploaded && !shouldUseLiveUpload) {
          await enqueueRenderJob({ matchId, leagueId, seasonId, replayPath, videoPath });
          await fxRef.set(
            {
              videoMissing: true,
              'video.storagePath': videoPath,
              'video.type': 'mp4-v1',
              'video.source': videoSource || 'render',
              'video.uploaded': false,
              'video.updatedAt': FieldValue.serverTimestamp(),
              'video.renderQueuedAt': FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          log.info('render job queued', { leagueId, matchId, videoPath });
        } else if (shouldUseLiveUpload) {
          log.info('render job skipped for live upload source', { leagueId, matchId, videoSource });
        }
      } catch (err: any) {
        log.warn('result finalized (render queue skipped)', {
          leagueId,
          matchId,
          replayPath,
          error: err?.message || String(err),
        });
      }

      // If no more scheduled/running fixtures remain, mark league completed
      try {
        const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
        const leagueData = leagueSnap.exists ? (leagueSnap.data() as Record<string, unknown>) : null;
        if (isKnockoutCompetition(leagueData)) {
          return;
        }
        const remaining = await db
          .collection('leagues')
          .doc(leagueId)
          .collection('fixtures')
          .where('status', 'in', ['scheduled', 'running'])
          .limit(1)
          .get();
        if (remaining.empty) {
          await db.doc(`leagues/${leagueId}`).set(
            { state: 'completed', completedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
      } catch {}
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      log.error('onResultFinalize error', { errorClass: e?.code || e?.name || 'FinalizeError', ok: false, err: String(errMsg) });
      try { await sendSlack(`❌ onResultFinalize hata: ${errMsg}`); } catch {}
    }
  });
