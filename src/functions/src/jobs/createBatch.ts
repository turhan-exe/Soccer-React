import * as functions from 'firebase-functions/v1';
import type { File } from '@google-cloud/storage';
import { requireAppCheck, requireAuth } from '../mw/auth.js';
import '../_firebase.js';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { createHmac } from 'crypto';


const db = getFirestore();
const BATCH_SECRET = functions.config().unity?.batch_secret || process.env.BATCH_SECRET || '';
const STORAGE_WRITE_HINT =
  'Storage write permission missing. Grant Storage Object Admin to the Cloud Functions service account on the bucket.';
const SIGNED_URL_HINT =
  'Signed URL permission missing. Grant Storage Object Admin and Service Account Token Creator to the Cloud Functions service account.';
const FIRESTORE_READ_HINT =
  'Firestore read permission missing. Grant Datastore User (or higher) to the Cloud Functions service account.';

function buildRequestToken(matchId: string, seasonId: string, issuedAtMs: number, secret: string) {
  const payload = `${matchId}:${seasonId}:${issuedAtMs}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${issuedAtMs}.${sig}`;
}

function todayTRString(date?: Date) {
  const d = date ?? new Date();
  return formatInTimeZone(d, 'Europe/Istanbul', 'yyyy-MM-dd');
}

async function getSignedUrlSafe(
  file: File,
  options: Parameters<File['getSignedUrl']>[0]
) {
  try {
    return await file.getSignedUrl(options);
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (e?.code === 7 || msg.includes('PERMISSION_DENIED')) {
      throw new Error(SIGNED_URL_HINT);
    }
    throw e;
  }
}

async function saveJsonFile(file: File, payload: unknown) {
  try {
    await file.save(JSON.stringify(payload, null, 2), {
      contentType: 'application/json',
    });
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (e?.code === 7 || msg.includes('PERMISSION_DENIED')) {
      throw new Error(STORAGE_WRITE_HINT);
    }
    throw e;
  }
}

function isPermissionDenied(e: any) {
  const msg = String(e?.message || '');
  return e?.code === 7 || msg.includes('PERMISSION_DENIED') || msg.includes('permission-denied');
}

