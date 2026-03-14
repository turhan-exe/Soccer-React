import fs from 'node:fs';
import crypto from 'node:crypto';
import admin from 'firebase-admin';

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function hashString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clampByte(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHex(r, g, b) {
  const channel = (value) => clampByte(value).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255,
  };
}

function luminance(rgb) {
  return ((0.2126 * rgb.r) + (0.7152 * rgb.g) + (0.0722 * rgb.b)) / 255;
}

function deriveKitColors(seedSource) {
  const hash = hashString(seedSource || 'team');
  const hue = hash % 360;
  const primary = hsvToRgb(hue, 0.72, 0.82);
  const primaryLuma = luminance(primary);
  let secondary = hsvToRgb(hue, primaryLuma > 0.45 ? 0.3 : 0.18, primaryLuma > 0.45 ? 0.22 : 0.84);
  if (Math.abs(primaryLuma - luminance(secondary)) < 0.28) {
    secondary = hsvToRgb((hue + 180) % 360, 0.18, primaryLuma > 0.45 ? 0.2 : 0.86);
  }

  const keeper = hsvToRgb((hue + 110) % 360, 0.68, 0.7);
  const keeperAlt = hsvToRgb((hue + 140) % 360, 0.35, 0.28);
  return {
    primary: rgbToHex(primary.r, primary.g, primary.b),
    secondary: rgbToHex(secondary.r, secondary.g, secondary.b),
    text: primaryLuma > 0.62 ? '#111111' : '#ffffff',
    gkPrimary: rgbToHex(keeper.r, keeper.g, keeper.b),
    gkSecondary: rgbToHex(keeperAlt.r, keeperAlt.g, keeperAlt.b),
  };
}

function toUnityStatValue(value) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric <= 1.5) return Math.max(0, Math.min(100, Math.round(numeric * 100)));
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function toUnityHeightValue(value) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 180;
  return Math.max(150, Math.min(210, Math.round(numeric)));
}

function toUnityWeightValue(value) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 75;
  return Math.max(45, Math.min(110, Math.round(numeric)));
}

function normalizeIdList(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value)).filter(Boolean);
}

function stableSortPlayers(players) {
  return [...players].sort((left, right) => {
    const roleRank = (player) => {
      if (player?.squadRole === 'starting') return 0;
      if (player?.squadRole === 'bench') return 1;
      return 2;
    };

    const leftOrder = Number.isFinite(left?.order) ? Number(left.order) : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right?.order) ? Number(right.order) : Number.MAX_SAFE_INTEGER;
    return roleRank(left) - roleRank(right) || leftOrder - rightOrder || String(left?.id || '').localeCompare(String(right?.id || ''));
  });
}

function pickPlayersById(ids, pool) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const byId = new Map(pool.map((player) => [String(player?.id ?? player?.uniqueId ?? ''), player]));
  const result = [];
  for (const id of ids) {
    const player = byId.get(String(id));
    if (player) result.push(player);
  }
  return result;
}

function createFallbackPlayer(id, name, squadRole) {
  return {
    id,
    name,
    position: 'CM',
    roles: ['CM'],
    overall: 50,
    potential: 50,
    attributes: {
      strength: 50,
      acceleration: 50,
      topSpeed: 50,
      dribbleSpeed: 50,
      jump: 50,
      tackling: 50,
      ballKeeping: 50,
      passing: 50,
      longBall: 50,
      agility: 50,
      shooting: 50,
      shootPower: 50,
      positioning: 50,
      reaction: 50,
      ballControl: 50,
    },
    age: 20,
    height: 180,
    weight: 75,
    condition: 100,
    motivation: 100,
    squadRole,
  };
}

function toUnityPlayerPayload(player, order) {
  return {
    playerId: String(player?.uniqueId || player?.id || `p_${order}`),
    name: String(player?.name || `Player ${order + 1}`),
    order,
    attributes: {
      strength: toUnityStatValue(player?.attributes?.strength),
      acceleration: toUnityStatValue(player?.attributes?.acceleration),
      topSpeed: toUnityStatValue(player?.attributes?.topSpeed),
      dribbleSpeed: toUnityStatValue(player?.attributes?.dribbleSpeed),
      jump: toUnityStatValue(player?.attributes?.jump),
      tackling: toUnityStatValue(player?.attributes?.tackling),
      ballKeeping: toUnityStatValue(player?.attributes?.ballKeeping),
      passing: toUnityStatValue(player?.attributes?.passing),
      longBall: toUnityStatValue(player?.attributes?.longBall),
      agility: toUnityStatValue(player?.attributes?.agility),
      shooting: toUnityStatValue(player?.attributes?.shooting),
      shootPower: toUnityStatValue(player?.attributes?.shootPower),
      positioning: toUnityStatValue(player?.attributes?.positioning),
      reaction: toUnityStatValue(player?.attributes?.reaction),
      ballControl: toUnityStatValue(player?.attributes?.ballControl),
      height: toUnityHeightValue(player?.height),
      weight: toUnityWeightValue(player?.weight),
    },
  };
}

