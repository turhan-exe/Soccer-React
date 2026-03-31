import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { getFirestore, FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { formatInTimeZone } from 'date-fns-tz';
import { createHmac, randomUUID } from 'crypto';
import { trAt, dayKeyTR } from './utils/schedule.js';
import { ensureBotTeamDoc } from './utils/bots.js';
import { buildUnityRuntimeTeamPayload, type UnityRuntimeTeamPayload } from './utils/unityRuntimePayload.js';
import {
  finalizeLeagueFixtureSettlement,
  resolveFixtureRevenueTeamIds,
} from './utils/leagueMatchFinalize.js';
import { enqueueRenderJob } from './replay/renderJob.js';
import { enqueueLeagueMatchReminder } from './notify/matchReminder.js';

const REGION = 'europe-west1';
const TZ = 'Europe/Istanbul';
const db = getFirestore();
const bucket = getStorage().bucket();

const MATCH_CONTROL_BASE_URL =
  process.env.MATCH_CONTROL_BASE_URL ||
  (functions.config() as any)?.matchcontrol?.base_url ||
  '';
const MATCH_CONTROL_SECRET =
  process.env.MATCH_CONTROL_SECRET ||
  (functions.config() as any)?.matchcontrol?.secret ||
  (functions.config() as any)?.orchestrate?.secret ||
  '';
const LIFECYCLE_SECRET =
  process.env.LEAGUE_LIFECYCLE_SECRET ||
  (functions.config() as any)?.liveleague?.secret ||
  (functions.config() as any)?.scheduler?.secret ||
  (functions.config() as any)?.orchestrate?.secret ||
  '';
const BATCH_SECRET =
  process.env.BATCH_SECRET ||
  (functions.config() as any)?.unity?.batch_secret ||
  '';
const ADMIN_SECRET =
  process.env.ADMIN_SECRET ||
  (functions.config() as any)?.admin?.secret ||
  (functions.config() as any)?.scheduler?.secret ||
  (functions.config() as any)?.orchestrate?.secret ||
  '';
const LEAGUE_KICKOFF_HOURS_TR = parseKickoffHours(
  process.env.LEAGUE_KICKOFF_HOURS_TR ||
    (functions.config() as any)?.liveleague?.kickoff_hours_tr ||
    '19',
);
const LEAGUE_PREWARM_LEAD_MINUTES = Number(
  process.env.LEAGUE_PREWARM_LEAD_MINUTES ||
    (functions.config() as any)?.liveleague?.prewarm_lead_minutes ||
    15,
);
const LEAGUE_PREPARE_WINDOW_MINUTES = Number(
  process.env.LEAGUE_PREPARE_WINDOW_MINUTES ||
    (functions.config() as any)?.liveleague?.prepare_window_minutes ||
    10,
);
const LEAGUE_KICKOFF_WINDOW_MINUTES = Number(
  process.env.LEAGUE_KICKOFF_WINDOW_MINUTES ||
    (functions.config() as any)?.liveleague?.kickoff_window_minutes ||
    10,
);
const LEAGUE_RUNNING_TIMEOUT_MINUTES = Number(
  process.env.LEAGUE_RUNNING_TIMEOUT_MINUTES ||
    (functions.config() as any)?.liveleague?.running_timeout_minutes ||
    120,
);
const LEAGUE_SLOT_RECOVERY_LOOKBACK_MINUTES = Number(
  process.env.LEAGUE_SLOT_RECOVERY_LOOKBACK_MINUTES ||
    (functions.config() as any)?.liveleague?.slot_recovery_lookback_minutes ||
    90,
);
const LEAGUE_FAILED_RESCHEDULE_ENABLED =
  String(
    process.env.LEAGUE_FAILED_RESCHEDULE_ENABLED ||
      (functions.config() as any)?.liveleague?.failed_reschedule_enabled ||
      'true',
  ).trim().toLowerCase() !== 'false';
const LEAGUE_FAILED_RESCHEDULE_MAX_ATTEMPTS = Number(
  process.env.LEAGUE_FAILED_RESCHEDULE_MAX_ATTEMPTS ||
    (functions.config() as any)?.liveleague?.failed_reschedule_max_attempts ||
    2,
);
const LEAGUE_FAILED_RESCHEDULE_MIN_DELAY_MINUTES = Number(
  process.env.LEAGUE_FAILED_RESCHEDULE_MIN_DELAY_MINUTES ||
    (functions.config() as any)?.liveleague?.failed_reschedule_min_delay_minutes ||
    5,
);

const AUTO_RESCHEDULE_REASON_TOKENS = [
  'running_timeout',
  'status_poll_timeout',
  'kickoff_retry_exhausted',
  'prepare_failed',
  'kickoff_failed',
  'match_start_timeout',
  'match_start_failed',
  'no_free_slot',
  'allocation_failed',
  'timeout',
];

function resolveLifecycleSecrets(): string[] {
  const candidates = [
    LIFECYCLE_SECRET,
    process.env.MATCH_CONTROL_LIFECYCLE_TOKEN || '',
    MATCH_CONTROL_SECRET,
    ADMIN_SECRET,
  ];
  return Array.from(new Set(candidates.map((item) => String(item || '').trim()).filter(Boolean)));
}

type TeamPayload = UnityRuntimeTeamPayload;

type TeamBundle = {
  teamId: string;
  ownerUid: string | null;
  payload: TeamPayload;
  raw: any;
};

type MediaBundle = {
  replayPath: string;
  replayUploadUrl: string;
  resultPath: string;
  resultUploadUrl: string;
  videoPath: string;
  videoUploadUrl: string;
};

type MatchControlStatus = {
  matchId: string;
  state: string;
  serverIp?: string;
  serverPort?: number;
  updatedAt?: string;
};

type MatchControlInternalMatch = {
  id: string;
  mode: string;
  status: string;
  leagueId?: string | null;
  fixtureId?: string | null;
  seasonId?: string | null;
  endedReason?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  resultPayload?: Record<string, any> | null;
  endedAt?: string | null;
  replayStatus?: string;
  replayStoragePath?: string | null;
  videoStatus?: string;
  videoStoragePath?: string | null;
  videoWatchUrl?: string | null;
  updatedAt?: string | null;
};

type ManualCatchupMode = 'prepare' | 'kickoff' | 'full';
type KickoffResolveOptions = {
  allForDay?: boolean;
  kickoffHour?: number | null;
};

function parseKickoffHours(raw: unknown) {
  const input = String(raw || '').trim();
  const values = input
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);

  const uniqueSorted = Array.from(new Set(values)).sort((a, b) => a - b);
  return uniqueSorted.length > 0 ? uniqueSorted : [19];
}

function parseOptionalKickoffHour(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const hour = Number(String(raw).trim());
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('kickoffHour must be 0..23');
  }
  return hour;
}

