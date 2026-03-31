import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHmac } from 'crypto';
import admin from 'firebase-admin';
import { formatInTimeZone } from 'date-fns-tz';
import { buildUnityRuntimeTeamPayload } from '../lib/utils/unityRuntimePayload.js';

const TZ = 'Europe/Istanbul';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = path.resolve(__dirname, '..');
const ENV_PROD_PATH = path.join(FUNCTIONS_DIR, '.env.prod');

loadEnvFile(ENV_PROD_PATH);

const MATCH_CONTROL_BASE_URL = String(process.env.MATCH_CONTROL_BASE_URL || '').replace(/\/$/, '');
const MATCH_CONTROL_SECRET = String(process.env.MATCH_CONTROL_SECRET || '');
const BATCH_SECRET = String(process.env.BATCH_SECRET || '');
const ADMIN_SECRET = String(process.env.ADMIN_SECRET || BATCH_SECRET || '');
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.PROJECT_ID || 'osm-react';
const FUNCTIONS_BASE_URL = process.env.FUNCTIONS_BASE_URL || `https://europe-west1-${PROJECT_ID}.cloudfunctions.net`;

if (!MATCH_CONTROL_BASE_URL || !MATCH_CONTROL_SECRET || !BATCH_SECRET || !ADMIN_SECRET) {
  throw new Error('MATCH_CONTROL_BASE_URL, MATCH_CONTROL_SECRET, BATCH_SECRET ve ADMIN_SECRET gerekli.');
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.appspot.com` });
}

const db = admin.firestore();
const bucket = admin.storage().bucket();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;
const { ensureBotTeamDoc } = await import('../lib/utils/bots.js');

const argv = parseArgs(process.argv.slice(2));
const mode = argv.listOnly ? 'list' : 'run';
const batchSize = Number(argv.batchSize || 40);
const batchWindowMinutes = Number(argv.batchWindowMinutes || 30);
const maxBatches = Number(argv.maxBatches || 0);
const pollSeconds = Number(argv.pollSeconds || 30);
const transientRetryCount = Number(argv.transientRetryCount || 240);
const transientRetryDelaySeconds = Number(argv.transientRetryDelaySeconds || 30);

function parseArgs(args) {
  const parsed = {};
  const normalizeKey = (value) => value.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
  for (const arg of args) {
    if (arg === '--list' || arg === '--list-only') {
      parsed.listOnly = true;
      continue;
    }
    if (arg === '--run') {
      parsed.run = true;
      continue;
    }
    const [key, value] = arg.split('=');
    if (key.startsWith('--')) {
      parsed[normalizeKey(key.slice(2))] = value ?? 'true';
    }
  }
  return parsed;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function trDayKey(date) {
  return formatInTimeZone(date, TZ, 'yyyy-MM-dd');
}

function trDayLabel(date) {
  return formatInTimeZone(date, TZ, 'dd.MM.yyyy');
}

function originalFixtureDate(league, fixture) {
  const startDate = league?.startDate?.toDate?.() || fixture?.date?.toDate?.() || null;
  const round = Math.max(1, Number(fixture?.round || 1));
  if (!startDate) return null;
  return new Date(startDate.getTime() + (round - 1) * 24 * 60 * 60 * 1000);
}

function parseLeagueOrder(name, fallback) {
  const match = String(name || '').match(/lig\s+(\d+)/i);
  if (match) return Number(match[1]);
  return fallback;
}

function normalizeReason(value) {
  return String(value || '').trim();
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : null;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function isActionableFixture(fixture) {
  const status = String(fixture?.status || '').trim().toLowerCase();
  const live = fixture?.live || {};
  const liveState = String(live?.state || '').trim().toLowerCase();
  const liveReason = normalizeReason(live?.reason);
  if (status === 'played') return false;
  if (status === 'failed') return true;
  if (liveState.endsWith('_failed')) return true;
  if (status !== 'scheduled') return false;
  if (liveState === 'rescheduled') return true;
  if (liveReason === 'manual_backlog_replay') return true;
  if (live?.rescheduleCount) return true;
  if (live?.previousReason) return true;
  if (liveReason.startsWith('auto_rescheduled:')) return true;
  if (liveReason.startsWith('outage_rescheduled:')) return true;
  if (status === 'running') {
    const attemptedReplay =
      Boolean(live?.manualReplayQueuedAt || live?.manualReplaySlotIso || live?.manualReplayOriginalDateIso || live?.manualReplayRestoredAt) ||
      liveReason === 'manual_backlog_replay';
    const startedAtMs = toMillis(live?.startedAt) || toMillis(live?.manualReplayQueuedAt);
    const minuteUpdatedAtMs = toMillis(live?.minuteUpdatedAt);
    const minute = Number(live?.minute);
    const staleNoProgress =
      attemptedReplay &&
      startedAtMs != null &&
      Date.now() - startedAtMs > 5 * 60 * 1000 &&
      (!Number.isFinite(minute) || minute <= 0) &&
      (minuteUpdatedAtMs == null || minuteUpdatedAtMs <= startedAtMs);
    if (staleNoProgress) return true;
  }
  return false;
}

async function buildBacklog() {
  const leaguesSnap = await db.collection('leagues').where('state', 'in', ['scheduled', 'active']).get();
  const groups = new Map();
  let actionableCount = 0;

  for (let leagueIndex = 0; leagueIndex < leaguesSnap.docs.length; leagueIndex += 1) {
    const leagueDoc = leaguesSnap.docs[leagueIndex];
    const league = leagueDoc.data();
    const leagueName = String(league?.name || leagueDoc.id);
    const leagueOrder = parseLeagueOrder(leagueName, leagueIndex + 1);
    const fixturesSnap = await leagueDoc.ref.collection('fixtures').get();

    for (const fixtureDoc of fixturesSnap.docs) {
      const fixture = fixtureDoc.data();
      if (!isActionableFixture(fixture)) continue;
      actionableCount += 1;
      const originalDate = originalFixtureDate(league, fixture);
      if (!originalDate) continue;
      const dayKey = trDayKey(originalDate);
      const dayLabel = trDayLabel(originalDate);
      const groupKey = `${dayKey}|${String(leagueOrder).padStart(4, '0')}|${leagueName}|${leagueDoc.id}`;
      let group = groups.get(groupKey);
      if (!group) {
        group = {
          key: groupKey,
          dayKey,
          dayLabel,
          leagueId: leagueDoc.id,
          leagueName,
          leagueOrder,
          kickoffHourTR: Number(league?.kickoffHourTR || 0) || 0,
          fixtures: [],
        };
        groups.set(groupKey, group);
      }
      group.fixtures.push({
        leagueId: leagueDoc.id,
        leagueName,
        leagueOrder,
        originalDayKey: dayKey,
        originalDayLabel: dayLabel,
        currentKickoffDate: fixture?.date?.toDate?.() || null,
        ref: fixtureDoc.ref,
        id: fixtureDoc.id,
        fixture,
      });
    }
  }

  const sortedGroups = Array.from(groups.values())
    .map((group) => ({
      ...group,
      fixtures: group.fixtures.sort((a, b) => {
        const roundDiff = Number(a.fixture?.round || 0) - Number(b.fixture?.round || 0);
        if (roundDiff !== 0) return roundDiff;
        return a.id.localeCompare(b.id);
      }),
    }))
    .sort((a, b) => {
      if (a.dayKey !== b.dayKey) return a.dayKey.localeCompare(b.dayKey);
      if (a.leagueOrder !== b.leagueOrder) return a.leagueOrder - b.leagueOrder;
      return a.leagueName.localeCompare(b.leagueName, 'tr');
    });

  return { actionableCount, groups: sortedGroups };
}

function selectBatch(groups, limit) {
  const selected = [];
  let total = 0;
  for (const group of groups) {
    const size = group.fixtures.length;
    if (selected.length > 0 && total + size > limit) break;
    selected.push(group);
    total += size;
    if (total >= limit) break;
  }
  return { groups: selected, total };
}

function printBacklogSummary(backlog, limitGroups = 50) {
  const lines = [];
  lines.push(`Actionable backlog: ${backlog.actionableCount} mac`);
  const slice = backlog.groups.slice(0, limitGroups);
  for (const group of slice) {
    lines.push(`${group.dayLabel} ${group.leagueName}: ${group.fixtures.length} mac`);
  }
  if (backlog.groups.length > limitGroups) {
    lines.push(`... ${backlog.groups.length - limitGroups} grup daha var`);
  }
  return lines.join('\n');
}

function isRetryableReplayError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('no_free_slot') ||
    message.includes('allocation_not_found') ||
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('socket hang up')
  );
}

async function withTransientRetry(label, operation) {
  let lastError = null;
  for (let attempt = 1; attempt <= transientRetryCount; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableReplayError(error) || attempt >= transientRetryCount) {
        throw error;
      }
      console.warn(
        `[retry] ${label} attempt=${attempt}/${transientRetryCount} reason=${String(error?.message || error)} wait=${transientRetryDelaySeconds}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, transientRetryDelaySeconds * 1000));
    }
  }
  throw lastError || new Error(`${label}:retry_exhausted`);
}