// Shared internal for cron + callable
export async function createDailyBatchInternal(day?: string) {
  const tz = 'Europe/Istanbul';
  const theDay: string = day || todayTRString();
  if (!BATCH_SECRET) {
    throw new Error('unity.batch_secret missing (set functions config or BATCH_SECRET env)');
  }

  const batchDir = `jobs/${theDay}`;
  const batchPath = `${batchDir}/batch_${theDay}.json`;

  // Compute the day's 19:00 TRT in UTC
  const kickoffUtc = fromZonedTime(`${theDay} 19:00:00`, tz);
  const matchTs = Timestamp.fromDate(kickoffUtc);

  // Collect all scheduled fixtures at 19:00 (collectionGroup)
  let snap;
  try {
    snap = await db
      .collectionGroup('fixtures')
      .where('status', '==', 'scheduled')
      .where('date', '==', matchTs)
      .get();
  } catch (e: any) {
    if (isPermissionDenied(e)) {
      throw new Error(FIRESTORE_READ_HINT);
    }
    throw e;
  }

  const bucket = getStorage().bucket();

  if (snap.empty) {
    const emptyPayload = {
      meta: { day: theDay, tz, count: 0, generatedAt: new Date().toISOString() },
      matches: [] as any[],
    };
    await saveJsonFile(bucket.file(batchPath), emptyPayload);
    const [batchReadUrl] = await getSignedUrlSafe(bucket.file(batchPath), {
      action: 'read',
      expires: Date.now() + 2 * 60 * 60 * 1000,
    });
    return { ok: true, day: theDay, count: 0, batchPath, batchReadUrl };
  }

  // Cache for league seasons to avoid duplicate reads
  const leagueSeasonCache = new Map<string, string | number>();

  const matches: any[] = [];
  for (const d of snap.docs) {
    const m = d.data() as any;
    const leagueRef = d.ref.parent.parent;
    const leagueId = leagueRef?.id || 'unknown';

    // Resolve season (prefer fixture field seasonId/season, fallback to league doc)
    let season: string | number | undefined = m.seasonId ?? m.season;
    if (!season && leagueRef) {
      if (leagueSeasonCache.has(leagueId)) {
        season = leagueSeasonCache.get(leagueId)!;
      } else {
        let leagueDoc;
        try {
          leagueDoc = await leagueRef.get();
        } catch (e: any) {
          if (isPermissionDenied(e)) {
            throw new Error(FIRESTORE_READ_HINT);
          }
          throw e;
        }
        season = (leagueDoc.get('seasonId') as string) ?? (leagueDoc.get('season') as number) ?? 'default';
        leagueSeasonCache.set(leagueId, season);
      }
    }
    const seasonId = season ?? 'default';
    const seasonIdStr = String(seasonId);

    const matchId = d.id;
    const requestToken = buildRequestToken(matchId, seasonIdStr, Date.now(), BATCH_SECRET);

    // Output paths
    const replayPath = `replays/${seasonIdStr}/${leagueId}/${matchId}.json`;
    const resultPath = `results/${seasonIdStr}/${leagueId}/${matchId}.json`;
    const videoPath = `videos/${seasonIdStr}/${matchId}.mp4`;

    // Signed URLs (allow a few hours for long jobs)
    const [replayUploadUrl] = await getSignedUrlSafe(bucket.file(replayPath), {
      action: 'write',
      expires: Date.now() + 3 * 60 * 60 * 1000,
      contentType: 'application/json',
    });
    const [resultUploadUrl] = await getSignedUrlSafe(bucket.file(resultPath), {
      action: 'write',
      expires: Date.now() + 3 * 60 * 60 * 1000,
      contentType: 'application/json',
    });
    const [videoUploadUrl] = await getSignedUrlSafe(bucket.file(videoPath), {
      action: 'write',
      expires: Date.now() + 3 * 60 * 60 * 1000,
      contentType: 'video/mp4',
    });

    matches.push({
      matchId,
      leagueId,
      seasonId: seasonIdStr,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      seed: m.seed ?? Math.floor(Math.random() * 1e9),
      requestToken,
      replayUploadUrl,
      resultUploadUrl,
      videoUploadUrl,
      videoPath,
    });
  }

  const payload = {
    meta: { day: theDay, tz, count: matches.length, generatedAt: new Date().toISOString() },
    matches,
  };

  await saveJsonFile(bucket.file(batchPath), payload);

  const [batchReadUrl] = await getSignedUrlSafe(bucket.file(batchPath), {
    action: 'read',
    expires: Date.now() + 2 * 60 * 60 * 1000,
  });

  return { ok: true, day: theDay, count: matches.length, batchPath, batchReadUrl };
}

// Generates the daily batch file for Unity headless worker (callable wrapper)
export const createDailyBatch = functions
  .region('europe-west1')
  .https.onCall(async (data: any, _context) => {
    requireAppCheck(_context as any);
    requireAuth(_context as any);
    const res = await createDailyBatchInternal((data && (data as any).date) || undefined);
    return res;
  });

// HTTP fallback for cases where AppCheck blocks callable (Bearer ID token required)
export const createDailyBatchHttp = functions
  .region('europe-west1')
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!token) { res.status(401).json({ error: 'Auth required' }); return; }

    try {
      const { getAuth } = await import('firebase-admin/auth');
      await getAuth().verifyIdToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    let body: any = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    } catch {
      body = {};
    }

    try {
      const resData = await createDailyBatchInternal((body && (body as any).date) || undefined);
      res.json(resData);
    } catch (e: any) {
      functions.logger.error('[createDailyBatchHttp] failed', { error: e?.message || String(e) });
      res.status(500).json({ error: e?.message || 'error' });
    }
  });