function resolveFormation(data) {
  return String(data?.lineup?.formation || data?.plan?.formation || data?.lineup?.shape || data?.plan?.shape || '4-2-3-1');
}

function resolvePlan(data) {
  const starters = normalizeIdList(data?.lineup?.starters || data?.plan?.starters);
  const subs = normalizeIdList(data?.lineup?.subs || data?.plan?.bench || data?.plan?.subs);
  const reserves = normalizeIdList(data?.lineup?.reserves || data?.plan?.reserves);
  const formation = resolveFormation(data);
  const tactics = data?.lineup?.tactics || data?.plan?.tactics;
  return {
    formation,
    tactics: tactics && typeof tactics === 'object' ? tactics : undefined,
    starters: starters.length ? starters : undefined,
    subs: subs.length ? subs : undefined,
    bench: subs.length ? subs : undefined,
    reserves: reserves.length ? reserves : undefined,
  };
}

function buildTeamPayload(teamId, data) {
  const teamName = String(data?.name || data?.clubName || teamId);
  const allPlayers = stableSortPlayers(Array.isArray(data?.players) ? data.players : []);
  const lineupIds = normalizeIdList(data?.lineup?.starters || data?.plan?.starters);
  const benchIds = normalizeIdList(data?.lineup?.subs || data?.plan?.bench || data?.plan?.subs);
  const reserveIds = normalizeIdList(data?.lineup?.reserves || data?.plan?.reserves);

  let lineupPlayers = pickPlayersById(lineupIds, allPlayers);
  let benchPlayers = [...pickPlayersById(benchIds, allPlayers), ...pickPlayersById(reserveIds, allPlayers)];

  if (lineupPlayers.length === 0) {
    lineupPlayers = allPlayers.filter((player) => player?.squadRole === 'starting').slice(0, 11);
  }

  const selectedIds = new Set(lineupPlayers.map((player) => String(player?.id ?? player?.uniqueId ?? '')));

  if (benchPlayers.length === 0) {
    benchPlayers = allPlayers.filter((player) => !selectedIds.has(String(player?.id ?? player?.uniqueId ?? '')) && player?.squadRole !== 'starting');
  } else {
    benchPlayers = benchPlayers.filter((player) => !selectedIds.has(String(player?.id ?? player?.uniqueId ?? '')));
  }

  for (const player of allPlayers) {
    if (lineupPlayers.length >= 11) break;
    const playerId = String(player?.id ?? player?.uniqueId ?? '');
    if (!selectedIds.has(playerId)) {
      lineupPlayers.push(player);
      selectedIds.add(playerId);
    }
  }

  while (lineupPlayers.length < 11) {
    const fakeId = `bot_lineup_${lineupPlayers.length}`;
    lineupPlayers.push(createFallbackPlayer(fakeId, `Player ${lineupPlayers.length + 1}`, 'starting'));
    selectedIds.add(fakeId);
  }

  const benchSelectedIds = new Set(selectedIds);
  for (const player of allPlayers) {
    const playerId = String(player?.id ?? player?.uniqueId ?? '');
    if (benchSelectedIds.has(playerId)) continue;
    benchPlayers.push(player);
    benchSelectedIds.add(playerId);
  }

  const seed = `${teamId}:${teamName}`;
  return {
    id: teamId,
    teamId,
    name: teamName,
    clubName: String(data?.clubName || data?.name || teamId),
    manager: data?.manager,
    isBot: data?.isBot,
    botId: data?.botId,
    badge: data?.badge,
    logo: data?.logo ?? null,
    players: Array.isArray(data?.players) ? data.players : undefined,
    plan: resolvePlan(data),
    teamKey: teamId,
    teamName,
    formation: resolveFormation(data),
    kit: deriveKitColors(seed),
    lineup: lineupPlayers.slice(0, 11).map((player, index) => toUnityPlayerPayload(player, index)),
    bench: benchPlayers.map((player, index) => toUnityPlayerPayload(player, 11 + index)),
  };
}