function parseLifecycleMinute(raw: unknown): number | null {
  if (raw == null || raw === '') {
    return null;
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const minute = Math.trunc(raw);
    return minute >= 0 && minute <= 240 ? minute : null;
  }

  const text = String(raw).trim();
  if (!text) {
    return null;
  }

  const plusMatch = text.match(/^(\d{1,3})\s*\+\s*(\d{1,2})$/);
  if (plusMatch) {
    const base = Number(plusMatch[1]);
    const extra = Number(plusMatch[2]);
    if (
      Number.isInteger(base) &&
      Number.isInteger(extra) &&
      base >= 0 &&
      base <= 240 &&
      extra >= 0 &&
      extra <= 30
    ) {
      return Math.min(240, base + extra);
    }
    return null;
  }

  const normalized = text.replace(',', '.');
  const decimalMatch = normalized.match(/^(\d{1,3})(?:\.\d+)?$/);
  if (!decimalMatch) {
    return null;
  }

  const minute = Number(decimalMatch[1]);
  return Number.isInteger(minute) && minute >= 0 && minute <= 240 ? minute : null;
}

function normalizeObjectPayload(raw: unknown): Record<string, any> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  return raw as Record<string, any>;
}

function parseScoreNumber(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : null;
}

function extractInlineScore(body: Record<string, unknown>, resultPayload: Record<string, any> | null) {
  const bodyScore = normalizeObjectPayload((body as any).score);
  const resultScore = normalizeObjectPayload(resultPayload?.score);
  const nestedResult = normalizeObjectPayload(resultPayload?.result);

  const home =
    parseScoreNumber((body as any).homeScore) ??
    parseScoreNumber((body as any).homeGoals) ??
    parseScoreNumber(bodyScore?.home) ??
    parseScoreNumber(bodyScore?.h) ??
    parseScoreNumber(resultPayload?.homeGoals) ??
    parseScoreNumber(resultScore?.home) ??
    parseScoreNumber(resultScore?.h) ??
    parseScoreNumber(nestedResult?.homeGoals);

  const away =
    parseScoreNumber((body as any).awayScore) ??
    parseScoreNumber((body as any).awayGoals) ??
    parseScoreNumber(bodyScore?.away) ??
    parseScoreNumber(bodyScore?.a) ??
    parseScoreNumber(resultPayload?.awayGoals) ??
    parseScoreNumber(resultScore?.away) ??
    parseScoreNumber(resultScore?.a) ??
    parseScoreNumber(nestedResult?.awayGoals);

  if (home == null || away == null) {
    return null;
  }

  return { home, away };
}

function requireMatchControlConfig() {
  if (!MATCH_CONTROL_BASE_URL || !MATCH_CONTROL_SECRET) {
    throw new Error('MATCH_CONTROL_BASE_URL / MATCH_CONTROL_SECRET missing');
  }
}

function readRequestBody(req: functions.https.Request) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return (req.body || {}) as Record<string, unknown>;
}

function readAdminSecret(req: functions.https.Request) {
  const authz = (req.headers.authorization as string) || '';
  const bearer = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  const headerSecret = (req.headers['x-admin-secret'] as string) || '';
  return bearer || headerSecret;
}

function requireAdminSecret(req: functions.https.Request, res: functions.Response<any>) {
  const providedSecret = readAdminSecret(req);
  if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
    res.status(401).json({ ok: false, error: 'Invalid admin secret' });
    return false;
  }
  return true;
}

function parseCatchupDate(raw: unknown) {
  const day = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error('date must be YYYY-MM-DD');
  }
  const baseDate = new Date(`${day}T12:00:00+03:00`);
  if (Number.isNaN(baseDate.getTime())) {
    throw new Error('invalid date');
  }
  if (formatInTimeZone(baseDate, TZ, 'yyyy-MM-dd') !== day) {
    throw new Error('date must be a valid Europe/Istanbul day');
  }
  return { day, baseDate };
}

function parseCatchupMode(raw: unknown): ManualCatchupMode {
  const value = String(raw || 'full').trim().toLowerCase();
  if (value === 'prepare' || value === 'kickoff' || value === 'full') {
    return value;
  }
  throw new Error('mode must be one of prepare, kickoff, full');
}

function applyCors(req: functions.https.Request, res: functions.Response<any>) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-admin-secret');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

async function runLeagueCatchupForDateInternal(day: string, baseDate: Date, mode: ManualCatchupMode) {
  const allKickoffsForDay: KickoffResolveOptions = { allForDay: true };
  if (mode === 'prepare') {
    const prepare = await prepareLeagueKickoffWindowInternal(baseDate, allKickoffsForDay);
    return { ok: true, day, mode, prepare };
  }
  if (mode === 'kickoff') {
    const kickoff = await kickoffPreparedLeagueMatchesInternal(baseDate, allKickoffsForDay);
    return { ok: true, day, mode, kickoff };
  }
  const prepare = await prepareLeagueKickoffWindowInternal(baseDate, allKickoffsForDay);
  const kickoff = await kickoffPreparedLeagueMatchesInternal(baseDate, allKickoffsForDay);
  return { ok: true, day, mode, prepare, kickoff };
}

