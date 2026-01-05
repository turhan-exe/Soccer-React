import * as functions from 'firebase-functions/v1';
import type { File } from '@google-cloud/storage';
import { requireAppCheck, requireAuth } from '../mw/auth.js';
import '../_firebase.js';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { createHmac } from 'crypto';
import { ensureBotTeamDoc } from '../utils/bots.js';
import { ensureLeagueTeamDocs, TeamLookupResult } from '../utils/leagueTeams.js';


const db = getFirestore();
const BATCH_SECRET = functions.config().unity?.batch_secret || process.env.BATCH_SECRET || '';
const BATCH_RUN_OPTS: functions.RuntimeOptions = {
  timeoutSeconds: 540,
  memory: '1GB',
};
const DEFAULT_SHARDS = Number(functions.config().unity?.shards || process.env.BATCH_SHARDS || process.env.UNITY_SHARDS || '16');
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

function resolveShardCount(input?: number) {
  const raw = Number.isFinite(input) ? Number(input) : DEFAULT_SHARDS;
  const safe = Number.isFinite(raw) ? raw : 16;
  return Math.max(1, Math.min(64, Math.floor(safe)));
}

function normalizeTeamId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isSlotTeamId(teamId: string) {
  return teamId.startsWith('slot-');
}

type LineupPayload = {
  formation?: string;
  tactics?: Record<string, any>;
  starters?: string[];
  subs?: string[];
  reserves?: string[];
};

type TeamPayload = {
  id: string;
  teamId?: string;
  name?: string;
  clubName?: string;
  manager?: string;
  isBot?: boolean;
  botId?: string;
  kitHome?: unknown;
  kitAway?: unknown;
  kit?: unknown;
  kitAssets?: unknown;
  badge?: unknown;
  logo?: unknown;
  players?: any[];
  lineup?: LineupPayload;
  plan?: LineupPayload;
};

type TeamData = TeamLookupResult & { payload?: TeamPayload };

function normalizeLineup(raw: any): LineupPayload | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const payload: LineupPayload = {};
  if (typeof raw.formation === 'string') payload.formation = raw.formation;
  if (raw.tactics && typeof raw.tactics === 'object') payload.tactics = raw.tactics;
  if (Array.isArray(raw.starters)) payload.starters = raw.starters.map((id: any) => String(id));
  if (Array.isArray(raw.subs)) payload.subs = raw.subs.map((id: any) => String(id));
  if (Array.isArray(raw.reserves)) payload.reserves = raw.reserves.map((id: any) => String(id));
  if (!payload.formation && !payload.tactics && !payload.starters && !payload.subs && !payload.reserves) {
    return undefined;
  }
  return payload;
}