function buildManualSlots(count) {
  const now = new Date();
  const specialHours = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 20, 21, 22, 23];
  const slots = [];
  for (let dayOffset = 0; slots.length < count + 4 && dayOffset < 10; dayOffset += 1) {
    const dayBase = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const dayKey = formatInTimeZone(dayBase, TZ, 'yyyy-MM-dd');
    for (const hour of specialHours) {
      const slotDate = new Date(`${dayKey}T${String(hour).padStart(2, '0')}:00:00+03:00`);
      if (slotDate.getTime() < now.getTime() + 5 * 60 * 1000) continue;
      slots.push(slotDate);
      if (slots.length >= count + 4) break;
    }
  }
  if (!slots.length) throw new Error('manual_replay_slot_not_found');
  return slots;
}

async function findAvailableManualSlot(batchIndex) {
  const replayHours = [12, 15, 16, 17, 18, 19, 20, 21, 22, 23];
  const zeroBased = Math.max(0, batchIndex - 1);
  const leagueRefs = await db.collection('leagues').get();

  for (let slotIndex = zeroBased; slotIndex < zeroBased + 120; slotIndex += 1) {
    const dayOffset = 30 + Math.floor(slotIndex / replayHours.length);
    const hour = replayHours[slotIndex % replayHours.length];
    const dayBase = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
    const dayKey = formatInTimeZone(dayBase, TZ, 'yyyy-MM-dd');
    const slotDate = new Date(`${dayKey}T${String(hour).padStart(2, '0')}:00:00+03:00`);
    const slotTs = Timestamp.fromDate(slotDate);

    let occupied = false;
    for (const leagueDoc of leagueRefs.docs) {
      const existing = await leagueDoc.ref.collection('fixtures').where('date', '==', slotTs).limit(1).get();
      if (!existing.empty) {
        occupied = true;
        break;
      }
    }

    if (!occupied) return slotDate;
  }

  throw new Error('manual_replay_slot_not_found');
}