function buildMatchControlUrl(path: string) {
  const base = MATCH_CONTROL_BASE_URL.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

async function callMatchControlJson<T>(path: string, init: RequestInit): Promise<T> {
  requireMatchControlConfig();
  const response = await fetch(buildMatchControlUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MATCH_CONTROL_SECRET}`,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`match-control ${path} failed (${response.status}): ${text || '<empty>'}`);
  }
  return (await response.json()) as T;
}

function buildRequestToken(matchId: string, seasonId: string) {
  if (!BATCH_SECRET) {
    throw new Error('unity.batch_secret missing (set functions config or BATCH_SECRET env)');
  }
  const issuedAtMs = Date.now();
  const payload = `${matchId}:${seasonId}:${issuedAtMs}`;
  const sig = createHmac('sha256', BATCH_SECRET).update(payload).digest('hex');
  return `${issuedAtMs}.${sig}`;
}

function isManualReplayFixture(fixture: any): boolean {
  const reason = String(fixture?.live?.reason || '').trim();
  return reason === 'manual_backlog_replay' || !!fixture?.live?.manualReplayQueuedAt || !!fixture?.live?.manualReplaySlotIso;
}

function buildManualReplayMatchId(fixtureId: string, fixture: any): string {
  const existing = String(fixture?.live?.manualReplayMatchId || '').trim();
  if (existing) return existing;
  const queuedAtMs =
    fixture?.live?.manualReplayQueuedAt?.toMillis?.() ||
    Date.now();
  return `lgr_${fixtureId}_${Number(queuedAtMs).toString(36)}`;
}

async function buildTeamPayload(teamId: string, ownerUid: string | null, data: any): Promise<TeamPayload> {
  const baseData = data && typeof data === 'object' ? { ...data } : {};
  if (ownerUid) {
    const inventorySnap = await db.doc(`users/${ownerUid}/inventory/consumables`).get();
    if (inventorySnap.exists) {
      const inventoryData = inventorySnap.data() as Record<string, unknown>;
      const kits =
        inventoryData?.kits && typeof inventoryData.kits === 'object'
          ? (inventoryData.kits as Record<string, unknown>)
          : {};
      baseData.consumables = {
        energy: Number(kits.energy ?? 0) || 0,
        morale: Number(kits.morale ?? 0) || 0,
        health: Number(kits.health ?? 0) || 0,
      };
    }
  }

  return buildUnityRuntimeTeamPayload(teamId, baseData);
}

function normalizeTeamId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function isSlotTeamId(teamId: string) {
  return teamId.startsWith('slot-');
}

async function resolveSlotTeamId(leagueId: string, slotValue: unknown): Promise<string | null> {
  const slot = Number(slotValue);
  if (!Number.isFinite(slot) || slot <= 0) return null;
  const slotSnap = await db.doc(`leagues/${leagueId}/slots/${slot}`).get();
  if (!slotSnap.exists) return null;
  const slotData = slotSnap.data() as any;
  let teamId = normalizeTeamId(slotData?.teamId);
  if (!teamId && slotData?.botId) {
    teamId = await ensureBotTeamDoc({
      botId: String(slotData.botId),
      slotIndex: slot,
      name: slotData?.name,
    });
  }
  return teamId;
}

async function resolveFixtureTeams(leagueId: string, fixture: any) {
  let homeTeamId = normalizeTeamId(fixture.homeTeamId);
  let awayTeamId = normalizeTeamId(fixture.awayTeamId);

  if (homeTeamId && isSlotTeamId(homeTeamId)) {
    homeTeamId = await resolveSlotTeamId(leagueId, homeTeamId.replace('slot-', ''));
  }
  if (awayTeamId && isSlotTeamId(awayTeamId)) {
    awayTeamId = await resolveSlotTeamId(leagueId, awayTeamId.replace('slot-', ''));
  }
  if (!homeTeamId) {
    homeTeamId = await resolveSlotTeamId(leagueId, fixture.homeSlot);
  }
  if (!awayTeamId) {
    awayTeamId = await resolveSlotTeamId(leagueId, fixture.awaySlot);
  }

  return { homeTeamId, awayTeamId };
}

async function loadTeamBundle(teamId: string): Promise<TeamBundle | null> {
  const teamSnap = await db.doc(`teams/${teamId}`).get();
  if (!teamSnap.exists) return null;
  const raw = teamSnap.data() as any;
  const ownerUid = typeof raw?.ownerUid === 'string' && raw.ownerUid.trim() ? raw.ownerUid : null;
  return {
    teamId,
    ownerUid,
    payload: await buildTeamPayload(teamId, ownerUid, raw),
    raw,
  };
}

async function ensureMatchPlanSnapshot(matchId: string, leagueId: string, seasonId: string, fixture: any, home: TeamBundle, away: TeamBundle) {
  const planRef = db.doc(`matchPlans/${matchId}`);
  const existing = await planRef.get();
  if (existing.exists) return;

  await planRef.create({
    matchId,
    leagueId,
    seasonId,
    createdAt: FieldValue.serverTimestamp(),
    rngSeed: fixture.seed || Math.floor(Math.random() * 1e9),
    kickoffUtc: fixture.date,
    home: {
      teamId: home.teamId,
      clubName: home.raw?.clubName || home.raw?.name || home.teamId,
      formation: typeof home.raw?.lineup?.formation === 'string' ? home.raw.lineup.formation : null,
      tactics: home.raw?.lineup?.tactics || {},
      starters: home.raw?.lineup?.starters || [],
      subs: home.raw?.lineup?.subs || [],
    },
    away: {
      teamId: away.teamId,
      clubName: away.raw?.clubName || away.raw?.name || away.teamId,
      formation: typeof away.raw?.lineup?.formation === 'string' ? away.raw.lineup.formation : null,
      tactics: away.raw?.lineup?.tactics || {},
      starters: away.raw?.lineup?.starters || [],
      subs: away.raw?.lineup?.subs || [],
    },
  });
}

async function getSignedWriteUrl(path: string, contentType: string) {
  const [url] = await bucket.file(path).getSignedUrl({
    action: 'write',
    expires: Date.now() + 3 * 60 * 60 * 1000,
    contentType,
  });
  return url;
}

async function createMediaBundle(leagueId: string, seasonId: string, matchId: string): Promise<MediaBundle> {
  const replayPath = `replays/${seasonId}/${leagueId}/${matchId}.json`;
  const resultPath = `results/${seasonId}/${leagueId}/${matchId}.json`;
  const videoPath = `videos/${seasonId}/${matchId}.mp4`;
  const [replayUploadUrl, resultUploadUrl, videoUploadUrl] = await Promise.all([
    getSignedWriteUrl(replayPath, 'application/json; charset=utf-8'),
    getSignedWriteUrl(resultPath, 'application/json; charset=utf-8'),
    getSignedWriteUrl(videoPath, 'video/mp4'),
  ]);
  return {
    replayPath,
    replayUploadUrl,
    resultPath,
    resultUploadUrl,
    videoPath,
    videoUploadUrl,
  };
}

async function getInternalMatchDetails(matchId: string): Promise<MatchControlInternalMatch | null> {
  const response = await callMatchControlJson<{ match?: MatchControlInternalMatch }>(
    `/v1/internal/matches/${encodeURIComponent(matchId)}`,
    { method: 'GET' },
  );
  return response?.match ?? null;
}

async function storageFileExists(storagePath: string | null | undefined) {
  if (!storagePath) return false;
  const [exists] = await bucket.file(storagePath).exists();
  return exists;
}

function deriveSeasonId(fixture: any, match?: MatchControlInternalMatch | null) {
  return String(
    fixture?.seasonId ??
    fixture?.season ??
    match?.seasonId ??
    'default',
  );
}

function deriveReplayPath(leagueId: string, seasonId: string, matchId: string, match?: MatchControlInternalMatch | null, fixture?: any) {
  return String(
    match?.replayStoragePath ||
    fixture?.replayPath ||
    `replays/${seasonId}/${leagueId}/${matchId}.json`,
  );
}

function deriveVideoPath(seasonId: string, matchId: string, match?: MatchControlInternalMatch | null, fixture?: any) {
  return String(
    match?.videoStoragePath ||
    fixture?.video?.storagePath ||
    `videos/${seasonId}/${matchId}.mp4`,
  );
}

function normalizeScore(match?: MatchControlInternalMatch | null) {
  const result = match?.resultPayload || {};
  const direct = result?.score || result?.result || null;
  if (typeof direct?.home === 'number' && typeof direct?.away === 'number') {
    return { home: direct.home, away: direct.away };
  }
  if (typeof direct?.h === 'number' && typeof direct?.a === 'number') {
    return { home: direct.h, away: direct.a };
  }
  if (typeof match?.homeScore === 'number' && typeof match?.awayScore === 'number') {
    return { home: match.homeScore, away: match.awayScore };
  }
  if (typeof result?.homeGoals === 'number' && typeof result?.awayGoals === 'number') {
    return { home: result.homeGoals, away: result.awayGoals };
  }
  return null;
}

async function writeSyntheticResult(
  leagueId: string,
  fixtureId: string,
  fixture: any,
  match: MatchControlInternalMatch,
) {
  const seasonId = deriveSeasonId(fixture, match);
  const score = normalizeScore(match);
  if (!score) {
    return false;
  }

  const resultPath = `results/${seasonId}/${leagueId}/${fixtureId}.json`;
  const alreadyExists = await storageFileExists(resultPath);
  if (alreadyExists) {
    return false;
  }

  const replayPath = deriveReplayPath(leagueId, seasonId, fixtureId, match, fixture);
  const payload = {
    requestToken: buildRequestToken(fixtureId, seasonId),
    score,
    replay: { path: replayPath },
    source: 'match-control-backfill',
    extra: {
      source: 'match-control-backfill',
      endedReason: match.endedReason || null,
      recoveredAt: new Date().toISOString(),
    },
  };

  await bucket.file(resultPath).save(JSON.stringify(payload), {
    contentType: 'application/json; charset=utf-8',
  });
  return true;
}

async function backfillLiveLeagueMediaInternal(now = new Date()) {
  const day = dayKeyTR(now);
  const fixtures = await loadFixturesForReconcile(now);
  let checked = 0;
  let replaySynced = 0;
  let videoHealed = 0;
  let resultRecovered = 0;
  let renderQueued = 0;
  let failed = 0;

  for (const entry of fixtures) {
    const fixture = entry.fixture;
    const live = fixture?.live || {};
    const matchId = String(live.matchId || '').trim();
    if (!matchId) continue;
    checked += 1;

    try {
      const match = await getInternalMatchDetails(matchId);
      if (!match) continue;

      const seasonId = deriveSeasonId(fixture, match);
      const replayPath = deriveReplayPath(entry.leagueId, seasonId, entry.doc.id, match, fixture);
      const videoPath = deriveVideoPath(seasonId, entry.doc.id, match, fixture);
      const patch: Record<string, unknown> = {};

      if (!fixture?.replayPath && match?.replayStoragePath) {
        patch.replayPath = replayPath;
      }

      if (match?.videoStoragePath && (await storageFileExists(videoPath))) {
        patch.videoMissing = false;
        patch.videoError = FieldValue.delete();
        patch['video.storagePath'] = videoPath;
        patch['video.type'] = 'mp4-v1';
        patch['video.source'] = fixture?.video?.source || 'live';
        patch['video.uploaded'] = true;
        patch['video.updatedAt'] = FieldValue.serverTimestamp();
      }

      if (Object.keys(patch).length > 0) {
        await entry.doc.ref.update(patch);
        if (patch.replayPath) replaySynced += 1;
        if (patch['video.uploaded']) videoHealed += 1;
      }

      const endedAtMs = live?.endedAt?.toDate?.()?.getTime?.() || 0;
      const endedLongEnoughAgo = endedAtMs > 0 && now.getTime() - endedAtMs > 10 * 60 * 1000;

      if (
        endedLongEnoughAgo &&
        match.status === 'ended' &&
        String(fixture.status || '').toLowerCase() !== 'played'
      ) {
        const recovered = await writeSyntheticResult(entry.leagueId, entry.doc.id, fixture, match);
        if (recovered) {
          resultRecovered += 1;
          continue;
        }
      }

      const shouldQueueRenderFallback =
        String(fixture.status || '').toLowerCase() === 'played' &&
        fixture.videoMissing === true &&
        endedLongEnoughAgo &&
        !fixture?.video?.renderQueuedAt &&
        (
          fixture.videoError === 'upload_timeout' ||
          String(match.videoStatus || '').toLowerCase() === 'failed' ||
          !(await storageFileExists(videoPath))
        );

      if (shouldQueueRenderFallback && (await storageFileExists(replayPath))) {
        await enqueueRenderJob({
          matchId: entry.doc.id,
          leagueId: entry.leagueId,
          seasonId,
          replayPath,
          videoPath,
        });
        await entry.doc.ref.update({
          videoMissing: true,
          videoError: FieldValue.delete(),
          'video.storagePath': videoPath,
          'video.type': 'mp4-v1',
          'video.source': 'render-fallback',
          'video.uploaded': false,
          'video.updatedAt': FieldValue.serverTimestamp(),
          'video.renderQueuedAt': FieldValue.serverTimestamp(),
        });
        renderQueued += 1;
      }
    } catch (error: any) {
      failed += 1;
      functions.logger.warn('[backfillLiveLeagueMedia] item failed', {
        fixtureId: entry.doc.id,
        leagueId: entry.leagueId,
        matchId,
        error: error?.message || String(error),
      });
    }
  }

  await updateHeartbeat(day, {
    leagueMediaBackfillOk: failed === 0,
    leagueMediaBackfillChecked: checked,
    leagueMediaBackfillReplaySynced: replaySynced,
    leagueMediaBackfillVideoHealed: videoHealed,
    leagueMediaBackfillResultRecovered: resultRecovered,
    leagueMediaBackfillRenderQueued: renderQueued,
    leagueMediaBackfillFailed: failed,
  });

  return { day, checked, replaySynced, videoHealed, resultRecovered, renderQueued, failed };
}

async function loadExactKickoffFixtures(targetTs: Timestamp) {
  try {
    const snap = await db
      .collectionGroup('fixtures')
      .where('status', '==', 'scheduled')
      .where('date', '==', targetTs)
      .get();
    return snap.docs;
  } catch {
    const leagues = await db.collection('leagues').get();
    const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    for (const league of leagues.docs) {
      const fixtures = await league.ref.collection('fixtures').where('date', '==', targetTs).get();
      docs.push(...fixtures.docs.filter((doc) => (doc.data() as any)?.status === 'scheduled'));
    }
    return docs;
  }
}

async function loadFixturesByExactKickoffTargets(targetKickoffs: Date[]) {
  const dedupe = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const kickoffAt of targetKickoffs) {
    const targetTs = Timestamp.fromDate(kickoffAt);
    const docs = await loadExactKickoffFixtures(targetTs);
    for (const doc of docs) {
      dedupe.set(doc.ref.path, doc);
    }
  }
  return Array.from(dedupe.values());
}

async function updateHeartbeat(day: string, patch: Record<string, unknown>) {
  await db.doc(`ops_heartbeats/${day}`).set({
    lastUpdated: FieldValue.serverTimestamp(),
    ...patch,
  }, { merge: true });
}

function liveStatePatch(state: string, extra: Record<string, unknown> = {}) {
  return {
    'live.state': state,
    'live.lastLifecycleAt': FieldValue.serverTimestamp(),
    ...extra,
  };
}

function mapLifecycleToFixtureStatus(state: string, currentStatus: string) {
  switch (state) {
    case 'warm':
    case 'starting':
      return currentStatus === 'played' ? currentStatus : 'scheduled';
    case 'server_started':
    case 'running':
      return currentStatus === 'played' ? currentStatus : 'running';
    case 'ended':
      return 'played';
    case 'failed':
      return currentStatus === 'played' ? currentStatus : 'failed';
    default:
      return currentStatus;
  }
}

function isTerminalLiveState(value: unknown) {
  const state = String(value || '').trim().toLowerCase();
  return state === 'ended' || state === 'failed';
}

function kickoffDateAtHour(baseDate: Date, hour: number) {
  return trAt(baseDate, hour, 0);
}

function resolvePrepareKickoffTargets(baseDate = new Date(), options: KickoffResolveOptions = {}) {
  const hours =
    typeof options.kickoffHour === 'number'
      ? [options.kickoffHour]
      : LEAGUE_KICKOFF_HOURS_TR;

  // Manual single-hour runs should not depend on "now" prewarm window.
  if (options.allForDay || typeof options.kickoffHour === 'number') {
    return hours.map((hour) => kickoffDateAtHour(baseDate, hour));
  }

  const prewarmLeadMin = Math.max(1, Number(LEAGUE_PREWARM_LEAD_MINUTES || 15));
  const prepareWindowMin = Math.max(1, Number(LEAGUE_PREPARE_WINDOW_MINUTES || 10));
  const nowMs = baseDate.getTime();

  return hours
    .map((hour) => kickoffDateAtHour(baseDate, hour))
    .filter((kickoffAt) => {
      const deltaMin = (kickoffAt.getTime() - nowMs) / 60_000;
      return deltaMin <= prewarmLeadMin && deltaMin >= prewarmLeadMin - prepareWindowMin;
    });
}

function resolveKickoffTargets(baseDate = new Date(), options: KickoffResolveOptions = {}) {
  const hours =
    typeof options.kickoffHour === 'number'
      ? [options.kickoffHour]
      : LEAGUE_KICKOFF_HOURS_TR;

  // Manual single-hour runs should not depend on "now" kickoff window.
  if (options.allForDay || typeof options.kickoffHour === 'number') {
    return hours.map((hour) => kickoffDateAtHour(baseDate, hour));
  }

  const kickoffWindowMin = Math.max(1, Number(LEAGUE_KICKOFF_WINDOW_MINUTES || 10));
  const nowMs = baseDate.getTime();

  return hours
    .map((hour) => kickoffDateAtHour(baseDate, hour))
    .filter((kickoffAt) => {
      const deltaMin = (kickoffAt.getTime() - nowMs) / 60_000;
      return deltaMin >= -kickoffWindowMin && deltaMin <= kickoffWindowMin;
    });
}

async function prepareLeagueKickoffWindowInternal(baseDate = new Date(), options: KickoffResolveOptions = {}) {
  const day = dayKeyTR(baseDate);
  const kickoffTargets = resolvePrepareKickoffTargets(baseDate, options);
  const docs = await loadFixturesByExactKickoffTargets(kickoffTargets);

  let prepared = 0;
  let reused = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of docs) {
    const fixture = doc.data() as any;
    const leagueId = doc.ref.parent.parent?.id;
    if (!leagueId) {
      skipped += 1;
      continue;
    }

    if (fixture?.live?.matchId && !isTerminalLiveState(fixture?.live?.state)) {
      reused += 1;
      continue;
    }

    const fixtureId = doc.id;
    const manualReplay = isManualReplayFixture(fixture);
    const matchId = manualReplay ? buildManualReplayMatchId(fixtureId, fixture) : fixtureId;
    const storageMatchId = fixtureId;
    try {
      const seasonId = String(fixture.seasonId ?? fixture.season ?? 'default');
      const { homeTeamId, awayTeamId } = await resolveFixtureTeams(leagueId, fixture);
      if (!homeTeamId || !awayTeamId) {
        skipped += 1;
        await doc.ref.update({
          ...liveStatePatch('prepare_failed', {
            'live.reason': 'missing_team_ids',
          }),
        });
        continue;
      }

      const [home, away] = await Promise.all([
        loadTeamBundle(homeTeamId),
        loadTeamBundle(awayTeamId),
      ]);
      if (!home || !away) {
        skipped += 1;
        await doc.ref.update({
          ...liveStatePatch('prepare_failed', {
            'live.reason': 'missing_team_docs',
          }),
        });
        continue;
      }

      await ensureMatchPlanSnapshot(matchId, leagueId, seasonId, fixture, home, away);
      const media = await createMediaBundle(leagueId, seasonId, storageMatchId);
      const requestToken = buildRequestToken(storageMatchId, seasonId);
      const kickoffAt = fixture?.date?.toDate?.() as Date | undefined;
      const kickoffAtIso = kickoffAt ? kickoffAt.toISOString() : null;

      const response = await callMatchControlJson<{
        matchId: string;
        state: string;
        nodeId?: string;
        allocatedNodeId?: string;
        serverIp?: string;
        serverPort?: number;
        reused?: boolean;
      }>('/v1/league/prepare-slot', {
        method: 'POST',
        body: JSON.stringify({
          matchId,
          forceNewMatch: manualReplay,
          leagueId,
          fixtureId,
          seasonId,
          homeTeamId,
          awayTeamId,
          homeUserId: home.ownerUid,
          awayUserId: away.ownerUid,
          kickoffAt: kickoffAtIso,
          homeTeamPayload: home.payload,
          awayTeamPayload: away.payload,
          resultUploadUrl: media.resultUploadUrl,
          replayUploadUrl: media.replayUploadUrl,
          videoUploadUrl: media.videoUploadUrl,
          requestToken,
        }),
      });

      await doc.ref.set({
        live: {
          matchId: response.matchId || matchId,
          manualReplayMatchId: manualReplay ? (response.matchId || matchId) : FieldValue.delete(),
          nodeId: response.nodeId || response.allocatedNodeId || null,
          serverIp: response.serverIp || null,
          serverPort: Number.isFinite(response.serverPort) ? Number(response.serverPort) : null,
          state: response.state || 'warm',
          prewarmedAt: FieldValue.serverTimestamp(),
          lastLifecycleAt: FieldValue.serverTimestamp(),
          homeUserId: home.ownerUid,
          awayUserId: away.ownerUid,
          retryCount: fixture?.live?.retryCount || 0,
        },
        videoMissing: true,
        videoError: FieldValue.delete(),
        video: {
          storagePath: media.videoPath,
          type: 'mp4-v1',
          source: 'live',
          uploaded: false,
          updatedAt: FieldValue.serverTimestamp(),
        },
      }, { merge: true });

      if (response.reused) reused += 1;
      else prepared += 1;
    } catch (error: any) {
      failed += 1;
      functions.logger.error('[prepareLeagueKickoffWindow] fixture failed', {
        leagueId,
        fixtureId: doc.id,
        error: error?.message || String(error),
      });
      await doc.ref.update({
        ...liveStatePatch('prepare_failed', {
          'live.reason': error?.message || 'prepare_failed',
        }),
      });
    }
  }

  await updateHeartbeat(day, {
    leaguePrepareOk: failed === 0,
    leaguePrepareTargets: kickoffTargets.map((date) => date.toISOString()),
    leaguePreparePrepared: prepared,
    leaguePrepareReused: reused,
    leaguePrepareSkipped: skipped,
    leaguePrepareFailed: failed,
  });

  return { day, prepared, reused, skipped, failed, total: docs.length, targets: kickoffTargets.map((date) => date.toISOString()) };
}

async function kickoffPreparedLeagueMatchesInternal(baseDate = new Date(), options: KickoffResolveOptions = {}) {
  const day = dayKeyTR(baseDate);
  const kickoffTargets = resolveKickoffTargets(baseDate, options);
  const docs = await loadFixturesByExactKickoffTargets(kickoffTargets);

  let started = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of docs) {
    const fixture = doc.data() as any;
    const live = fixture?.live || {};
    if (!live?.matchId) {
      skipped += 1;
      continue;
    }
    if (String(fixture?.status || '').toLowerCase() === 'played') {
      skipped += 1;
      continue;
    }

    try {
      const response = await callMatchControlJson<{
        matchId: string;
        state: string;
        nodeId?: string;
        serverIp?: string;
        serverPort?: number;
      }>('/v1/league/kickoff-slot', {
        method: 'POST',
        body: JSON.stringify({ matchId: live.matchId }),
      });

      await doc.ref.set({
        live: {
          ...live,
          state: response.state || 'starting',
          nodeId: response.nodeId || live.nodeId || null,
          serverIp: response.serverIp || live.serverIp || null,
          serverPort: Number.isFinite(response.serverPort) ? Number(response.serverPort) : live.serverPort ?? null,
          kickoffAttemptedAt: FieldValue.serverTimestamp(),
          lastLifecycleAt: FieldValue.serverTimestamp(),
        },
      }, { merge: true });
      started += 1;
    } catch (error: any) {
      failed += 1;
      functions.logger.error('[kickoffPreparedLeagueMatches] fixture failed', {
        fixtureId: doc.id,
        error: error?.message || String(error),
      });
      await doc.ref.update({
        ...liveStatePatch('kickoff_failed', {
          'live.reason': error?.message || 'kickoff_failed',
        }),
      });
    }
  }

  await updateHeartbeat(day, {
    leagueKickoffOk: failed === 0,
    leagueKickoffTargets: kickoffTargets.map((date) => date.toISOString()),
    leagueKickoffStarted: started,
    leagueKickoffSkipped: skipped,
    leagueKickoffFailed: failed,
  });

  return { day, started, skipped, failed, total: docs.length, targets: kickoffTargets.map((date) => date.toISOString()) };
}

async function loadFixturesForReconcile(now = new Date()) {
  const leagues = await db.collection('leagues').where('state', 'in', ['scheduled', 'active']).get();
  const minDate = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const maxDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const fixtures: Array<{ doc: FirebaseFirestore.QueryDocumentSnapshot; leagueId: string; fixture: any }> = [];

  for (const league of leagues.docs) {
    const snap = await league.ref
      .collection('fixtures')
      .where('date', '>=', Timestamp.fromDate(minDate))
      .where('date', '<=', Timestamp.fromDate(maxDate))
      .get();
    for (const doc of snap.docs) {
      const fixture = doc.data() as any;
      if (!fixture?.live?.matchId) continue;
      fixtures.push({ doc, leagueId: league.id, fixture });
    }
  }

  return fixtures;
}

async function reconcileLeagueLiveMatchesInternal(now = new Date()) {
  const fixtures = await loadFixturesForReconcile(now);
  const day = dayKeyTR(now);
  let checked = 0;
  let updated = 0;
  let failed = 0;
  const runningTimeoutMinutes = Math.max(10, Number(LEAGUE_RUNNING_TIMEOUT_MINUTES || 120));

  for (const entry of fixtures) {
    const fixture = entry.fixture;
    const live = fixture?.live || {};
    const matchId = String(live.matchId || '').trim();
    if (!matchId) continue;
    checked += 1;

    try {
      const status = await callMatchControlJson<MatchControlStatus>(`/v1/matches/${encodeURIComponent(matchId)}/status`, {
        method: 'GET',
      });
      const effectiveState = String(status.state || '').trim() || String(live.state || '').trim();
      const fixtureStatus = String(fixture.status || 'scheduled').trim().toLowerCase();
      const patch: Record<string, unknown> = {
        'live.state': effectiveState,
        'live.nodeId': live.nodeId || null,
        'live.serverIp': status.serverIp || live.serverIp || null,
        'live.serverPort': Number.isFinite(status.serverPort) ? Number(status.serverPort) : live.serverPort ?? null,
        'live.lastLifecycleAt': FieldValue.serverTimestamp(),
      };

      // Storage/result finalize can mark fixture played while live state remains stale.
      if (fixtureStatus === 'played' && effectiveState !== 'ended') {
        patch['live.state'] = 'ended';
        patch['live.endedAt'] = live?.endedAt || FieldValue.serverTimestamp();
        patch['live.resultMissing'] = false;
        patch['live.reason'] = FieldValue.delete();
      }

      if ((effectiveState === 'server_started' || effectiveState === 'running') && !live.startedAt) {
        patch['live.startedAt'] = FieldValue.serverTimestamp();
      }
      if (effectiveState === 'ended') {
        patch['live.endedAt'] = FieldValue.serverTimestamp();
        patch['live.resultMissing'] = fixture.status !== 'played';
      }

      const nextStatus = mapLifecycleToFixtureStatus(effectiveState, fixtureStatus);
      if (nextStatus !== fixture.status) {
        patch.status = nextStatus;
      }

      const kickoffDate = fixture?.date?.toDate?.() as Date | undefined;
      const overdueWarm =
        effectiveState === 'warm' &&
        kickoffDate &&
        now.getTime() - kickoffDate.getTime() > 2 * 60 * 1000;
      if (overdueWarm) {
        const retryCount = Number(live.retryCount || 0);
        if (retryCount < 3) {
          await callMatchControlJson(`/v1/league/kickoff-slot`, {
            method: 'POST',
            body: JSON.stringify({ matchId }),
          });
          patch['live.retryCount'] = retryCount + 1;
          patch['live.kickoffAttemptedAt'] = FieldValue.serverTimestamp();
        } else {
          patch['live.state'] = 'failed';
          patch['live.reason'] = 'kickoff_retry_exhausted';
          patch.status = fixture.status === 'played' ? fixture.status : 'failed';
        }
      }

      const staleRunning =
        (effectiveState === 'running' || effectiveState === 'server_started') &&
        kickoffDate &&
        now.getTime() - kickoffDate.getTime() > runningTimeoutMinutes * 60 * 1000 &&
        fixture.status !== 'played';
      if (staleRunning) {
        patch['live.state'] = 'failed';
        patch['live.reason'] = 'running_timeout';
        patch.status = 'failed';
      }

      const missingVideo =
        fixture.status === 'played' &&
        fixture.videoMissing === true &&
        live?.endedAt?.toDate?.() &&
        now.getTime() - live.endedAt.toDate().getTime() > 30 * 60 * 1000;
      if (missingVideo) {
        patch.videoError = 'upload_timeout';
      }

      await entry.doc.ref.update(patch);
      updated += 1;
    } catch (error: any) {
      failed += 1;
      functions.logger.warn('[reconcileLeagueLiveMatches] status sync failed', {
        fixtureId: entry.doc.id,
        matchId,
        error: error?.message || String(error),
      });

      const kickoffDate = fixture?.date?.toDate?.() as Date | undefined;
      const shouldFail =
        kickoffDate &&
        now.getTime() - kickoffDate.getTime() > runningTimeoutMinutes * 60 * 1000 &&
        fixture.status !== 'played';
      if (shouldFail) {
        await entry.doc.ref.update({
          ...liveStatePatch('failed', {
            'live.reason': 'status_poll_timeout',
          }),
          status: 'failed',
        });
      }
    }
  }

  await updateHeartbeat(day, {
    leagueReconcileOk: failed === 0,
    leagueReconcileChecked: checked,
    leagueReconcileUpdated: updated,
    leagueReconcileFailed: failed,
  });

  return { day, checked, updated, failed };
}

function resolveRecoveryKickoffHours(baseDate = new Date()) {
  const lookbackMinutes = Math.max(10, Number(LEAGUE_SLOT_RECOVERY_LOOKBACK_MINUTES || 90));
  const nowMs = baseDate.getTime();
  return LEAGUE_KICKOFF_HOURS_TR.filter((hour) => {
    const kickoffAt = kickoffDateAtHour(baseDate, hour);
    const elapsedMinutes = (nowMs - kickoffAt.getTime()) / 60_000;
    return elapsedMinutes >= 0 && elapsedMinutes <= lookbackMinutes;
  });
}

function isAutoReschedulableFailure(reason: string) {
  const normalized = String(reason || '').trim().toLowerCase();
  if (!normalized) return false;
  return AUTO_RESCHEDULE_REASON_TOKENS.some((token) => normalized.includes(token));
}

function resolveNextKickoffDate(now: Date, fixtureDate: Date) {
  const minDelayMinutes = Math.max(1, Number(LEAGUE_FAILED_RESCHEDULE_MIN_DELAY_MINUTES || 5));
  const earliestMs = Math.max(now.getTime() + minDelayMinutes * 60_000, fixtureDate.getTime() + 60_000);

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const dayProbe = new Date(earliestMs);
    dayProbe.setUTCDate(dayProbe.getUTCDate() + dayOffset);
    for (const hour of LEAGUE_KICKOFF_HOURS_TR) {
      const kickoffAt = kickoffDateAtHour(dayProbe, hour);
      if (kickoffAt.getTime() >= earliestMs) {
        return kickoffAt;
      }
    }
  }

  throw new Error('next_kickoff_slot_not_found');
}

async function autoRescheduleFailedLeagueFixturesInternal(now = new Date()) {
  if (!LEAGUE_FAILED_RESCHEDULE_ENABLED) {
    return { checked: 0, rescheduled: 0, skipped: 0, failed: 0 };
  }

  const fixtures = await loadFixturesForReconcile(now);
  let checked = 0;
  let rescheduled = 0;
  let skipped = 0;
  let failed = 0;
  const maxAttempts = Math.max(0, Number(LEAGUE_FAILED_RESCHEDULE_MAX_ATTEMPTS || 2));

  for (const entry of fixtures) {
    const fixture = entry.fixture || {};
    const live = fixture?.live || {};
    const status = String(fixture?.status || '').trim().toLowerCase();
    if (status !== 'failed') continue;
    checked += 1;

    const reason = String(live?.reason || '').trim().toLowerCase();
    if (!isAutoReschedulableFailure(reason)) {
      skipped += 1;
      continue;
    }

    const previousReschedules = Number(live?.rescheduleCount || 0);
    if (previousReschedules >= maxAttempts) {
      skipped += 1;
      continue;
    }

    try {
      const fixtureDate = fixture?.date?.toDate?.() instanceof Date ? fixture.date.toDate() : now;
      const nextKickoff = resolveNextKickoffDate(now, fixtureDate);
      const previousMatchId = String(live?.matchId || '').trim() || null;

      await entry.doc.ref.update({
        date: Timestamp.fromDate(nextKickoff),
        status: 'scheduled',
        score: FieldValue.delete(),
        replayPath: FieldValue.delete(),
        video: FieldValue.delete(),
        videoMissing: true,
        videoError: FieldValue.delete(),
        'live.state': 'rescheduled',
        'live.reason': `auto_rescheduled:${reason || 'failed'}`,
        'live.previousReason': reason || null,
        'live.previousMatchId': previousMatchId,
        'live.matchId': FieldValue.delete(),
        'live.nodeId': FieldValue.delete(),
        'live.serverIp': FieldValue.delete(),
        'live.serverPort': FieldValue.delete(),
        'live.prewarmedAt': FieldValue.delete(),
        'live.kickoffAttemptedAt': FieldValue.delete(),
        'live.startedAt': FieldValue.delete(),
        'live.endedAt': FieldValue.delete(),
        'live.lastLifecycleAt': FieldValue.serverTimestamp(),
        'live.homeUserId': FieldValue.delete(),
        'live.awayUserId': FieldValue.delete(),
        'live.retryCount': 0,
        'live.resultMissing': false,
        'live.minute': FieldValue.delete(),
        'live.minuteUpdatedAt': FieldValue.delete(),
        'live.resultPayload': FieldValue.delete(),
        'live.rescheduledAt': FieldValue.serverTimestamp(),
        'live.rescheduleCount': previousReschedules + 1,
      });
      const leagueId = entry.doc.ref.parent.parent?.id;
      if (leagueId) {
        try {
          await enqueueLeagueMatchReminder(leagueId, entry.doc.id, nextKickoff);
        } catch (error: any) {
          functions.logger.warn('[autoRescheduleFailedLeagueFixtures] reminder enqueue failed', {
            leagueId,
            fixtureId: entry.doc.id,
            error: error?.message || String(error),
          });
        }
      }
      rescheduled += 1;
    } catch (error: any) {
      failed += 1;
      functions.logger.warn('[autoRescheduleFailedLeagueFixtures] failed', {
        fixtureId: entry.doc.id,
        reason,
        error: error?.message || String(error),
      });
    }
  }

  return { checked, rescheduled, skipped, failed };
}

async function recoverLeagueKickoffSlotsInternal(baseDate = new Date()) {
  const day = dayKeyTR(baseDate);
  const kickoffHours = resolveRecoveryKickoffHours(baseDate);

  let prepared = 0;
  let started = 0;
  let failed = 0;
  const slotResults: Array<Record<string, unknown>> = [];

  for (const kickoffHour of kickoffHours) {
    try {
      const prepare = await prepareLeagueKickoffWindowInternal(baseDate, { kickoffHour });
      const kickoff = await kickoffPreparedLeagueMatchesInternal(baseDate, { kickoffHour });
      prepared += Number(prepare.prepared || 0);
      started += Number(kickoff.started || 0);
      failed += Number(prepare.failed || 0) + Number(kickoff.failed || 0);
      slotResults.push({ kickoffHour, prepare, kickoff });
    } catch (error: any) {
      failed += 1;
      slotResults.push({
        kickoffHour,
        error: error?.message || String(error),
      });
      functions.logger.warn('[recoverLeagueKickoffSlots] slot recovery failed', {
        day,
        kickoffHour,
        error: error?.message || String(error),
      });
    }
  }

  const reconcile = await reconcileLeagueLiveMatchesInternal(baseDate);
  failed += Number(reconcile.failed || 0);
  const autoReschedule = await autoRescheduleFailedLeagueFixturesInternal(baseDate);
  failed += Number(autoReschedule.failed || 0);

  await updateHeartbeat(day, {
    leagueSlotRecoveryOk: failed === 0,
    leagueSlotRecoverySlots: kickoffHours.length,
    leagueSlotRecoveryPrepared: prepared,
    leagueSlotRecoveryStarted: started,
    leagueSlotRecoveryFailed: failed,
    leagueAutoRescheduleChecked: autoReschedule.checked,
    leagueAutoRescheduleRescheduled: autoReschedule.rescheduled,
    leagueAutoRescheduleSkipped: autoReschedule.skipped,
    leagueAutoRescheduleFailed: autoReschedule.failed,
  });

  return {
    day,
    slots: kickoffHours.length,
    prepared,
    started,
    failed,
    reconcile,
    autoReschedule,
    slotResults,
  };
}

export const prepareLeagueKickoffWindow = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .pubsub.schedule('every 5 minutes')
  .timeZone(TZ)
  .onRun(async () => {
    const result = await prepareLeagueKickoffWindowInternal();
    functions.logger.info('[prepareLeagueKickoffWindow] done', result);
    return null;
  });

export const kickoffPreparedLeagueMatches = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .pubsub.schedule('every 5 minutes')
  .timeZone(TZ)
  .onRun(async () => {
    const result = await kickoffPreparedLeagueMatchesInternal();
    functions.logger.info('[kickoffPreparedLeagueMatches] done', result);
    return null;
  });

export const reconcileLeagueLiveMatches = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .pubsub.schedule('every 5 minutes')
  .timeZone(TZ)
  .onRun(async () => {
    const result = await reconcileLeagueLiveMatchesInternal();
    functions.logger.info('[reconcileLeagueLiveMatches] done', result);
    return null;
  });

export const recoverLeagueKickoffSlots = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .pubsub.schedule('every 5 minutes')
  .timeZone(TZ)
  .onRun(async () => {
    const result = await recoverLeagueKickoffSlotsInternal();
    functions.logger.info('[recoverLeagueKickoffSlots] done', result);
    return null;
  });

export const backfillLiveLeagueMedia = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .pubsub.schedule('every 15 minutes')
  .timeZone(TZ)
  .onRun(async () => {
    const result = await backfillLiveLeagueMediaInternal();
    functions.logger.info('[backfillLiveLeagueMedia] done', result);
    return null;
  });

export const prepareLeagueKickoffWindowHttp = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed' });
      return;
    }
    if (!requireAdminSecret(req, res)) return;

    try {
      const body = readRequestBody(req);
      const rawDate = body.date ?? req.query?.date;
      const rawKickoffHour = body.kickoffHour ?? req.query?.kickoffHour;
      const { day, baseDate } = parseCatchupDate(rawDate);
      const kickoffHour = parseOptionalKickoffHour(rawKickoffHour);
      const result = await prepareLeagueKickoffWindowInternal(baseDate, {
        allForDay: kickoffHour == null,
        kickoffHour,
      });
      functions.logger.info('[prepareLeagueKickoffWindowHttp] done', result);
      res.json({ ok: true, day, mode: 'prepare', result });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error?.message || 'invalid_request' });
    }
  });

export const kickoffPreparedLeagueMatchesHttp = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed' });
      return;
    }
    if (!requireAdminSecret(req, res)) return;

    try {
      const body = readRequestBody(req);
      const rawDate = body.date ?? req.query?.date;
      const rawKickoffHour = body.kickoffHour ?? req.query?.kickoffHour;
      const { day, baseDate } = parseCatchupDate(rawDate);
      const kickoffHour = parseOptionalKickoffHour(rawKickoffHour);
      const result = await kickoffPreparedLeagueMatchesInternal(baseDate, {
        allForDay: kickoffHour == null,
        kickoffHour,
      });
      functions.logger.info('[kickoffPreparedLeagueMatchesHttp] done', result);
      res.json({ ok: true, day, mode: 'kickoff', result });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error?.message || 'invalid_request' });
    }
  });

export const runLeagueCatchupForDateHttp = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed' });
      return;
    }
    if (!requireAdminSecret(req, res)) return;

    try {
      const body = readRequestBody(req);
      const rawDate = body.date ?? req.query?.date;
      const mode = parseCatchupMode(body.mode ?? req.query?.mode);
      const { day, baseDate } = parseCatchupDate(rawDate);
      const result = await runLeagueCatchupForDateInternal(day, baseDate, mode);
      functions.logger.info('[runLeagueCatchupForDateHttp] done', result);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error?.message || 'invalid_request' });
    }
  });

export const ingestLeagueMatchLifecycleHttp = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    const allowedSecrets = resolveLifecycleSecrets();
    if (!allowedSecrets.length || !allowedSecrets.includes(token)) {
      res.status(401).send('unauthorized');
      return;
    }

    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const matchId = String(body.matchId || '').trim();
      const leagueId = String(body.leagueId || '').trim();
      const fixtureId = String(body.fixtureId || '').trim() || matchId;
      const state = String(body.state || '').trim();
      if (!matchId || !fixtureId || !state) {
        res.status(400).json({ error: 'matchId, fixtureId and state required' });
        return;
      }

      let fixtureRef: FirebaseFirestore.DocumentReference | null = null;
      if (leagueId) {
        fixtureRef = db.doc(`leagues/${leagueId}/fixtures/${fixtureId}`);
      } else {
        const snap = await db
          .collectionGroup('fixtures')
          .where(FieldPath.documentId(), '==', fixtureId)
          .limit(1)
          .get();
        if (!snap.empty) fixtureRef = snap.docs[0].ref;
      }

      if (!fixtureRef) {
        res.status(404).json({ error: 'fixture_not_found' });
        return;
      }

      const fixtureSnap = await fixtureRef.get();
      if (!fixtureSnap.exists) {
        res.status(404).json({ error: 'fixture_not_found' });
        return;
      }
      const fixture = fixtureSnap.data() as any;
      const currentStatus = String(fixture?.status || 'scheduled');
      const minute = parseLifecycleMinute(body.minute);
      const resultPayload =
        normalizeObjectPayload((body as any).result) ||
        normalizeObjectPayload((body as any).resultPayload);
      const inlineScore = extractInlineScore(body, resultPayload);
      const patch: Record<string, unknown> = {
        'live.matchId': matchId,
        'live.state': state,
        'live.nodeId': body.nodeId || fixture?.live?.nodeId || null,
        'live.serverIp': body.serverIp || fixture?.live?.serverIp || null,
        'live.serverPort': Number.isFinite(Number(body.serverPort))
          ? Number(body.serverPort)
          : (fixture?.live?.serverPort ?? null),
        'live.lastLifecycleAt': FieldValue.serverTimestamp(),
      };
      if (minute != null) {
        patch['live.minute'] = minute;
        patch['live.minuteUpdatedAt'] = body.minuteUpdatedAt || FieldValue.serverTimestamp();
      }
      if (resultPayload) {
        patch['live.resultPayload'] = resultPayload;
      }

      const nextStatus = mapLifecycleToFixtureStatus(state, currentStatus);
      if (nextStatus !== currentStatus) {
        patch.status = nextStatus;
      }
      if ((state === 'server_started' || state === 'running') && !fixture?.live?.startedAt) {
        patch['live.startedAt'] = FieldValue.serverTimestamp();
      }
      if (state === 'ended') {
        patch['live.endedAt'] = FieldValue.serverTimestamp();
        patch['live.resultMissing'] = !inlineScore && currentStatus !== 'played';
      }
      if (state === 'failed') {
        patch['live.reason'] = String(body.reason || 'failed');
      }

      const shouldFinalizeInline = state === 'ended' && inlineScore != null;
      if (shouldFinalizeInline) {
        const resolvedTeamIds = await resolveFixtureRevenueTeamIds(
          fixtureRef.parent.parent!.id,
          fixture as Record<string, unknown>,
        );
        await finalizeLeagueFixtureSettlement(fixtureRef!, {
          score: inlineScore,
          resolvedTeamIds,
          patch: {
            ...patch,
            status: 'played',
            score: inlineScore,
            'live.resultMissing': false,
          },
        });
      } else {
        await fixtureRef.update(patch);
      }
      res.json({ ok: true, matchId, fixtureId, state });
    } catch (error: any) {
      functions.logger.error('[ingestLeagueMatchLifecycleHttp] failed', { error: error?.message || String(error) });
      res.status(500).json({ error: error?.message || 'internal' });
    }
  });
