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
  applyLeagueMatchRevenueInTx,
  applyStandingResultInTx,
  resolveFixtureRevenueTeamIds,
} from './utils/leagueMatchFinalize.js';
import { finalizeFixtureWithFallbackResult } from './utils/matchResultFallback.js';
import { enqueueRenderJob } from './replay/renderJob.js';
import { enqueueLeagueMatchReminder } from './notify/matchReminder.js';
import {
  resolveReservationKickoffAt,
  resolveSameDayRetryKickoffAt,
} from './utils/liveLeagueCatchup.js';
import {
  compareHistoricalFixtureDates,
  getHistoricalRecoveryAttemptCount,
  isHistoricalRecoverySettled,
  NIGHTLY_RECOVERY_BATCH_SIZE,
  NIGHTLY_RECOVERY_MAX_ATTEMPTS,
  NIGHTLY_RECOVERY_RETRY_DELAY_MINUTES,
  NIGHTLY_RECOVERY_RUNNER_LOCK_MINUTES,
  NIGHTLY_RECOVERY_SCAN_LIMIT,
  NIGHTLY_RECOVERY_WAVE_STALE_MINUTES,
  NIGHTLY_RECOVERY_WAVE_LOCK_MINUTES,
  resolveHistoricalRecoveryCandidateKind,
  resolveHistoricalRecoveryKickoffAt,
  resolveHistoricalRetryAt,
  shouldFallbackAfterHistoricalAttempts,
  toTimestampMillis,
} from './utils/historicalRecovery.js';
import { queueHistoricalRecoveryAlert } from './notify/recoveryAlerts.js';

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
    '11,19',
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
const HISTORICAL_RECOVERY_RUNTIME_PATH = 'ops_recovery_runtime/nightly-historical';
const HISTORICAL_RECOVERY_WAVES_COLLECTION = 'ops_recovery_waves';
const HISTORICAL_RECOVERY_ACTIVE_STATE = 'active';
const HISTORICAL_RECOVERY_OPEN_LAST_HOUR_TR = 9;
const HISTORICAL_RECOVERY_OPEN_LAST_MINUTE_TR = 0;
const HISTORICAL_RECOVERY_RUNNING_TIMEOUT_MINUTES = 30;