function buildTeamPayload(teamId: string, data: any): TeamPayload {
  const name = data?.name || data?.clubName || teamId;
  const payload: TeamPayload = {
    id: teamId,
    teamId,
    name,
    clubName: data?.clubName || data?.name,
    manager: data?.manager,
    isBot: data?.isBot,
    botId: data?.botId,
    kitHome: data?.kitHome,
    kitAway: data?.kitAway,
    kit: data?.kit,
    kitAssets: data?.kitAssets,
    badge: data?.badge,
    logo: data?.logo ?? null,
  };

  if (Array.isArray(data?.players)) {
    payload.players = data.players;
  }

  const lineup = normalizeLineup(data?.lineup);
  if (lineup) payload.lineup = lineup;

  const plan = normalizeLineup(data?.plan);
  if (plan) payload.plan = plan;

  return payload;
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
export async function createDailyBatchInternal(day?: string, opts?: { shards?: number }) {
  const tz = 'Europe/Istanbul';
  const theDay: string = day || todayTRString();
  const shardCount = resolveShardCount(opts?.shards);
  if (!BATCH_SECRET) {
    throw new Error('unity.batch_secret missing (set functions config or BATCH_SECRET env)');
  }

  const batchDir = `jobs/${theDay}`;

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
    const shards: Array<{ shard: number; count: number; batchPath: string; batchReadUrl: string }> = [];
    for (let shard = 0; shard < shardCount; shard += 1) {
      const batchPath = `${batchDir}/batch_${theDay}_s${shard}.json`;
      const emptyPayload = {
        meta: { day: theDay, tz, count: 0, shard, shards: shardCount, generatedAt: new Date().toISOString() },
        matches: [] as any[],
      };
      await saveJsonFile(bucket.file(batchPath), emptyPayload);
      const [batchReadUrl] = await getSignedUrlSafe(bucket.file(batchPath), {
        action: 'read',
        expires: Date.now() + 2 * 60 * 60 * 1000,
      });
      shards.push({ shard, count: 0, batchPath, batchReadUrl });
    }
    return {
      ok: true,
      day: theDay,
      count: 0,
      shardCount,
      batchPath: shards[0]?.batchPath,
      batchReadUrl: shards[0]?.batchReadUrl,
      shards,
    };
  }

  // Cache for league seasons to avoid duplicate reads
  const leagueSeasonCache = new Map<string, string | number>();
  const teamDataCache = new Map<string, TeamData>();
  const slotTeamCache = new Map<string, string | null>();
  const leagueTeamCache = new Map<string, boolean>();
  const leagueTeamMap = new Map<string, Set<string>>();

  async function getTeamData(teamId: string): Promise<TeamData> {
    if (!teamId) return { exists: false, name: teamId };
    if (teamDataCache.has(teamId)) return teamDataCache.get(teamId)!;
    let snap;
    try {
      snap = await db.doc(`teams/${teamId}`).get();
    } catch (e: any) {
      if (isPermissionDenied(e)) {
        throw new Error(FIRESTORE_READ_HINT);
      }
      throw e;
    }
    if (!snap.exists) {
      const missing: TeamData = { exists: false, name: teamId };
      teamDataCache.set(teamId, missing);
      return missing;
    }
    const data = snap.data() as any;
    const name = data?.name || data?.clubName || `Team ${teamId}`;
    const result: TeamData = {
      exists: true,
      name,
      ownerUid: data?.ownerUid,
      payload: buildTeamPayload(teamId, data),
    };
    teamDataCache.set(teamId, result);
    return result;
  }

  async function resolveSlotTeamId(leagueId: string, slotValue: unknown) {
    const slot = Number(slotValue);
    if (!Number.isFinite(slot) || slot <= 0) return null;
    const cacheKey = `${leagueId}:${slot}`;
    if (slotTeamCache.has(cacheKey)) return slotTeamCache.get(cacheKey)!;
    let slotSnap;
    try {
      slotSnap = await db.doc(`leagues/${leagueId}/slots/${slot}`).get();
    } catch (e: any) {
      if (isPermissionDenied(e)) {
        throw new Error(FIRESTORE_READ_HINT);
      }
      throw e;
    }
    if (!slotSnap.exists) {
      slotTeamCache.set(cacheKey, null);
      return null;
    }
    const slotData = slotSnap.data() as any;
    let teamId = normalizeTeamId(slotData?.teamId);
    if (!teamId && slotData?.botId) {
      teamId = await ensureBotTeamDoc({ botId: slotData.botId, slotIndex: slot });
    }
    slotTeamCache.set(cacheKey, teamId || null);
    return teamId || null;
  }

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
    let homeTeamId = normalizeTeamId(m.homeTeamId);
    let awayTeamId = normalizeTeamId(m.awayTeamId);
    if (homeTeamId && isSlotTeamId(homeTeamId)) {
      const slotIndex = Number(homeTeamId.replace('slot-', ''));
      homeTeamId = await resolveSlotTeamId(leagueId, slotIndex);
    }
    if (awayTeamId && isSlotTeamId(awayTeamId)) {
      const slotIndex = Number(awayTeamId.replace('slot-', ''));
      awayTeamId = await resolveSlotTeamId(leagueId, slotIndex);
    }
    if (!homeTeamId) {
      homeTeamId = await resolveSlotTeamId(leagueId, m.homeSlot);
    }
    if (!awayTeamId) {
      awayTeamId = await resolveSlotTeamId(leagueId, m.awaySlot);
    }

    if (!homeTeamId || !awayTeamId) {
      functions.logger.warn('[createDailyBatchInternal] skipping fixture with missing team ids', {
        matchId,
        leagueId,
        homeTeamId,
        awayTeamId,
        homeSlot: m.homeSlot ?? null,
        awaySlot: m.awaySlot ?? null,
      });
      continue;
    }

    const [homeData, awayData] = await Promise.all([
      getTeamData(homeTeamId),
      getTeamData(awayTeamId),
    ]);
    if (!homeData.exists || !awayData.exists) {
      functions.logger.warn('[createDailyBatchInternal] skipping fixture with missing team docs', {
        matchId,
        leagueId,
        homeTeamId,
        awayTeamId,
        homeExists: homeData.exists,
        awayExists: awayData.exists,
      });
      continue;
    }
    const leagueTeams = leagueTeamMap.get(leagueId) ?? new Set<string>();
    leagueTeams.add(homeTeamId);
    leagueTeams.add(awayTeamId);
    leagueTeamMap.set(leagueId, leagueTeams);
    const requestToken = buildRequestToken(matchId, seasonIdStr, Date.now(), BATCH_SECRET);

    const teams: Record<string, TeamPayload> = {};
    if (homeData.payload) teams[homeTeamId] = homeData.payload;
    if (awayData.payload) teams[awayTeamId] = awayData.payload;

    // Output paths
    const replayPath = `replays/${seasonIdStr}/${leagueId}/${matchId}.json`;
    const resultPath = `results/${seasonIdStr}/${leagueId}/${matchId}.json`;
    const videoPath = `videos/${seasonIdStr}/${matchId}.mp4`;

    // Signed URLs (allow a few hours for long jobs)
    const [replayUploadUrl] = await getSignedUrlSafe(bucket.file(replayPath), {
      action: 'write',
      expires: Date.now() + 3 * 60 * 60 * 1000,
      contentType: 'application/json; charset=utf-8',
    });
    const [resultUploadUrl] = await getSignedUrlSafe(bucket.file(resultPath), {
      action: 'write',
      expires: Date.now() + 3 * 60 * 60 * 1000,
      contentType: 'application/json; charset=utf-8',
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
      homeTeamId,
      awayTeamId,
      seed: m.seed ?? Math.floor(Math.random() * 1e9),
      requestToken,
      replayUploadUrl,
      resultUploadUrl,
      videoUploadUrl,
      videoPath,
      teams: Object.keys(teams).length ? teams : undefined,
    });
  }

  for (const [leagueId, teamSet] of leagueTeamMap.entries()) {
    await ensureLeagueTeamDocs(leagueId, Array.from(teamSet), {
      cache: leagueTeamCache,
      teamLookup: getTeamData,
    });
  }

  const shards: Array<{ shard: number; count: number; batchPath: string; batchReadUrl: string }> = [];
  const shardBuckets: any[][] = Array.from({ length: shardCount }, () => []);
  matches.forEach((m, idx) => {
    shardBuckets[idx % shardCount].push(m);
  });

  for (let shard = 0; shard < shardCount; shard += 1) {
    const batchPath = `${batchDir}/batch_${theDay}_s${shard}.json`;
    const payload = {
      meta: { day: theDay, tz, count: shardBuckets[shard].length, shard, shards: shardCount, generatedAt: new Date().toISOString() },
      matches: shardBuckets[shard],
    };
    await saveJsonFile(bucket.file(batchPath), payload);
    const [batchReadUrl] = await getSignedUrlSafe(bucket.file(batchPath), {
      action: 'read',
      expires: Date.now() + 2 * 60 * 60 * 1000,
    });
    shards.push({ shard, count: shardBuckets[shard].length, batchPath, batchReadUrl });
  }

  return {
    ok: true,
    day: theDay,
    count: matches.length,
    shardCount,
    batchPath: shards[0]?.batchPath,
    batchReadUrl: shards[0]?.batchReadUrl,
    shards,
    matches,
  };
}

// Generates the daily batch file for Unity headless worker (callable wrapper)
export const createDailyBatch = functions
  .runWith(BATCH_RUN_OPTS)
  .region('europe-west1')
  .https.onCall(async (data: any, _context) => {
    requireAppCheck(_context as any);
    requireAuth(_context as any);
    const res = await createDailyBatchInternal((data && (data as any).date) || undefined);
    return res;
  });

// HTTP fallback for cases where AppCheck blocks callable (Bearer ID token required)
export const createDailyBatchHttp = functions
  .runWith(BATCH_RUN_OPTS)
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