async function assignBatchSlot(batchGroups, slotDate) {
  const entries = batchGroups.flatMap((group) => group.fixtures);
  for (const entry of entries) {
    const patch = {
      status: 'scheduled',
      date: Timestamp.fromDate(slotDate),
      'live.state': 'rescheduled',
      'live.reason': 'manual_backlog_replay',
      'live.lastLifecycleAt': FieldValue.serverTimestamp(),
      'live.manualReplayQueuedAt': FieldValue.serverTimestamp(),
      'live.manualReplaySlotIso': slotDate.toISOString(),
      'live.retryCount': 0,
      'live.startedAt': FieldValue.delete(),
      'live.endedAt': FieldValue.delete(),
      'live.matchId': FieldValue.delete(),
      'live.requestToken': FieldValue.delete(),
      'live.allocatedAt': FieldValue.delete(),
      'live.serverIp': FieldValue.delete(),
      'live.serverPort': FieldValue.delete(),
      'live.nodeId': FieldValue.delete(),
      'live.prewarmedAt': FieldValue.delete(),
      'live.kickoffAttemptedAt': FieldValue.delete(),
      'live.resultMissing': FieldValue.delete(),
      'live.manualReplayMatchId': FieldValue.delete(),
    };
    if (entry.currentKickoffDate instanceof Date) {
      patch['live.manualReplayOriginalDateIso'] = entry.currentKickoffDate.toISOString();
    }
    if (entry.fixture?.live?.reason) {
      patch['live.previousReason'] = entry.fixture.live.reason;
    }
    await entry.ref.update(patch);
  }
}

async function restoreBatchDates(batchGroups) {
  for (const entry of batchGroups.flatMap((group) => group.fixtures)) {
    if (!(entry.currentKickoffDate instanceof Date)) continue;
    await entry.ref.set({
      date: Timestamp.fromDate(entry.currentKickoffDate),
      live: {
        manualReplayRestoredAt: FieldValue.serverTimestamp(),
      },
    }, { merge: true });
  }
}

