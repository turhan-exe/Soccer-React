import * as functions from 'firebase-functions/v1';
import { requireAppCheck, requireAuth } from '../mw/auth.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import * as admin from 'firebase-admin';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

function todayTRString(date?: Date) {
  const d = date ?? new Date();
  return formatInTimeZone(d, 'Europe/Istanbul', 'yyyy-MM-dd');
}

// Shared internal for cron + callable
export async function createDailyBatchInternal(day?: string) {
  const tz = 'Europe/Istanbul';
  const theDay: string = day || todayTRString();

  const batchDir = `jobs/${theDay}`;
  const batchPath = `${batchDir}/batch_${theDay}.json`;

  // Compute the day's 19:00 TRT in UTC
  const kickoffUtc = fromZonedTime(`${theDay} 19:00:00`, tz);
  const matchTs = Timestamp.fromDate(kickoffUtc);

  // Collect all scheduled fixtures at 19:00 (collectionGroup)
  const snap = await db
    .collectionGroup('fixtures')
    .where('status', '==', 'scheduled')
    .where('date', '==', matchTs)
    .get();

  const bucket = admin.storage().bucket();

  if (snap.empty) {
    const emptyPayload = {
      meta: { day: theDay, tz, count: 0, generatedAt: new Date().toISOString() },
      matches: [] as any[],
    };
    await bucket.file(batchPath).save(JSON.stringify(emptyPayload, null, 2), {
      contentType: 'application/json',
    });
    const [batchReadUrl] = await bucket
      .file(batchPath)
      .getSignedUrl({ action: 'read', expires: Date.now() + 2 * 60 * 60 * 1000 });
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
        const leagueDoc = await leagueRef.get();
        season = (leagueDoc.get('seasonId') as string) ?? (leagueDoc.get('season') as number) ?? 'default';
        leagueSeasonCache.set(leagueId, season);
      }
    }
    const seasonId = season ?? 'default';

    const matchId = d.id;

    // Output paths
    const replayPath = `replays/${seasonId}/${leagueId}/${matchId}.json`;
    const resultPath = `results/${seasonId}/${leagueId}/${matchId}.json`;

    // Signed URLs (allow a few hours for long jobs)
    const [replayUploadUrl] = await bucket.file(replayPath).getSignedUrl({
      action: 'write',
      expires: Date.now() + 3 * 60 * 60 * 1000,
      contentType: 'application/json',
    });
    const [resultUploadUrl] = await bucket.file(resultPath).getSignedUrl({
      action: 'write',
      expires: Date.now() + 3 * 60 * 60 * 1000,
      contentType: 'application/json',
    });

    matches.push({
      matchId,
      leagueId,
      seasonId,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      seed: m.seed ?? Math.floor(Math.random() * 1e9),
      replayUploadUrl,
      resultUploadUrl,
    });
  }

  const payload = {
    meta: { day: theDay, tz, count: matches.length, generatedAt: new Date().toISOString() },
    matches,
  };

  await bucket.file(batchPath).save(JSON.stringify(payload, null, 2), {
    contentType: 'application/json',
  });

  const [batchReadUrl] = await bucket
    .file(batchPath)
    .getSignedUrl({ action: 'read', expires: Date.now() + 2 * 60 * 60 * 1000 });

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