const serviceAccountPath = process.env.FIREBASE_SA_PATH || readArg('service-account');
const matchControlSecret = process.env.MATCH_CONTROL_SECRET || readArg('match-control-secret');
const callbackToken = process.env.MATCH_CONTROL_CALLBACK_TOKEN || readArg('callback-token');
const baseUrl = readArg('base-url', 'http://89.167.24.132:8080');
const leagueId = readArg('league-id');
const homeTeamId = readArg('home-team-id');
const awayTeamId = readArg('away-team-id');
const fixtureId = readArg('fixture-id', `livewatch_${Date.now().toString(36)}`);
const seasonId = readArg('season-id', `livewatch-season-${new Date().toISOString().slice(0, 10)}`);
const kickoffAt = readArg('kickoff-at', '2026-03-11T17:00:00+03:00');
const kickoffHourTR = Number(readArg('kickoff-hour-tr', '17'));
const round = Number(readArg('round', '999'));

if (!serviceAccountPath || !matchControlSecret || !callbackToken || !leagueId || !homeTeamId || !awayTeamId) {
  throw new Error('missing_required_args');
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const [homeSnap, awaySnap] = await Promise.all([
  db.doc(`teams/${homeTeamId}`).get(),
  db.doc(`teams/${awayTeamId}`).get(),
]);

if (!homeSnap.exists || !awaySnap.exists) {
  throw new Error('team_docs_missing');
}

const homeData = homeSnap.data();
const awayData = awaySnap.data();
const homeUserId = homeTeamId;
const awayUserId = awayTeamId;
const kickoffDate = new Date(kickoffAt);
const fixtureRef = db.doc(`leagues/${leagueId}/fixtures/${fixtureId}`);

await fixtureRef.set(
  {
    date: Timestamp.fromDate(kickoffDate),
    kickoffAt: kickoffDate.toISOString(),
    kickoffHourTR,
    round,
    seasonId,
    homeTeamId,
    awayTeamId,
    homeUserId,
    awayUserId,
    participants: [homeTeamId, awayTeamId],
    status: 'scheduled',
    score: null,
    __liveWatchTemp: true,
    updatedAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
);

const prepareResp = await fetch(`${baseUrl}/v1/league/prepare-slot`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${matchControlSecret}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    leagueId,
    fixtureId,
    matchId: fixtureId,
    seasonId,
    kickoffAt: kickoffDate.toISOString(),
    homeTeamId,
    awayTeamId,
    homeUserId,
    awayUserId,
    homeTeamPayload: buildTeamPayload(homeTeamId, homeData),
    awayTeamPayload: buildTeamPayload(awayTeamId, awayData),
    resultUploadUrl: `https://example.invalid/results/${fixtureId}.json`,
    replayUploadUrl: `https://example.invalid/replays/${fixtureId}.json`,
    videoUploadUrl: `https://example.invalid/videos/${fixtureId}.mp4`,
    requestToken: crypto.randomUUID(),
  }),
});

if (!prepareResp.ok) {
  throw new Error(`prepare_failed ${prepareResp.status} ${await prepareResp.text()}`);
}

const prepare = await prepareResp.json();
const matchId = prepare.matchId || fixtureId;

const kickoffResp = await fetch(`${baseUrl}/v1/league/kickoff-slot`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${matchControlSecret}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ matchId }),
});

if (!kickoffResp.ok) {
  throw new Error(`kickoff_failed ${kickoffResp.status} ${await kickoffResp.text()}`);
}

const kickoff = await kickoffResp.json();

await fixtureRef.set(
  {
    status: 'running',
    live: {
      matchId,
      state: kickoff?.state || prepare?.state || 'server_started',
      mode: 'league',
      createdAt: new Date().toISOString(),
      serverIp: prepare.serverIp ?? null,
      serverPort: prepare.serverPort ?? null,
      nodeId: prepare.nodeId ?? null,
      startedAt: FieldValue.serverTimestamp(),
      homeUserId,
      awayUserId,
    },
    updatedAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
);

console.log(
  JSON.stringify(
    {
      fixtureId,
      matchId,
      home: homeData?.name,
      away: awayData?.name,
      leagueId,
      state: kickoff?.state || prepare?.state || 'server_started',
      serverIp: prepare.serverIp ?? null,
      serverPort: prepare.serverPort ?? null,
    },
    null,
    2,
  ),
);