async function restoreCompletedManualReplayDates() {
  const leaguesSnap = await db.collection('leagues').where('state', 'in', ['scheduled', 'active']).get();
  let restored = 0;

  for (const leagueDoc of leaguesSnap.docs) {
    const fixturesSnap = await leagueDoc.ref
      .collection('fixtures')
      .where('live.reason', '==', 'manual_backlog_replay')
      .get();

    for (const fixtureDoc of fixturesSnap.docs) {
      const fixture = fixtureDoc.data();
      const originalIso = String(fixture?.live?.manualReplayOriginalDateIso || '').trim();
      if (!originalIso) continue;

      const status = String(fixture?.status || '').trim().toLowerCase();
      const liveState = String(fixture?.live?.state || '').trim().toLowerCase();
      const isTerminal =
        status === 'played' ||
        status === 'failed' ||
        liveState === 'ended' ||
        liveState === 'released' ||
        liveState.endsWith('_failed');

      if (!isTerminal) continue;

      const currentIso = fixture?.date?.toDate?.()?.toISOString?.() || '';
      if (currentIso === originalIso && fixture?.live?.manualReplayRestoredAt) {
        continue;
      }

      await fixtureDoc.ref.update({
        date: Timestamp.fromDate(new Date(originalIso)),
        'live.manualReplayRestoredAt': FieldValue.serverTimestamp(),
      });
      restored += 1;
    }
  }

  return restored;
}

function buildRequestToken(matchId, seasonId) {
  const issuedAtMs = Date.now();
  const payload = `${matchId}:${seasonId}:${issuedAtMs}`;
  const sig = createHmac('sha256', BATCH_SECRET).update(payload).digest('hex');
  return `${issuedAtMs}.${sig}`;
}

function buildMatchControlUrl(pathname) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${MATCH_CONTROL_BASE_URL}${normalizedPath}`;
}

async function callMatchControlJson(pathname, init) {
  const response = await fetch(buildMatchControlUrl(pathname), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MATCH_CONTROL_SECRET}`,
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`match-control ${pathname} failed (${response.status}): ${text || '<empty>'}`);
  }
  return response.json();
}

async function callFunctionsJson(functionName, body) {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`function ${functionName} failed (${response.status}): ${text || '<empty>'}`);
  }
  return response.json();
}

async function buildTeamPayload(teamId, ownerUid, data) {
  const baseData = data && typeof data === 'object' ? { ...data } : {};
  if (ownerUid) {
    const inventorySnap = await db.doc(`users/${ownerUid}/inventory/consumables`).get();
    if (inventorySnap.exists) {
      const inventoryData = inventorySnap.data() || {};
      const kits = inventoryData?.kits && typeof inventoryData.kits === 'object' ? inventoryData.kits : {};
      baseData.consumables = {
        energy: Number(kits.energy ?? 0) || 0,
        morale: Number(kits.morale ?? 0) || 0,
        health: Number(kits.health ?? 0) || 0,
      };
    }
  }
  return buildUnityRuntimeTeamPayload(teamId, baseData);
}

function normalizeTeamId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isSlotTeamId(teamId) {
  return teamId.startsWith('slot-');
}