const AUTO_RESCHEDULE_REASON_TOKENS = [
  'running_timeout',
  'status_poll_timeout',
  'kickoff_retry_exhausted',
  'prepare_failed',
  'kickoff_failed',
  'match_not_found',
  'allocation_not_found',
  'start_404',
  'match_start_timeout',
  'match_start_failed',
  'no_free_slot',
  'allocation_failed',
  'fetch failed',
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

type FixtureEntry = {
  doc: FirebaseFirestore.QueryDocumentSnapshot;
  leagueId: string;
  fixture: any;
};

type HistoricalRecoveryWaveDoc = {
  waveId: string;
  status: string;
  fixturePaths: string[];
  createdAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null;
  updatedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null;
  completedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null;
  includeChampions?: boolean;
  limit?: number;
  fromDate?: FirebaseFirestore.Timestamp | null;
};

type HistoricalRecoveryScanOptions = {
  limit?: number;
  includeChampions?: boolean;
  fromDate?: Date | null;
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

function getHistoricalRecoveryRuntimeRef() {
  return db.doc(HISTORICAL_RECOVERY_RUNTIME_PATH);
}

function getHistoricalRecoveryWaveRef(waveId: string) {
  return db.collection(HISTORICAL_RECOVERY_WAVES_COLLECTION).doc(waveId);
}

function readBoolean(value: unknown) {
  return value === true;
}

function parseOptionalBoolean(raw: unknown, fallback = false) {
  if (raw == null || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
}

function normalizeCompetitionType(value: unknown) {
  return String(value || '').trim().toLowerCase() || 'domestic_league';
}

function isChampionsLeagueFixture(fixture: any) {
  return normalizeCompetitionType(fixture?.competitionType) === 'champions_league';
}

function resolveFixtureKickoffReferenceDate(fixture: any) {
  return resolveHistoricalRecoveryKickoffAt(fixture);
}

function resolveFixtureReservationKickoffAt(
  fixture: any,
  options: KickoffResolveOptions = {},
  now = new Date(),
  explicitKickoffAt?: Date | null,
) {
  const overrideKickoffAt =
    explicitKickoffAt instanceof Date && !Number.isNaN(explicitKickoffAt.getTime())
      ? explicitKickoffAt
      : null;
  if (overrideKickoffAt) {
    return overrideKickoffAt;
  }

  const recoveryKickoffAt = resolveHistoricalRecoveryKickoffAt(fixture);
  if (recoveryKickoffAt) {
    return recoveryKickoffAt;
  }

  const fixtureKickoffAt = fixture?.date?.toDate?.() as Date | undefined;
  return resolveReservationKickoffAt(fixtureKickoffAt, options, now);
}

function shouldOpenHistoricalRecoveryWave(now = new Date()) {
  const hour = Number(formatInTimeZone(now, TZ, 'H'));
  const minute = Number(formatInTimeZone(now, TZ, 'm'));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return true;
  }
  if (hour < HISTORICAL_RECOVERY_OPEN_LAST_HOUR_TR) {
    return true;
  }
  return hour === HISTORICAL_RECOVERY_OPEN_LAST_HOUR_TR && minute <= HISTORICAL_RECOVERY_OPEN_LAST_MINUTE_TR;
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

function buildTeamPayload(teamId: string, data: any): TeamPayload {
  return buildUnityRuntimeTeamPayload(teamId, data);
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
  return {
    teamId,
    ownerUid: typeof raw?.ownerUid === 'string' && raw.ownerUid.trim() ? raw.ownerUid : null,
    payload: buildTeamPayload(teamId, raw),
    raw,
  };
}

async function ensureMatchPlanSnapshot(
  matchId: string,
  leagueId: string,
  seasonId: string,
  fixture: any,
  home: TeamBundle,
  away: TeamBundle,
  kickoffUtc?: Date | null,
) {
  const planRef = db.doc(`matchPlans/${matchId}`);
  const existing = await planRef.get();
  if (existing.exists) return;

  const buildSnapshot = (team: TeamBundle) => {
    const runtimePayload = buildUnityRuntimeTeamPayload(team.teamId, team.raw);
    const lineup = team.raw?.lineup || {};
    const plan = team.raw?.plan || {};
    const resolvedPlan = runtimePayload.plan || {};
    return {
      teamId: team.teamId,
      clubName: team.raw?.clubName || team.raw?.name || team.teamId,
      formation:
        typeof resolvedPlan.formation === 'string'
          ? resolvedPlan.formation
          : typeof runtimePayload.formation === 'string'
            ? runtimePayload.formation
            : typeof lineup?.formation === 'string'
              ? lineup.formation
              : typeof plan?.formation === 'string'
                ? plan.formation
                : null,
      shape:
        typeof resolvedPlan.shape === 'string'
          ? resolvedPlan.shape
          : typeof runtimePayload.shape === 'string'
            ? runtimePayload.shape
            : typeof lineup?.shape === 'string'
              ? lineup.shape
              : typeof plan?.shape === 'string'
                ? plan.shape
                : null,
      tactics: resolvedPlan.tactics || lineup?.tactics || {},
      starters: Array.isArray(resolvedPlan.starters)
        ? resolvedPlan.starters
        : Array.isArray(lineup?.starters)
          ? lineup.starters
          : Array.isArray(plan?.starters)
            ? plan.starters
            : [],
      subs: Array.isArray(resolvedPlan.subs)
        ? resolvedPlan.subs
        : Array.isArray(resolvedPlan.bench)
          ? resolvedPlan.bench
          : Array.isArray(lineup?.subs)
            ? lineup.subs
            : Array.isArray(plan?.subs)
              ? plan.subs
              : Array.isArray(plan?.bench)
                ? plan.bench
                : [],
      reserves: Array.isArray(resolvedPlan.reserves)
        ? resolvedPlan.reserves
        : Array.isArray(lineup?.reserves)
          ? lineup.reserves
          : Array.isArray(plan?.reserves)
            ? plan.reserves
            : [],
      slotAssignments: Array.isArray(resolvedPlan.slotAssignments)
        ? resolvedPlan.slotAssignments
        : Array.isArray(runtimePayload.slotAssignments)
          ? runtimePayload.slotAssignments
          : Array.isArray(lineup?.slotAssignments)
            ? lineup.slotAssignments
            : Array.isArray(plan?.slotAssignments)
              ? plan.slotAssignments
              : [],
      ...(resolvedPlan.customFormations && typeof resolvedPlan.customFormations === 'object'
        ? { customFormations: resolvedPlan.customFormations }
        : (lineup?.customFormations && typeof lineup.customFormations === 'object')
          ? { customFormations: lineup.customFormations }
          : (plan?.customFormations && typeof plan.customFormations === 'object')
            ? { customFormations: plan.customFormations }
            : {}),
    };
  };

  await planRef.create({
    matchId,
    leagueId,
    seasonId,
    createdAt: FieldValue.serverTimestamp(),
    rngSeed: fixture.seed || Math.floor(Math.random() * 1e9),
    kickoffUtc:
      kickoffUtc instanceof Date && !Number.isNaN(kickoffUtc.getTime())
        ? Timestamp.fromDate(kickoffUtc)
        : fixture.date,
    home: buildSnapshot(home),
    away: buildSnapshot(away),
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
    return 'missing_score' as const;
  }

  const resultPath = `results/${seasonId}/${leagueId}/${fixtureId}.json`;
  const alreadyExists = await storageFileExists(resultPath);
  if (alreadyExists) {
    return 'result_exists' as const;
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
  return 'recovered' as const;
}

async function backfillLiveLeagueMediaEntry(
  entry: FixtureEntry,
  now = new Date(),
  options: { allowFallback?: boolean } = {},
) {
  const fixture = entry.fixture;
  const live = fixture?.live || {};
  const matchId = String(live.matchId || '').trim();
  if (!matchId) {
    return {
      checked: 0,
      replaySynced: 0,
      videoHealed: 0,
      resultRecovered: 0,
      missingScore: 0,
      renderQueued: 0,
      fallbackApplied: 0,
      fallbackFailed: 0,
      failed: 0,
    };
  }

  try {
    const match = await getInternalMatchDetails(matchId);
    if (!match) {
      return {
        checked: 1,
        replaySynced: 0,
        videoHealed: 0,
        resultRecovered: 0,
        missingScore: 0,
        renderQueued: 0,
        fallbackApplied: 0,
        fallbackFailed: 0,
        failed: 0,
      };
    }

    const seasonId = deriveSeasonId(fixture, match);
    const replayPath = deriveReplayPath(entry.leagueId, seasonId, entry.doc.id, match, fixture);
    const videoPath = deriveVideoPath(seasonId, entry.doc.id, match, fixture);
    const patch: Record<string, unknown> = {};
    let replaySynced = 0;
    let videoHealed = 0;
    let resultRecovered = 0;
    let missingScore = 0;
    let renderQueued = 0;
    let fallbackApplied = 0;
    let fallbackFailed = 0;

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
      const recoveryStatus = await writeSyntheticResult(entry.leagueId, entry.doc.id, fixture, match);
      if (recoveryStatus === 'recovered') {
        resultRecovered += 1;
        return {
          checked: 1,
          replaySynced,
          videoHealed,
          resultRecovered,
          missingScore,
          renderQueued,
          fallbackApplied,
          fallbackFailed,
          failed: 0,
        };
      }
      if (recoveryStatus === 'missing_score') {
        if (options.allowFallback === false) {
          missingScore += 1;
          return {
            checked: 1,
            replaySynced,
            videoHealed,
            resultRecovered,
            missingScore,
            renderQueued,
            fallbackApplied,
            fallbackFailed,
            failed: 0,
          };
        }
        try {
          const fallback = await finalizeFixtureWithFallbackResult({
            leagueId: entry.leagueId,
            fixtureId: entry.doc.id,
            matchId,
            reason: match.endedReason || 'backfill_missing_score',
          });
          if (fallback.status === 'applied') {
            fallbackApplied += 1;
          }
          return {
            checked: 1,
            replaySynced,
            videoHealed,
            resultRecovered,
            missingScore,
            renderQueued,
            fallbackApplied,
            fallbackFailed,
            failed: 0,
          };
        } catch (error: any) {
          fallbackFailed += 1;
          functions.logger.warn('[backfillLiveLeagueMedia] fallback failed', {
            fixtureId: entry.doc.id,
            leagueId: entry.leagueId,
            matchId,
            error: error?.message || String(error),
          });
          return {
            checked: 1,
            replaySynced,
            videoHealed,
            resultRecovered,
            missingScore,
            renderQueued,
            fallbackApplied,
            fallbackFailed,
            failed: 1,
          };
        }
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

    return {
      checked: 1,
      replaySynced,
      videoHealed,
      resultRecovered,
      missingScore,
      renderQueued,
      fallbackApplied,
      fallbackFailed,
      failed: 0,
    };
  } catch (error: any) {
    functions.logger.warn('[backfillLiveLeagueMedia] item failed', {
      fixtureId: entry.doc.id,
      leagueId: entry.leagueId,
      matchId,
      error: error?.message || String(error),
    });
    return {
      checked: 1,
      replaySynced: 0,
      videoHealed: 0,
      resultRecovered: 0,
      missingScore: 0,
      renderQueued: 0,
      fallbackApplied: 0,
      fallbackFailed: 0,
      failed: 1,
    };
  }
}

async function backfillLiveLeagueMediaInternal(now = new Date()) {
  const day = dayKeyTR(now);
  const fixtures = await loadFixturesForReconcile(now);
  let checked = 0;
  let replaySynced = 0;
  let videoHealed = 0;
  let resultRecovered = 0;
  let renderQueued = 0;
  let fallbackApplied = 0;
  let fallbackFailed = 0;
  let failed = 0;

  for (const entry of fixtures) {
    const result = await backfillLiveLeagueMediaEntry(entry, now);
    checked += Number(result.checked || 0);
    replaySynced += Number(result.replaySynced || 0);
    videoHealed += Number(result.videoHealed || 0);
    resultRecovered += Number(result.resultRecovered || 0);
    renderQueued += Number(result.renderQueued || 0);
    fallbackApplied += Number(result.fallbackApplied || 0);
    fallbackFailed += Number(result.fallbackFailed || 0);
    failed += Number(result.failed || 0);
  }

  await updateHeartbeat(day, {
    leagueMediaBackfillOk: failed === 0,
    leagueMediaBackfillChecked: checked,
    leagueMediaBackfillReplaySynced: replaySynced,
    leagueMediaBackfillVideoHealed: videoHealed,
    leagueMediaBackfillResultRecovered: resultRecovered,
    leagueMediaBackfillRenderQueued: renderQueued,
    leagueMediaBackfillFailed: failed,
    leagueFallbackApplied: FieldValue.increment(fallbackApplied),
    leagueFallbackFailed: FieldValue.increment(fallbackFailed),
  });

  return {
    day,
    checked,
    replaySynced,
    videoHealed,
    resultRecovered,
    renderQueued,
    fallbackApplied,
    fallbackFailed,
    failed,
  };
}

async function loadExactKickoffFixtures(
  targetTs: Timestamp,
  fieldPath: 'date' | 'recovery.reservedKickoffAt' = 'date',
) {
  try {
    const query =
      fieldPath === 'date'
        ? db
            .collectionGroup('fixtures')
            .where('status', '==', 'scheduled')
            .where(fieldPath, '==', targetTs)
        : db
            .collectionGroup('fixtures')
            .where(fieldPath, '==', targetTs);
    const snap = await query.get();
    return snap.docs.filter((doc) => (doc.data() as any)?.status === 'scheduled');
  } catch {
    const leagues = await db.collection('leagues').get();
    const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    for (const league of leagues.docs) {
      const fixtures = await league.ref.collection('fixtures').where(fieldPath, '==', targetTs).get();
      docs.push(...fixtures.docs.filter((doc) => (doc.data() as any)?.status === 'scheduled'));
    }
    return docs;
  }
}

async function loadFixturesByExactKickoffTargets(targetKickoffs: Date[]) {
  const dedupe = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const kickoffAt of targetKickoffs) {
    const targetTs = Timestamp.fromDate(kickoffAt);
    for (const fieldPath of ['date', 'recovery.reservedKickoffAt'] as const) {
      const docs = await loadExactKickoffFixtures(targetTs, fieldPath);
      for (const doc of docs) {
        dedupe.set(doc.ref.path, doc);
      }
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

async function prepareFixtureForLeagueKickoff(
  entry: FixtureEntry,
  options: KickoffResolveOptions = {},
  explicitKickoffAt?: Date | null,
) {
  const { doc, fixture, leagueId } = entry;
  if (!leagueId) {
    return { status: 'skipped' as const, reason: 'missing_league_id' };
  }

  if (fixture?.live?.matchId && !isTerminalLiveState(fixture?.live?.state)) {
    return { status: 'reused' as const, matchId: String(fixture.live.matchId) };
  }

  const matchId = doc.id;
  try {
    const seasonId = String(fixture.seasonId ?? fixture.season ?? 'default');
    const { homeTeamId, awayTeamId } = await resolveFixtureTeams(leagueId, fixture);
    if (!homeTeamId || !awayTeamId) {
      await doc.ref.update({
        ...liveStatePatch('prepare_failed', {
          'live.reason': 'missing_team_ids',
        }),
      });
      return { status: 'skipped' as const, reason: 'missing_team_ids' };
    }

    const [home, away] = await Promise.all([
      loadTeamBundle(homeTeamId),
      loadTeamBundle(awayTeamId),
    ]);
    if (!home || !away) {
      await doc.ref.update({
        ...liveStatePatch('prepare_failed', {
          'live.reason': 'missing_team_docs',
        }),
      });
      return { status: 'skipped' as const, reason: 'missing_team_docs' };
    }

    const reservationKickoffAt = resolveFixtureReservationKickoffAt(
      fixture,
      options,
      new Date(),
      explicitKickoffAt,
    );
    await ensureMatchPlanSnapshot(
      matchId,
      leagueId,
      seasonId,
      fixture,
      home,
      away,
      reservationKickoffAt,
    );
    const media = await createMediaBundle(leagueId, seasonId, matchId);
    const requestToken = buildRequestToken(matchId, seasonId);
    const kickoffAtIso = reservationKickoffAt ? reservationKickoffAt.toISOString() : null;

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
        leagueId,
        fixtureId: doc.id,
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
      ...(reservationKickoffAt
        ? {
            recovery: {
              ...(fixture?.recovery || {}),
              reservedKickoffAt: Timestamp.fromDate(reservationKickoffAt),
              updatedAt: FieldValue.serverTimestamp(),
            },
          }
        : {}),
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

    return {
      status: response.reused ? ('reused' as const) : ('prepared' as const),
      matchId: response.matchId || matchId,
      liveState: response.state || 'warm',
    };
  } catch (error: any) {
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
    return {
      status: 'failed' as const,
      reason: error?.message || String(error),
    };
  }
}

async function kickoffPreparedLeagueFixture(entry: FixtureEntry) {
  const { doc, fixture } = entry;
  const live = fixture?.live || {};
  if (!live?.matchId) {
    return { status: 'skipped' as const, reason: 'missing_match_id' };
  }
  if (String(fixture?.status || '').toLowerCase() === 'played') {
    return { status: 'skipped' as const, reason: 'already_played' };
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
        serverPort: Number.isFinite(response.serverPort)
          ? Number(response.serverPort)
          : live.serverPort ?? null,
        kickoffAttemptedAt: FieldValue.serverTimestamp(),
        lastLifecycleAt: FieldValue.serverTimestamp(),
      },
    }, { merge: true });
    return {
      status: 'started' as const,
      matchId: response.matchId || String(live.matchId),
      liveState: response.state || 'starting',
    };
  } catch (error: any) {
    functions.logger.error('[kickoffPreparedLeagueMatches] fixture failed', {
      fixtureId: doc.id,
      error: error?.message || String(error),
    });
    await doc.ref.update({
      ...liveStatePatch('kickoff_failed', {
        'live.reason': error?.message || 'kickoff_failed',
      }),
    });
    return {
      status: 'failed' as const,
      reason: error?.message || String(error),
    };
  }
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
    const result = await prepareFixtureForLeagueKickoff({
      doc,
      leagueId: doc.ref.parent.parent?.id || '',
      fixture: doc.data() as any,
    }, options);
    if (result.status === 'prepared') prepared += 1;
    else if (result.status === 'reused') reused += 1;
    else if (result.status === 'skipped') skipped += 1;
    else failed += 1;
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
    const result = await kickoffPreparedLeagueFixture({
      doc,
      leagueId: doc.ref.parent.parent?.id || '',
      fixture: doc.data() as any,
    });
    if (result.status === 'started') started += 1;
    else if (result.status === 'skipped') skipped += 1;
    else failed += 1;
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
  const fixtures: FixtureEntry[] = [];

  for (const league of leagues.docs) {
    const [dateSnap, reservedSnap] = await Promise.all([
      league.ref
        .collection('fixtures')
        .where('date', '>=', Timestamp.fromDate(minDate))
        .where('date', '<=', Timestamp.fromDate(maxDate))
        .get(),
      league.ref
        .collection('fixtures')
        .where('recovery.reservedKickoffAt', '>=', Timestamp.fromDate(minDate))
        .where('recovery.reservedKickoffAt', '<=', Timestamp.fromDate(maxDate))
        .get()
        .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
    ]);
    const dedupedDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const doc of [...dateSnap.docs, ...reservedSnap.docs]) {
      dedupedDocs.set(doc.ref.path, doc);
    }
    for (const doc of dedupedDocs.values()) {
      const fixture = doc.data() as any;
      if (!fixture?.live?.matchId) continue;
      fixtures.push({ doc, leagueId: league.id, fixture });
    }
  }

  return fixtures;
}

async function reconcileLeagueLiveFixtureEntry(
  entry: FixtureEntry,
  now = new Date(),
  runningTimeoutMinutes = Math.max(10, Number(LEAGUE_RUNNING_TIMEOUT_MINUTES || 120)),
) {
  const fixture = entry.fixture;
  const live = fixture?.live || {};
  const matchId = String(live.matchId || '').trim();
  if (!matchId) {
    return { checked: 0, updated: 0, failed: 0 };
  }

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

    const kickoffDate = resolveFixtureKickoffReferenceDate(fixture);
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
    return { checked: 1, updated: 1, failed: 0 };
  } catch (error: any) {
    functions.logger.warn('[reconcileLeagueLiveMatches] status sync failed', {
      fixtureId: entry.doc.id,
      matchId,
      error: error?.message || String(error),
    });

    const kickoffDate = resolveFixtureKickoffReferenceDate(fixture);
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

    return { checked: 1, updated: 0, failed: 1 };
  }
}

async function reconcileLeagueLiveMatchesInternal(now = new Date()) {
  const fixtures = await loadFixturesForReconcile(now);
  const day = dayKeyTR(now);
  let checked = 0;
  let updated = 0;
  let failed = 0;
  const runningTimeoutMinutes = Math.max(10, Number(LEAGUE_RUNNING_TIMEOUT_MINUTES || 120));

  for (const entry of fixtures) {
    const result = await reconcileLeagueLiveFixtureEntry(entry, now, runningTimeoutMinutes);
    checked += Number(result.checked || 0);
    updated += Number(result.updated || 0);
    failed += Number(result.failed || 0);
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

function isAutoRescheduleEligibleFixtureStatus(status: string, liveState: string) {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  const normalizedLiveState = String(liveState || '').trim().toLowerCase();
  if (normalizedStatus === 'failed') {
    return true;
  }
  if (normalizedStatus !== 'scheduled') {
    return false;
  }
  return (
    normalizedLiveState === 'prepare_failed' ||
    normalizedLiveState === 'kickoff_failed' ||
    normalizedLiveState === 'failed'
  );
}

function resolveNextSameDayKickoffDate(now: Date, fixtureDate: Date) {
  return resolveSameDayRetryKickoffAt(
    fixtureDate,
    now,
    LEAGUE_KICKOFF_HOURS_TR,
    Math.max(1, Number(LEAGUE_FAILED_RESCHEDULE_MIN_DELAY_MINUTES || 5)),
  );
}

async function autoRescheduleFailedLeagueFixturesInternal(now = new Date()) {
  if (!LEAGUE_FAILED_RESCHEDULE_ENABLED) {
    return {
      checked: 0,
      rescheduled: 0,
      skipped: 0,
      failed: 0,
      fallbackApplied: 0,
      fallbackFailed: 0,
    };
  }

  const fixtures = await loadFixturesForReconcile(now);
  let checked = 0;
  let rescheduled = 0;
  let skipped = 0;
  let failed = 0;
  let fallbackApplied = 0;
  let fallbackFailed = 0;
  const maxAttempts = Math.max(0, Number(LEAGUE_FAILED_RESCHEDULE_MAX_ATTEMPTS || 2));

  for (const entry of fixtures) {
    const fixture = entry.fixture || {};
    const live = fixture?.live || {};
    const status = String(fixture?.status || '').trim().toLowerCase();
    const liveState = String(live?.state || '').trim().toLowerCase();
    if (!isAutoRescheduleEligibleFixtureStatus(status, liveState)) continue;
    checked += 1;

    const reason = String(live?.reason || '').trim().toLowerCase();
    if (!isAutoReschedulableFailure(reason)) {
      skipped += 1;
      continue;
    }

    const previousReschedules = Number(live?.rescheduleCount || 0);
    if (previousReschedules >= maxAttempts) {
      try {
        const fallback = await finalizeFixtureWithFallbackResult({
          leagueId: entry.leagueId,
          fixtureId: entry.doc.id,
          matchId: String(live?.matchId || '').trim() || undefined,
          reason: `reschedule_exhausted:${reason || 'failed'}`,
        });
        if (fallback.status === 'applied') {
          fallbackApplied += 1;
        } else {
          skipped += 1;
        }
      } catch (error: any) {
        failed += 1;
        fallbackFailed += 1;
        functions.logger.warn('[autoRescheduleFailedLeagueFixtures] fallback failed', {
          fixtureId: entry.doc.id,
          leagueId: entry.leagueId,
          reason,
          error: error?.message || String(error),
        });
      }
      continue;
    }

    try {
      const fixtureDate = fixture?.date?.toDate?.() instanceof Date ? fixture.date.toDate() : now;
      const nextKickoff = resolveNextSameDayKickoffDate(now, fixtureDate);
      const previousMatchId = String(live?.matchId || '').trim() || null;

      await entry.doc.ref.update({
        status: 'scheduled',
        score: null,
        replayPath: FieldValue.delete(),
        video: FieldValue.delete(),
        videoMissing: FieldValue.delete(),
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
        'recovery.state': FieldValue.delete(),
        'recovery.waveId': FieldValue.delete(),
        'recovery.lockedAt': FieldValue.delete(),
        'recovery.lockExpiresAt': FieldValue.delete(),
        'recovery.nextRetryAt': FieldValue.delete(),
        'recovery.lastError': FieldValue.delete(),
        'recovery.reservedKickoffAt': nextKickoff
          ? Timestamp.fromDate(nextKickoff)
          : FieldValue.delete(),
        'recovery.updatedAt': nextKickoff
          ? FieldValue.serverTimestamp()
          : FieldValue.delete(),
      });
      const leagueId = entry.doc.ref.parent.parent?.id;
      if (leagueId && nextKickoff) {
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

  return { checked, rescheduled, skipped, failed, fallbackApplied, fallbackFailed };
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
    leagueFallbackApplied: FieldValue.increment(Number(autoReschedule.fallbackApplied || 0)),
    leagueFallbackFailed: FieldValue.increment(Number(autoReschedule.fallbackFailed || 0)),
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

function recoveryFieldPatch(state: string, extra: Record<string, unknown> = {}) {
  return {
    'recovery.state': state,
    'recovery.updatedAt': FieldValue.serverTimestamp(),
    ...extra,
  };
}

async function acquireHistoricalRecoveryRunnerLock(now = new Date()) {
  const runtimeRef = getHistoricalRecoveryRuntimeRef();
  const lockUntil = new Date(now.getTime() + NIGHTLY_RECOVERY_RUNNER_LOCK_MINUTES * 60_000);
  let acquired = false;

  await db.runTransaction(async (tx) => {
    const runtimeSnap = await tx.get(runtimeRef);
    const runtime = runtimeSnap.exists ? (runtimeSnap.data() as any) : {};
    const currentLockMs = toTimestampMillis(runtime?.runnerLockUntil);
    if (currentLockMs != null && currentLockMs > now.getTime()) {
      return;
    }
    acquired = true;
    tx.set(runtimeRef, {
      runnerLockUntil: Timestamp.fromDate(lockUntil),
      lastRunAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return acquired;
}

async function releaseHistoricalRecoveryRunnerLock() {
  await getHistoricalRecoveryRuntimeRef().set({
    runnerLockUntil: FieldValue.delete(),
    lastRunAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function loadHistoricalRecoveryEntriesByPaths(paths: string[]) {
  const dedupedPaths = Array.from(new Set(paths.filter(Boolean)));
  const snaps = await Promise.all(dedupedPaths.map((path) => db.doc(path).get()));
  const entries: FixtureEntry[] = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const leagueId = snap.ref.parent.parent?.id;
    if (!leagueId) continue;
    entries.push({
      doc: snap as FirebaseFirestore.QueryDocumentSnapshot,
      leagueId,
      fixture: snap.data() as any,
    });
  }
  entries.sort((left, right) => compareHistoricalFixtureDates(left.fixture, right.fixture));
  return entries;
}

async function loadHistoricalRecoveryCandidatesInternal(
  now = new Date(),
  options: HistoricalRecoveryScanOptions = {},
) {
  const includeChampions = options.includeChampions !== false;
  const fromDateMs = options.fromDate ? options.fromDate.getTime() : null;
  const limit = Math.max(1, Math.min(Number(options.limit || NIGHTLY_RECOVERY_BATCH_SIZE), 100));
  const scanLimit = Math.max(limit * 4, NIGHTLY_RECOVERY_SCAN_LIMIT);
  const candidates: FixtureEntry[] = [];
  let scanned = 0;
  let usedFallback = false;

  const finalizeEntries = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
    scanned = docs.length;
    for (const doc of docs) {
      const leagueId = doc.ref.parent.parent?.id;
      if (!leagueId) continue;
      const fixture = doc.data() as any;
      const fixtureDateMs = toTimestampMillis(fixture?.date);
      if (fixtureDateMs == null || fixtureDateMs >= now.getTime()) continue;
      if (fromDateMs != null && fixtureDateMs < fromDateMs) continue;
      if (!includeChampions && isChampionsLeagueFixture(fixture)) continue;
      const candidateKind = resolveHistoricalRecoveryCandidateKind(
        fixture,
        now,
        HISTORICAL_RECOVERY_RUNNING_TIMEOUT_MINUTES,
      );
      if (!candidateKind) continue;
      candidates.push({ doc, leagueId, fixture });
    }
  };

  try {
    const snap = await db
      .collectionGroup('fixtures')
      .where('status', 'in', ['scheduled', 'failed', 'running'])
      .where('date', '<', Timestamp.fromDate(now))
      .orderBy('date', 'asc')
      .limit(scanLimit)
      .get();
    finalizeEntries(snap.docs);
  } catch (error: any) {
    usedFallback = true;
    functions.logger.warn('[historicalRecovery] collectionGroup scan failed, falling back to per-league', {
      error: error?.message || String(error),
    });

    const leagueSnap = await db.collection('leagues').get();
    const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    for (const league of leagueSnap.docs) {
      const scheduledSnap = await league.ref
        .collection('fixtures')
        .where('status', 'in', ['scheduled', 'failed', 'running'])
        .get();
      docs.push(...scheduledSnap.docs);
    }
    finalizeEntries(docs);
  }

  candidates.sort((left, right) => compareHistoricalFixtureDates(left.fixture, right.fixture));

  return {
    entries: candidates.slice(0, limit),
    scanned,
    usedFallback,
    hasMore: candidates.length > limit,
  };
}

async function reserveHistoricalRecoveryWave(
  entries: FixtureEntry[],
  now = new Date(),
  options: HistoricalRecoveryScanOptions = {},
) {
  if (!entries.length) {
    return null;
  }

  const waveId = `historical_${formatInTimeZone(now, TZ, 'yyyyMMdd_HHmmss')}_${randomUUID().slice(0, 8)}`;
  const runtimeRef = getHistoricalRecoveryRuntimeRef();
  const waveRef = getHistoricalRecoveryWaveRef(waveId);
  const lockExpiresAt = new Date(now.getTime() + NIGHTLY_RECOVERY_WAVE_LOCK_MINUTES * 60_000);

  await db.runTransaction(async (tx) => {
    const runtimeSnap = await tx.get(runtimeRef);
    const runtime = runtimeSnap.exists ? (runtimeSnap.data() as any) : {};
    const activeWaveId = String(runtime?.activeWaveId || '').trim();
    if (activeWaveId) {
      throw new Error('historical_recovery_wave_already_active');
    }

    tx.set(waveRef, {
      waveId,
      status: HISTORICAL_RECOVERY_ACTIVE_STATE,
      fixturePaths: entries.map((entry) => entry.doc.ref.path),
      includeChampions: options.includeChampions !== false,
      limit: entries.length,
      fromDate: options.fromDate ? Timestamp.fromDate(options.fromDate) : null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    } satisfies HistoricalRecoveryWaveDoc, { merge: true });

    tx.set(runtimeRef, {
      activeWaveId: waveId,
      updatedAt: FieldValue.serverTimestamp(),
      lastRunAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    for (const entry of entries) {
      tx.update(entry.doc.ref, {
        ...recoveryFieldPatch('queued', {
          'recovery.waveId': waveId,
          'recovery.lockedAt': FieldValue.serverTimestamp(),
          'recovery.lockExpiresAt': Timestamp.fromDate(lockExpiresAt),
          'recovery.nextRetryAt': FieldValue.delete(),
        }),
      });
    }
  });

  return { waveId, waveRef };
}

async function clearHistoricalRecoveryWave(waveId: string, status = 'completed') {
  const runtimeRef = getHistoricalRecoveryRuntimeRef();
  const waveRef = getHistoricalRecoveryWaveRef(waveId);
  await db.runTransaction(async (tx) => {
    const runtimeSnap = await tx.get(runtimeRef);
    const runtime = runtimeSnap.exists ? (runtimeSnap.data() as any) : {};
    if (String(runtime?.activeWaveId || '').trim() === waveId) {
      tx.set(runtimeRef, {
        activeWaveId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        lastRunAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    tx.set(waveRef, {
      status,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

async function rollOverHistoricalRecoveryWave(
  waveId: string,
  wave: HistoricalRecoveryWaveDoc,
  now = new Date(),
) {
  const entries = await loadHistoricalRecoveryEntriesByPaths(wave.fixturePaths || []);
  const deferredUntil = resolveHistoricalRetryAt(now, NIGHTLY_RECOVERY_RETRY_DELAY_MINUTES);

  for (const entry of entries) {
    const status = String(entry.fixture?.status || '').trim().toLowerCase();
    if (status === 'played' || isHistoricalRecoverySettled(entry.fixture)) {
      continue;
    }

    await entry.doc.ref.update({
      ...recoveryFieldPatch('deferred', {
        'recovery.waveId': FieldValue.delete(),
        'recovery.nextRetryAt': Timestamp.fromDate(deferredUntil),
        'recovery.lockExpiresAt': FieldValue.delete(),
        'recovery.lastError': String(
          entry.fixture?.recovery?.lastError || entry.fixture?.live?.reason || 'wave_rollover',
        ),
      }),
    });
  }

  await clearHistoricalRecoveryWave(waveId, 'rolled_over');
  return {
    rolledOver: entries.length,
    nextRetryAt: deferredUntil.toISOString(),
  };
}

async function loadActiveHistoricalRecoveryWave() {
  const runtimeSnap = await getHistoricalRecoveryRuntimeRef().get();
  if (!runtimeSnap.exists) {
    return null;
  }

  const runtime = runtimeSnap.data() as any;
  const activeWaveId = String(runtime?.activeWaveId || '').trim();
  if (!activeWaveId) {
    return null;
  }

  const waveSnap = await getHistoricalRecoveryWaveRef(activeWaveId).get();
  if (!waveSnap.exists) {
    await getHistoricalRecoveryRuntimeRef().set({
      activeWaveId: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return null;
  }

  return {
    waveId: activeWaveId,
    wave: waveSnap.data() as HistoricalRecoveryWaveDoc,
  };
}

function resolveHistoricalRecoveryAttemptKickoffAt(fixture: any, now = new Date()) {
  const fixtureKickoffAt = fixture?.date?.toDate?.() as Date | undefined;
  return (
    resolveReservationKickoffAt(fixtureKickoffAt, { allForDay: true }, now) ||
    new Date(now.getTime() + 30 * 60_000)
  );
}

function isHistoricalRecoveryWaveStale(wave: HistoricalRecoveryWaveDoc | null | undefined, now = new Date()) {
  const createdAtMs = toTimestampMillis((wave?.createdAt ?? null) as any);
  if (createdAtMs == null) {
    return false;
  }
  return now.getTime() - createdAtMs >= NIGHTLY_RECOVERY_WAVE_STALE_MINUTES * 60_000;
}

async function markHistoricalRecoverySettled(entry: FixtureEntry, waveId: string, state = 'settled') {
  await entry.doc.ref.update({
    ...recoveryFieldPatch(state, {
      'recovery.waveId': waveId,
      'recovery.lockExpiresAt': FieldValue.delete(),
      'recovery.nextRetryAt': FieldValue.delete(),
      'recovery.reservedKickoffAt': FieldValue.delete(),
      'recovery.lastError': FieldValue.delete(),
    }),
  });
}

async function requeueHistoricalRecoveryFixture(
  entry: FixtureEntry,
  now: Date,
  waveId: string,
  reason: string,
) {
  const previousMatchId =
    String(entry.fixture?.live?.matchId || '').trim() ||
    String(entry.fixture?.recovery?.lastMatchId || '').trim() ||
    null;
  const nextRetryAt = resolveHistoricalRetryAt(now, NIGHTLY_RECOVERY_RETRY_DELAY_MINUTES);
  const lockExpiresAt = new Date(now.getTime() + NIGHTLY_RECOVERY_WAVE_LOCK_MINUTES * 60_000);

  await entry.doc.ref.update({
    status: 'scheduled',
    score: FieldValue.delete(),
    replayPath: FieldValue.delete(),
    video: FieldValue.delete(),
    videoMissing: true,
    videoError: FieldValue.delete(),
    'live.state': 'recovery_queued',
    'live.reason': `nightly_requeue:${reason || 'unknown'}`,
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
    'live.homeUserId': FieldValue.delete(),
    'live.awayUserId': FieldValue.delete(),
    'live.retryCount': 0,
    'live.resultMissing': false,
    'live.minute': FieldValue.delete(),
    'live.minuteUpdatedAt': FieldValue.delete(),
    'live.resultPayload': FieldValue.delete(),
    ...recoveryFieldPatch('retry_wait', {
      'recovery.waveId': waveId,
      'recovery.lockedAt': FieldValue.serverTimestamp(),
      'recovery.lockExpiresAt': Timestamp.fromDate(lockExpiresAt),
      'recovery.nextRetryAt': Timestamp.fromDate(nextRetryAt),
      'recovery.lastError': reason || 'unknown',
      'recovery.lastMatchId': previousMatchId,
      'recovery.reservedKickoffAt': FieldValue.delete(),
    }),
  });
}

async function fallbackHistoricalRecoveryFixture(
  entry: FixtureEntry,
  now: Date,
  waveId: string,
  reason: string,
) {
  const previousMatchId =
    String(entry.fixture?.live?.matchId || '').trim() ||
    String(entry.fixture?.recovery?.lastMatchId || '').trim() ||
    null;

  try {
    const fallback = await finalizeFixtureWithFallbackResult({
      leagueId: entry.leagueId,
      fixtureId: entry.doc.id,
      matchId: previousMatchId || undefined,
      reason,
    });

    if (fallback.status === 'applied') {
      const alreadyAlerted = toTimestampMillis(entry.fixture?.recovery?.alertedAt) != null;
      if (!alreadyAlerted) {
        await queueHistoricalRecoveryAlert({
          leagueId: entry.leagueId,
          fixtureId: entry.doc.id,
          fixturePath: entry.doc.ref.path,
          competitionType: entry.fixture?.competitionType || null,
          waveId,
          reason,
          attemptCount: getHistoricalRecoveryAttemptCount(entry.fixture),
          lastMatchId: previousMatchId,
        });
      }

      await entry.doc.ref.update({
        ...recoveryFieldPatch('fallback_applied', {
          'recovery.waveId': waveId,
          'recovery.lockExpiresAt': FieldValue.delete(),
          'recovery.nextRetryAt': FieldValue.delete(),
          'recovery.lastError': reason,
          'recovery.lastMatchId': previousMatchId,
          'recovery.reservedKickoffAt': FieldValue.delete(),
          ...(alreadyAlerted ? {} : { 'recovery.alertedAt': FieldValue.serverTimestamp() }),
        }),
      });

      return {
        prepared: 0,
        started: 0,
        active: 0,
        requeued: 0,
        settled: 1,
        fallbackApplied: 1,
        alertPending: alreadyAlerted ? 0 : 1,
        failed: 0,
      };
    }

    await markHistoricalRecoverySettled(entry, waveId);
    return {
      prepared: 0,
      started: 0,
      active: 0,
      requeued: 0,
      settled: 1,
      fallbackApplied: 0,
      alertPending: 0,
      failed: 0,
    };
  } catch (error: any) {
    const fallbackFailureReason = `fallback_failed:${error?.message || String(error)}`;
    const alreadyAlerted = toTimestampMillis(entry.fixture?.recovery?.alertedAt) != null;
    let shouldMarkAlerted = false;

    if (!alreadyAlerted) {
      try {
        const alertResult = await queueHistoricalRecoveryAlert({
          leagueId: entry.leagueId,
          fixtureId: entry.doc.id,
          fixturePath: entry.doc.ref.path,
          competitionType: entry.fixture?.competitionType || null,
          waveId,
          reason: fallbackFailureReason,
          attemptCount: getHistoricalRecoveryAttemptCount(entry.fixture),
          lastMatchId: previousMatchId,
        });
        shouldMarkAlerted = alertResult.queued || alertResult.duplicate;
      } catch (alertError: any) {
        functions.logger.warn('[fallbackHistoricalRecoveryFixture] alert queue failed', {
          fixtureId: entry.doc.id,
          leagueId: entry.leagueId,
          error: alertError?.message || String(alertError),
        });
      }
    }

    await requeueHistoricalRecoveryFixture(
      entry,
      now,
      waveId,
      fallbackFailureReason,
    );

    if (shouldMarkAlerted) {
      await entry.doc.ref.update({
        'recovery.alertedAt': FieldValue.serverTimestamp(),
      }).catch(() => undefined);
    }

    return {
      prepared: 0,
      started: 0,
      active: 0,
      requeued: 1,
      settled: 0,
      fallbackApplied: 0,
      alertPending: 0,
      failed: 1,
    };
  }
}

async function startHistoricalRecoveryFixtureAttempt(
  entry: FixtureEntry,
  now: Date,
  waveId: string,
) {
  const currentAttemptCount = getHistoricalRecoveryAttemptCount(entry.fixture);
  if (shouldFallbackAfterHistoricalAttempts(currentAttemptCount, NIGHTLY_RECOVERY_MAX_ATTEMPTS)) {
    return fallbackHistoricalRecoveryFixture(
      entry,
      now,
      waveId,
      String(entry.fixture?.live?.reason || entry.fixture?.recovery?.lastError || 'attempts_exhausted'),
    );
  }

  const nextAttemptCount = currentAttemptCount + 1;
  const kickoffAt = resolveHistoricalRecoveryAttemptKickoffAt(entry.fixture, now);
  const lockExpiresAt = new Date(now.getTime() + NIGHTLY_RECOVERY_WAVE_LOCK_MINUTES * 60_000);

  await entry.doc.ref.update({
    ...recoveryFieldPatch('preparing', {
      'recovery.waveId': waveId,
      'recovery.attemptCount': nextAttemptCount,
      'recovery.lockedAt': FieldValue.serverTimestamp(),
      'recovery.lockExpiresAt': Timestamp.fromDate(lockExpiresAt),
      'recovery.nextRetryAt': FieldValue.delete(),
      'recovery.lastError': FieldValue.delete(),
      'recovery.reservedKickoffAt': Timestamp.fromDate(kickoffAt),
    }),
  });

  const prepareResult = await prepareFixtureForLeagueKickoff(entry, { allForDay: true }, kickoffAt);
  if (prepareResult.status === 'failed' || prepareResult.status === 'skipped') {
    if (shouldFallbackAfterHistoricalAttempts(nextAttemptCount, NIGHTLY_RECOVERY_MAX_ATTEMPTS)) {
      return fallbackHistoricalRecoveryFixture(
        entry,
        now,
        waveId,
        prepareResult.reason || 'prepare_failed',
      );
    }
    await requeueHistoricalRecoveryFixture(entry, now, waveId, prepareResult.reason || 'prepare_failed');
    return {
      prepared: 0,
      started: 0,
      active: 0,
      requeued: 1,
      fallbackApplied: 0,
      alertPending: 0,
      settled: 0,
      failed: prepareResult.status === 'failed' ? 1 : 0,
    };
  }

  const preparedEntries = await loadHistoricalRecoveryEntriesByPaths([entry.doc.ref.path]);
  const preparedEntry = preparedEntries[0];
  if (!preparedEntry) {
    await requeueHistoricalRecoveryFixture(entry, now, waveId, 'prepared_entry_missing');
    return {
      prepared: 0,
      started: 0,
      active: 0,
      requeued: 1,
      fallbackApplied: 0,
      alertPending: 0,
      settled: 0,
      failed: 1,
    };
  }

  const kickoffResult = await kickoffPreparedLeagueFixture(preparedEntry);
  if (kickoffResult.status === 'failed' || kickoffResult.status === 'skipped') {
    if (shouldFallbackAfterHistoricalAttempts(nextAttemptCount, NIGHTLY_RECOVERY_MAX_ATTEMPTS)) {
      return fallbackHistoricalRecoveryFixture(
        preparedEntry,
        now,
        waveId,
        kickoffResult.reason || 'kickoff_failed',
      );
    }
    await requeueHistoricalRecoveryFixture(
      preparedEntry,
      now,
      waveId,
      kickoffResult.reason || 'kickoff_failed',
    );
    return {
      prepared: prepareResult.status === 'prepared' ? 1 : 0,
      started: 0,
      active: 0,
      requeued: 1,
      fallbackApplied: 0,
      alertPending: 0,
      settled: 0,
      failed: kickoffResult.status === 'failed' ? 1 : 0,
    };
  }

  await preparedEntry.doc.ref.update({
    ...recoveryFieldPatch('started', {
      'recovery.waveId': waveId,
      'recovery.lockExpiresAt': Timestamp.fromDate(lockExpiresAt),
      'recovery.lastMatchId': kickoffResult.matchId || prepareResult.matchId || entry.doc.id,
    }),
  });

  return {
    prepared: prepareResult.status === 'prepared' ? 1 : 0,
    started: 1,
    active: 1,
    requeued: 0,
    fallbackApplied: 0,
    alertPending: 0,
    settled: 0,
    failed: 0,
  };
}

async function processHistoricalRecoveryWaveEntry(
  entry: FixtureEntry,
  now: Date,
  waveId: string,
) {
  let prepared = 0;
  let started = 0;
  let active = 0;
  let requeued = 0;
  let fallbackApplied = 0;
  let alertPending = 0;
  let settled = 0;
  let failed = 0;

  const media = await backfillLiveLeagueMediaEntry(entry, now, { allowFallback: false });
  failed += Number(media.failed || 0);

  let [currentEntry] = await loadHistoricalRecoveryEntriesByPaths([entry.doc.ref.path]);
  if (!currentEntry) {
    return { prepared, started, active, requeued, fallbackApplied, alertPending, settled, failed };
  }

  if (String(currentEntry.fixture?.status || '').toLowerCase() === 'played') {
    await markHistoricalRecoverySettled(currentEntry, waveId);
    return { prepared, started, active, requeued, fallbackApplied, alertPending, settled: 1, failed };
  }

  if (Number(media.resultRecovered || 0) > 0) {
    await currentEntry.doc.ref.update({
      ...recoveryFieldPatch('awaiting_result', {
        'recovery.waveId': waveId,
        'recovery.lockExpiresAt': Timestamp.fromDate(
          new Date(now.getTime() + NIGHTLY_RECOVERY_WAVE_LOCK_MINUTES * 60_000),
        ),
      }),
    });
    return { prepared, started, active: 1, requeued, fallbackApplied, alertPending, settled, failed };
  }

  const hasLiveMatchId = String(currentEntry.fixture?.live?.matchId || '').trim().length > 0;
  if (hasLiveMatchId) {
    const reconcile = await reconcileLeagueLiveFixtureEntry(
      currentEntry,
      now,
      Math.max(10, Number(LEAGUE_RUNNING_TIMEOUT_MINUTES || 120)),
    );
    failed += Number(reconcile.failed || 0);
    [currentEntry] = await loadHistoricalRecoveryEntriesByPaths([entry.doc.ref.path]);
    if (!currentEntry) {
      return { prepared, started, active, requeued, fallbackApplied, alertPending, settled, failed };
    }
    if (String(currentEntry.fixture?.status || '').toLowerCase() === 'played') {
      await markHistoricalRecoverySettled(currentEntry, waveId);
      return { prepared, started, active, requeued, fallbackApplied, alertPending, settled: 1, failed };
    }
  }

  const candidateKind = resolveHistoricalRecoveryCandidateKind(
    currentEntry.fixture,
    now,
    HISTORICAL_RECOVERY_RUNNING_TIMEOUT_MINUTES,
  );

  if (!candidateKind) {
    if (String(currentEntry.fixture?.live?.matchId || '').trim()) {
      await currentEntry.doc.ref.update({
        ...recoveryFieldPatch('running', {
          'recovery.waveId': waveId,
          'recovery.lockExpiresAt': Timestamp.fromDate(
            new Date(now.getTime() + NIGHTLY_RECOVERY_WAVE_LOCK_MINUTES * 60_000),
          ),
        }),
      });
      active += 1;
    }
    return { prepared, started, active, requeued, fallbackApplied, alertPending, settled, failed };
  }

  const attemptCount = getHistoricalRecoveryAttemptCount(currentEntry.fixture);
  if (shouldFallbackAfterHistoricalAttempts(attemptCount, NIGHTLY_RECOVERY_MAX_ATTEMPTS)) {
    const fallback = await fallbackHistoricalRecoveryFixture(
      currentEntry,
      now,
      waveId,
      String(currentEntry.fixture?.live?.reason || candidateKind),
    );
    fallbackApplied += Number(fallback.fallbackApplied || 0);
    alertPending += Number(fallback.alertPending || 0);
    settled += Number(fallback.settled || 0);
    failed += Number(fallback.failed || 0);
    return { prepared, started, active, requeued, fallbackApplied, alertPending, settled, failed };
  }

  const startedAttempt = await startHistoricalRecoveryFixtureAttempt(currentEntry, now, waveId);
  prepared += Number(startedAttempt.prepared || 0);
  started += Number(startedAttempt.started || 0);
  active += Number(startedAttempt.active || 0);
  requeued += Number(startedAttempt.requeued || 0);
  fallbackApplied += Number(startedAttempt.fallbackApplied || 0);
  alertPending += Number(startedAttempt.alertPending || 0);
  settled += Number(startedAttempt.settled || 0);
  failed += Number(startedAttempt.failed || 0);

  return { prepared, started, active, requeued, fallbackApplied, alertPending, settled, failed };
}

async function runHistoricalRecoveryWaveInternal(
  waveId: string,
  wave: HistoricalRecoveryWaveDoc,
  now = new Date(),
) {
  const entries = await loadHistoricalRecoveryEntriesByPaths(wave.fixturePaths || []);
  let prepared = 0;
  let started = 0;
  let active = 0;
  let requeued = 0;
  let fallbackApplied = 0;
  let alertPending = 0;
  let settled = 0;
  let failed = 0;

  if (!entries.length) {
    await clearHistoricalRecoveryWave(waveId, 'completed');
    return {
      waveId,
      prepared,
      started,
      active,
      requeued,
      fallbackApplied,
      alertPending,
      settled,
      failed,
      completed: true,
    };
  }

  for (const entry of entries) {
    const result = await processHistoricalRecoveryWaveEntry(entry, now, waveId);
    prepared += Number(result.prepared || 0);
    started += Number(result.started || 0);
    active += Number(result.active || 0);
    requeued += Number(result.requeued || 0);
    fallbackApplied += Number(result.fallbackApplied || 0);
    alertPending += Number(result.alertPending || 0);
    settled += Number(result.settled || 0);
    failed += Number(result.failed || 0);
  }

  const refreshedEntries = await loadHistoricalRecoveryEntriesByPaths(wave.fixturePaths || []);
  const completed = refreshedEntries.every((entry) => {
    const status = String(entry.fixture?.status || '').trim().toLowerCase();
    return status === 'played' || isHistoricalRecoverySettled(entry.fixture);
  });

  await getHistoricalRecoveryWaveRef(waveId).set({
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  if (completed) {
    await clearHistoricalRecoveryWave(waveId, 'completed');
  }

  return {
    waveId,
    prepared,
    started,
    active,
    requeued,
    fallbackApplied,
    alertPending,
    settled,
    failed,
    completed,
  };
}

async function recoverHistoricalFixturesNightlyInternal(
  now = new Date(),
  options: HistoricalRecoveryScanOptions & { forceWave?: boolean; dryRun?: boolean } = {},
) {
  const day = dayKeyTR(now);
  const dryRun = options.dryRun === true;
  const forceWave = options.forceWave === true;
  const includeChampions = options.includeChampions !== false;
  const limit = Math.max(1, Math.min(Number(options.limit || NIGHTLY_RECOVERY_BATCH_SIZE), 100));
  let previousWaveRollOver:
    | { waveId: string; rolledOver: number; nextRetryAt: string }
    | null = null;

  const activeWave = await loadActiveHistoricalRecoveryWave();
  if (activeWave) {
    const result = dryRun
      ? {
          waveId: activeWave.waveId,
          prepared: 0,
          started: 0,
          active: activeWave.wave.fixturePaths?.length || 0,
          requeued: 0,
          fallbackApplied: 0,
          alertPending: 0,
          settled: 0,
          failed: 0,
          completed: false,
        }
      : await runHistoricalRecoveryWaveInternal(activeWave.waveId, activeWave.wave, now);
    const shouldRollOver = !dryRun && !result.completed && isHistoricalRecoveryWaveStale(activeWave.wave, now);

    let rollover: { rolledOver: number; nextRetryAt: string } | null = null;
    if (shouldRollOver) {
      rollover = await rollOverHistoricalRecoveryWave(activeWave.waveId, activeWave.wave, now);
    }

    await updateHeartbeat(day, {
      nightlyRecoveryPrepared: FieldValue.increment(Number(result.prepared || 0)),
      nightlyRecoveryStarted: FieldValue.increment(Number(result.started || 0)),
      nightlyRecoveryRequeued: FieldValue.increment(Number(result.requeued || 0)),
      nightlyRecoveryFallbackFinalized: FieldValue.increment(Number(result.fallbackApplied || 0)),
      nightlyRecoveryActiveWaveId:
        result.completed || shouldRollOver ? FieldValue.delete() : activeWave.waveId,
      nightlyRecoveryLastRunAt: FieldValue.serverTimestamp(),
    });

    if (!result.completed && !shouldRollOver) {
      return {
        ok: true,
        activeWaveId: activeWave.waveId,
        usedFallback: false,
        scanned: 0,
        queued: 0,
        hasMoreBacklog: false,
        ...result,
      };
    }

    if (shouldRollOver) {
      functions.logger.info('[recoverHistoricalFixturesNightly] rolled over stale wave', {
        waveId: activeWave.waveId,
        ...rollover,
      });
      previousWaveRollOver = rollover
        ? { waveId: activeWave.waveId, ...rollover }
        : null;
    }

    if (result.completed) {
      return {
        ok: true,
        activeWaveId: activeWave.waveId,
        usedFallback: false,
        scanned: 0,
        queued: 0,
        hasMoreBacklog: false,
        ...result,
      };
    }

  }

  if (!forceWave && !shouldOpenHistoricalRecoveryWave(now)) {
    await updateHeartbeat(day, {
      nightlyRecoveryLastRunAt: FieldValue.serverTimestamp(),
      nightlyRecoveryActiveWaveId: FieldValue.delete(),
    });
    return {
      ok: true,
      skipped: 'outside_open_window',
      scanned: 0,
      queued: 0,
      prepared: 0,
      started: 0,
      requeued: 0,
      fallbackApplied: 0,
      hasMoreBacklog: false,
    };
  }

  const scan = await loadHistoricalRecoveryCandidatesInternal(now, {
    limit,
    includeChampions,
    fromDate: options.fromDate || null,
  });

  await updateHeartbeat(day, {
    nightlyRecoveryScanned: FieldValue.increment(scan.scanned),
    nightlyRecoveryHasMoreBacklog: scan.hasMore,
    nightlyRecoveryLastRunAt: FieldValue.serverTimestamp(),
  });

  if (dryRun || !scan.entries.length) {
    return {
      ok: true,
      scanned: scan.scanned,
      queued: 0,
      prepared: 0,
      started: 0,
      requeued: 0,
      fallbackApplied: 0,
      hasMoreBacklog: scan.hasMore,
      usedFallback: scan.usedFallback,
      activeWaveId: null,
      previousWaveRollOver,
    };
  }

  const reserved = await reserveHistoricalRecoveryWave(scan.entries, now, {
    includeChampions,
    limit,
    fromDate: options.fromDate || null,
  });
  if (!reserved) {
    return {
      ok: true,
      scanned: scan.scanned,
      queued: 0,
      prepared: 0,
      started: 0,
      requeued: 0,
      fallbackApplied: 0,
      hasMoreBacklog: scan.hasMore,
      usedFallback: scan.usedFallback,
      activeWaveId: null,
    };
  }

  await updateHeartbeat(day, {
    nightlyRecoveryQueued: FieldValue.increment(scan.entries.length),
    nightlyRecoveryActiveWaveId: reserved.waveId,
    nightlyRecoveryHasMoreBacklog: scan.hasMore,
    nightlyRecoveryLastRunAt: FieldValue.serverTimestamp(),
  });

  const waveResult = dryRun
    ? {
        waveId: reserved.waveId,
        prepared: 0,
        started: 0,
        active: scan.entries.length,
        requeued: 0,
        fallbackApplied: 0,
        alertPending: 0,
        settled: 0,
        failed: 0,
        completed: false,
      }
    : await runHistoricalRecoveryWaveInternal(reserved.waveId, {
      waveId: reserved.waveId,
      status: HISTORICAL_RECOVERY_ACTIVE_STATE,
      fixturePaths: scan.entries.map((entry) => entry.doc.ref.path),
    }, now);

  await updateHeartbeat(day, {
    nightlyRecoveryPrepared: FieldValue.increment(Number(waveResult.prepared || 0)),
    nightlyRecoveryStarted: FieldValue.increment(Number(waveResult.started || 0)),
    nightlyRecoveryRequeued: FieldValue.increment(Number(waveResult.requeued || 0)),
    nightlyRecoveryFallbackFinalized: FieldValue.increment(Number(waveResult.fallbackApplied || 0)),
    nightlyRecoveryActiveWaveId: waveResult.completed ? FieldValue.delete() : reserved.waveId,
    nightlyRecoveryLastRunAt: FieldValue.serverTimestamp(),
  });

  return {
    ok: true,
    scanned: scan.scanned,
    queued: scan.entries.length,
    hasMoreBacklog: scan.hasMore,
    usedFallback: scan.usedFallback,
    activeWaveId: reserved.waveId,
    previousWaveRollOver,
    ...waveResult,
  };
}

function parseOptionalFromDate(raw: unknown) {
  if (raw == null || raw === '') {
    return null;
  }
  const text = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error('fromDate must be YYYY-MM-DD');
  }
  const parsed = new Date(`${text}T00:00:00+03:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('invalid fromDate');
  }
  return parsed;
}

export const recoverHistoricalFixturesNightly = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .pubsub.schedule('0,30 0-9 * * *')
  .timeZone(TZ)
  .onRun(async () => {
    const now = new Date();
    const acquired = await acquireHistoricalRecoveryRunnerLock(now);
    if (!acquired) {
      functions.logger.info('[recoverHistoricalFixturesNightly] skipped, runner lock active');
      return null;
    }

    try {
      const result = await recoverHistoricalFixturesNightlyInternal(now, {
        limit: NIGHTLY_RECOVERY_BATCH_SIZE,
        includeChampions: true,
      });
      functions.logger.info('[recoverHistoricalFixturesNightly] done', result);
      return null;
    } finally {
      await releaseHistoricalRecoveryRunnerLock().catch(() => undefined);
    }
  });

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

export const recoverHistoricalFixturesHttp = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed' });
      return;
    }
    if (!requireAdminSecret(req, res)) return;

    const body = readRequestBody(req);
    const limitRaw = body.limit ?? req.query?.limit;
    const forceWaveRaw = body.forceWave ?? req.query?.forceWave;
    const includeChampionsRaw = body.includeChampions ?? req.query?.includeChampions;
    const dryRunRaw = body.dryRun ?? req.query?.dryRun;
    const fromDateRaw = body.fromDate ?? req.query?.fromDate;
    const limit = Math.max(1, Math.min(Number(limitRaw || NIGHTLY_RECOVERY_BATCH_SIZE), 100));
    const now = new Date();

    if (!parseOptionalBoolean(dryRunRaw, false)) {
      const acquired = await acquireHistoricalRecoveryRunnerLock(now);
      if (!acquired) {
        res.status(409).json({ ok: false, error: 'historical_recovery_lock_active' });
        return;
      }
    }

    try {
      const result = await recoverHistoricalFixturesNightlyInternal(now, {
        limit,
        dryRun: parseOptionalBoolean(dryRunRaw, false),
        forceWave: parseOptionalBoolean(forceWaveRaw, false),
        includeChampions: parseOptionalBoolean(includeChampionsRaw, true),
        fromDate: parseOptionalFromDate(fromDateRaw),
      });
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error?.message || 'invalid_request' });
    } finally {
      if (!parseOptionalBoolean(dryRunRaw, false)) {
        await releaseHistoricalRecoveryRunnerLock().catch(() => undefined);
      }
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
        await db.runTransaction(async (tx) => {
          const currentSnap = await tx.get(fixtureRef!);
          if (!currentSnap.exists) return;
          const currentFixture = currentSnap.data() as any;
          const currentFixtureStatus = String(currentFixture?.status || 'scheduled');
          const updatePatch: Record<string, unknown> = {
            ...patch,
            status: 'played',
            score: inlineScore,
            'live.resultMissing': false,
          };
          if (currentFixtureStatus !== 'played') {
            updatePatch.endedAt = FieldValue.serverTimestamp();
            updatePatch.playedAt = FieldValue.serverTimestamp();
          }

          // Standings must be advanced here, otherwise later storage finalize is skipped by idempotency.
          if (currentFixtureStatus !== 'played') {
            await applyStandingResultInTx(tx, fixtureRef!, currentFixture, inlineScore);
          }
          await applyLeagueMatchRevenueInTx(tx, fixtureRef!, currentFixture, resolvedTeamIds);
          tx.set(fixtureRef!, updatePatch, { merge: true });
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