async function resolveSlotTeamId(leagueId, slotValue) {
  const slot = Number(slotValue);
  if (!Number.isFinite(slot) || slot <= 0) return null;
  const slotSnap = await db.doc(`leagues/${leagueId}/slots/${slot}`).get();
  if (!slotSnap.exists) return null;
  const slotData = slotSnap.data() || {};
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

async function resolveFixtureTeams(leagueId, fixture) {
  let homeTeamId = normalizeTeamId(fixture?.homeTeamId);
  let awayTeamId = normalizeTeamId(fixture?.awayTeamId);

  if (homeTeamId && isSlotTeamId(homeTeamId)) {
    homeTeamId = await resolveSlotTeamId(leagueId, homeTeamId.replace('slot-', ''));
  }
  if (awayTeamId && isSlotTeamId(awayTeamId)) {
    awayTeamId = await resolveSlotTeamId(leagueId, awayTeamId.replace('slot-', ''));
  }
  if (!homeTeamId) {
    homeTeamId = await resolveSlotTeamId(leagueId, fixture?.homeSlot);
  }
  if (!awayTeamId) {
    awayTeamId = await resolveSlotTeamId(leagueId, fixture?.awaySlot);
  }

  return { homeTeamId, awayTeamId };
}

async function loadTeamBundle(teamId) {
  const teamSnap = await db.doc(`teams/${teamId}`).get();
  if (!teamSnap.exists) return null;
  const raw = teamSnap.data() || {};
  const ownerUid = typeof raw?.ownerUid === 'string' && raw.ownerUid.trim() ? raw.ownerUid.trim() : null;
  return {
    teamId,
    ownerUid,
    payload: await buildTeamPayload(teamId, ownerUid, raw),
    raw,
  };
}

async function ensureMatchPlanSnapshot(matchId, leagueId, seasonId, fixture, home, away, kickoffAt) {
  const planRef = db.doc(`matchPlans/${matchId}`);
  const existing = await planRef.get();
  if (existing.exists) return;
  await planRef.create({
    matchId,
    leagueId,
    seasonId,
    createdAt: FieldValue.serverTimestamp(),
    rngSeed: fixture?.seed || Math.floor(Math.random() * 1e9),
    kickoffUtc: kickoffAt,
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

async function getSignedWriteUrl(storagePath, contentType) {
  const [url] = await bucket.file(storagePath).getSignedUrl({
    action: 'write',
    expires: Date.now() + 3 * 60 * 60 * 1000,
    contentType,
  });
  return url;
}

async function createMediaBundle(leagueId, seasonId, matchId) {
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

async function resetFixtureForManualReplay(entry, kickoffDate) {
  const fixture = entry.fixture;
  const live = fixture?.live || {};
  const patch = {
    status: 'scheduled',
    date: Timestamp.fromDate(kickoffDate),
    videoMissing: true,
    videoError: FieldValue.delete(),
    'live.state': 'scheduled',
    'live.reason': 'manual_backlog_replay',
    'live.manualReplayQueuedAt': FieldValue.serverTimestamp(),
    'live.lastLifecycleAt': FieldValue.serverTimestamp(),
    'live.retryCount': 0,
    'live.startedAt': FieldValue.delete(),
    'live.endedAt': FieldValue.delete(),
    'live.matchId': FieldValue.delete(),
    'live.requestToken': FieldValue.delete(),
    'live.allocatedAt': FieldValue.delete(),
    'live.serverIp': FieldValue.delete(),
    'live.serverPort': FieldValue.delete(),
    'live.nodeId': FieldValue.delete(),
    'live.prewarmedAt': FieldValue.delete(),
    'live.kickoffAttemptedAt': FieldValue.delete(),
    'live.resultMissing': FieldValue.delete(),
    'live.manualReplayMatchId': FieldValue.delete(),
  };
  if (live?.reason) {
    patch['live.previousReason'] = live.reason;
  }
  await entry.ref.update(patch);
}

async function prepareFixture(entry, kickoffDate) {
  await resetFixtureForManualReplay(entry, kickoffDate);

  const fixtureSnap = await entry.ref.get();
  const fixture = fixtureSnap.data() || {};
  const seasonId = String(fixture?.seasonId ?? fixture?.season ?? 'default');
  const replaySeed = toMillis(fixture?.live?.manualReplayQueuedAt) || Date.now();
  const matchId = `lgr_${entry.id}_${replaySeed.toString(36)}`;
  const storageId = entry.id;
  const { homeTeamId, awayTeamId } = await resolveFixtureTeams(entry.leagueId, fixture);
  if (!homeTeamId || !awayTeamId) {
    throw new Error(`missing_team_ids:${entry.id}`);
  }

  const [home, away] = await Promise.all([
    loadTeamBundle(homeTeamId),
    loadTeamBundle(awayTeamId),
  ]);
  if (!home || !away) {
    throw new Error(`missing_team_docs:${entry.id}`);
  }

  await ensureMatchPlanSnapshot(matchId, entry.leagueId, seasonId, fixture, home, away, kickoffDate.toISOString());
  const media = await createMediaBundle(entry.leagueId, seasonId, storageId);
  const requestToken = buildRequestToken(storageId, seasonId);
  const response = await withTransientRetry(`prepare:${entry.id}`, async () =>
    callMatchControlJson('/v1/league/prepare-slot', {
      method: 'POST',
      body: JSON.stringify({
        matchId,
        forceNewMatch: true,
        leagueId: entry.leagueId,
        fixtureId: entry.id,
        seasonId,
        homeTeamId,
        awayTeamId,
        homeUserId: home.ownerUid,
        awayUserId: away.ownerUid,
        kickoffAt: kickoffDate.toISOString(),
        homeTeamPayload: home.payload,
        awayTeamPayload: away.payload,
        resultUploadUrl: media.resultUploadUrl,
        replayUploadUrl: media.replayUploadUrl,
        videoUploadUrl: media.videoUploadUrl,
        requestToken,
      }),
    }),
  );

  await entry.ref.set({
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
      retryCount: 0,
      manualReplayMatchId: response.matchId || matchId,
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

  return { matchId: response.matchId || matchId };
}

async function kickoffFixture(entry) {
  const snap = await entry.ref.get();
  const fixture = snap.data() || {};
  const live = fixture?.live || {};
  if (!live?.matchId) {
    throw new Error(`missing_live_match:${entry.id}`);
  }
  const response = await withTransientRetry(`kickoff:${entry.id}`, async () =>
    callMatchControlJson('/v1/league/kickoff-slot', {
      method: 'POST',
      body: JSON.stringify({ matchId: live.matchId }),
    }),
  );
  await entry.ref.set({
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
  return response;
}

async function getInternalMatch(matchId) {
  try {
    const response = await callMatchControlJson(`/v1/internal/matches/${encodeURIComponent(matchId)}`, {
      method: 'GET',
    });
    return response?.match || null;
  } catch {
    return null;
  }
}

async function getMatchStatus(matchId) {
  try {
    return await callMatchControlJson(`/v1/matches/${encodeURIComponent(matchId)}/status`, {
      method: 'GET',
    });
  } catch {
    return null;
  }
}

async function monitorBatch(batchGroups, kickoffDate) {
  const deadline = Date.now() + batchWindowMinutes * 60 * 1000;
  const entries = batchGroups.flatMap((group) => group.fixtures);

  while (Date.now() < deadline) {
    let played = 0;
    for (const entry of entries) {
      const snap = await entry.ref.get();
      const fixture = snap.data() || {};
      const status = String(fixture?.status || '').trim().toLowerCase();
      const live = fixture?.live || {};
      const matchId = String(live?.matchId || entry.id);

      if (status === 'failed' || String(live?.state || '').trim().toLowerCase() === 'failed') {
        return {
          ok: false,
          failedEntry: entry,
          reason: normalizeReason(live?.reason) || 'fixture_failed',
          observedAt: new Date().toISOString(),
        };
      }

      const matchStatus = await getMatchStatus(matchId);
      if (String(matchStatus?.state || '').trim().toLowerCase() === 'failed') {
        const internal = await getInternalMatch(matchId);
        return {
          ok: false,
          failedEntry: entry,
          reason: normalizeReason(internal?.endedReason) || 'match_control_failed',
          observedAt: new Date().toISOString(),
        };
      }

      const runningState = String(matchStatus?.state || '').trim().toLowerCase();
      const startedAtMs = toMillis(live?.startedAt);
      const minuteUpdatedAtMs = toMillis(live?.minuteUpdatedAt) || toMillis(matchStatus?.minuteUpdatedAt);
      const minute = Number(live?.minute ?? matchStatus?.minute);
      const staleNoProgress =
        (status === 'running' || runningState === 'running' || runningState === 'server_started') &&
        startedAtMs != null &&
        Date.now() - startedAtMs > 5 * 60 * 1000 &&
        (!Number.isFinite(minute) || minute <= 0) &&
        (minuteUpdatedAtMs == null || minuteUpdatedAtMs <= startedAtMs);
      if (staleNoProgress) {
        return {
          ok: false,
          failedEntry: entry,
          reason: 'minute_progress_missing',
          observedAt: new Date().toISOString(),
        };
      }

      if (status === 'played' || String(matchStatus?.state || '').trim().toLowerCase() === 'ended') {
        played += 1;
      }
    }

    if (played === entries.length) {
      return {
        ok: true,
        completed: entries.length,
        observedAt: new Date().toISOString(),
        kickoffAt: kickoffDate.toISOString(),
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
  }

  return {
    ok: true,
    completed: null,
    observedAt: new Date().toISOString(),
    kickoffAt: kickoffDate.toISOString(),
    timedWindow: true,
  };
}

async function runBatch(batchIndex, batchGroups) {
  const kickoffDate = await findAvailableManualSlot(batchIndex);
  const slotDay = formatInTimeZone(kickoffDate, TZ, 'yyyy-MM-dd');
  const slotHour = Number(formatInTimeZone(kickoffDate, TZ, 'H'));
  const entries = batchGroups.flatMap((group) => group.fixtures);
  console.log(`\n=== Batch ${batchIndex} basliyor @ ${kickoffDate.toISOString()} ===`);
  for (const group of batchGroups) {
    console.log(`${group.dayLabel} ${group.leagueName}: ${group.fixtures.length} mac`);
  }

  try {
    await assignBatchSlot(batchGroups, kickoffDate);
  } catch (error) {
    return {
      ok: false,
      stage: 'assign_slot',
      failedEntry: batchGroups[0]?.fixtures?.[0] || null,
      reason: error?.message || String(error),
    };
  }

  try {
    let prepared = 0;
    for (const entry of entries) {
      try {
        await prepareFixture(entry, kickoffDate);
        prepared += 1;
      } catch (error) {
        return {
          ok: false,
          stage: 'prepare',
          failedEntry: entry,
          reason: error?.message || String(error),
        };
      }
    }

    if (prepared !== entries.length) {
      return {
        ok: false,
        stage: 'prepare',
        failedEntry: batchGroups[0]?.fixtures?.[0] || null,
        reason: `prepared_count_mismatch:${prepared}/${entries.length}`,
      };
    }

    let started = 0;
    for (const entry of entries) {
      try {
        await kickoffFixture(entry);
        started += 1;
      } catch (error) {
        return {
          ok: false,
          stage: 'kickoff',
          failedEntry: entry,
          reason: error?.message || String(error),
        };
      }
    }

    if (started !== entries.length) {
      return {
        ok: false,
        stage: 'kickoff',
        failedEntry: batchGroups[0]?.fixtures?.[0] || null,
        reason: `started_count_mismatch:${started}/${entries.length}`,
      };
    }
  } catch (error) {
    return {
      ok: false,
      stage: 'prepare_or_kickoff',
      failedEntry: batchGroups[0]?.fixtures?.[0] || null,
      reason: error?.message || String(error),
    };
  }

  const result = await monitorBatch(batchGroups, kickoffDate);
  if (result.ok) {
    await restoreBatchDates(batchGroups);
  }
  return result;
}

async function main() {
  const initialRestored = await restoreCompletedManualReplayDates();
  if (initialRestored > 0) {
    console.log(`Restore edilen tamamlanmis replay fiksturu: ${initialRestored}`);
  }

  const backlog = await buildBacklog();
  const summary = printBacklogSummary(backlog);
  console.log(summary);

  if (mode === 'list') {
    return;
  }

  let batchIndex = 0;
  while (true) {
    const restored = await restoreCompletedManualReplayDates();
    if (restored > 0) {
      console.log(`Restore edilen tamamlanmis replay fiksturu: ${restored}`);
    }

    const currentBacklog = await buildBacklog();
    if (!currentBacklog.groups.length) {
      console.log('Actionable backlog kalmadi.');
      return;
    }

    const batch = selectBatch(currentBacklog.groups, batchSize);
    if (!batch.groups.length) {
      console.log('Secilecek batch kalmadi.');
      return;
    }

    batchIndex += 1;
    const result = await runBatch(batchIndex, batch.groups);
    if (!result.ok) {
      const entry = result.failedEntry;
      console.error(JSON.stringify({
        ok: false,
        batchIndex,
        stage: result.stage || 'monitor',
        leagueId: entry?.leagueId || null,
        leagueName: entry?.leagueName || null,
        fixtureId: entry?.id || null,
        originalDay: entry?.originalDayLabel || null,
        reason: result.reason || 'unknown',
      }, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify({
      ok: true,
      batchIndex,
      completed: result.completed,
      kickoffAt: result.kickoffAt,
      observedAt: result.observedAt,
      timedWindow: Boolean(result.timedWindow),
    }, null, 2));

    if (maxBatches > 0 && batchIndex >= maxBatches) {
      return;
    }

    console.log(`Sonraki batch icin ${batchWindowMinutes} dakika bekleniyor.`);
    await new Promise((resolve) => setTimeout(resolve, batchWindowMinutes * 60 * 1000));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
