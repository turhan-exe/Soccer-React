import "dotenv/config";
import crypto from "node:crypto";
import process from "node:process";
import Fastify from "fastify";
import cors from "@fastify/cors";
import Redis from "ioredis";
import pg from "pg";
import { applicationDefault, cert, getApps, initializeApp as initializeFirebaseAdminApp } from "firebase-admin/app";
import { getAuth as getFirebaseAuth } from "firebase-admin/auth";

const { Pool } = pg;

const fastify = Fastify({ logger: true });

function safeParseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeNodeAgentList(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const url = typeof item.url === "string" ? item.url.trim() : "";
      if (!url) return null;
      return {
        ...item,
        id: item.id || item.name || url,
        url,
        token: typeof item.token === "string" ? item.token.trim() : "",
      };
    })
    .filter(Boolean);
}

function mergeNodeAgentLists(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const node of list) {
      const key = String(node?.id || node?.name || node?.url || "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(node);
    }
  }
  return out;
}

function buildNodePoolsFromEnv(env) {
  const hasSharedEnv = Object.prototype.hasOwnProperty.call(env, "NODE_AGENTS");
  const hasFriendlyEnv = Object.prototype.hasOwnProperty.call(
    env,
    "NODE_AGENTS_FRIENDLY",
  );
  const hasLeagueEnv = Object.prototype.hasOwnProperty.call(
    env,
    "NODE_AGENTS_LEAGUE",
  );

  const shared = normalizeNodeAgentList(safeParseJson(env.NODE_AGENTS, []));
  const friendly = normalizeNodeAgentList(
    safeParseJson(env.NODE_AGENTS_FRIENDLY, []),
  );
  const league = normalizeNodeAgentList(
    safeParseJson(env.NODE_AGENTS_LEAGUE, []),
  );

  const fallbackShared =
    hasSharedEnv || shared.length
      ? shared
      : mergeNodeAgentLists(friendly, league);
  const effectiveFriendly = hasFriendlyEnv
    ? friendly
    : friendly.length
      ? friendly
      : fallbackShared;
  const effectiveLeague = hasLeagueEnv
    ? league
    : league.length
      ? league
      : fallbackShared;
  const all = mergeNodeAgentLists(
    fallbackShared,
    effectiveFriendly,
    effectiveLeague,
  );

  return {
    all,
    shared: fallbackShared,
    friendly: effectiveFriendly,
    league: effectiveLeague,
  };
}

const nodePools = buildNodePoolsFromEnv(process.env);

const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || "0.0.0.0",
  corsAllowedOrigins: String(
    process.env.CORS_ALLOWED_ORIGINS ||
      "http://localhost:5173,http://127.0.0.1:5173,http://localhost,capacitor://localhost",
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  apiSecret: process.env.MATCH_CONTROL_SECRET || "",
  callbackToken:
    process.env.MATCH_CONTROL_CALLBACK_TOKEN ||
    process.env.MATCH_CONTROL_SECRET ||
    "",
  signingKey:
    process.env.SESSION_SIGNING_KEY ||
    process.env.MATCH_CONTROL_SECRET ||
    "dev-signing-key",
  friendlyRequestTtlSec: Number(process.env.FRIENDLY_REQUEST_TTL_SEC || 120),
  joinTicketTtlSec: Number(process.env.JOIN_TICKET_TTL_SEC || 300),
  leagueJoinTicketTtlSec: Number(process.env.LEAGUE_JOIN_TICKET_TTL_SEC || 900),
  defaultFriendlyMaxClients: Number(process.env.FRIENDLY_MAX_CLIENTS || 2),
  defaultLeagueMaxClients: Number(process.env.LEAGUE_MAX_CLIENTS || 2),
  matchEndReleaseDelayMs: Number(process.env.MATCH_END_RELEASE_DELAY_MS || 90000),
  lifecycleCallbackBaseUrl: process.env.MATCH_CONTROL_CALLBACK_BASE_URL || "",
  firebaseLifecycleUrl: process.env.FIREBASE_LIFECYCLE_URL || "",
  firebaseLifecycleToken: process.env.FIREBASE_LIFECYCLE_TOKEN || "",
  firebaseProjectId:
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    "",
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
  nodeAgents: nodePools.all,
  nodeAgentsFriendly: nodePools.friendly,
  nodeAgentsLeague: nodePools.league,
};

fastify.register(cors, {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (
      config.corsAllowedOrigins.length === 0 ||
      config.corsAllowedOrigins.includes(origin)
    ) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
});

const memoryStore = {
  friendlyRequests: new Map(),
  matches: new Map(),
};

const pool =
  process.env.POSTGRES_URL || process.env.DATABASE_URL
    ? new Pool({
        connectionString:
          process.env.POSTGRES_URL || process.env.DATABASE_URL,
      })
    : null;

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    })
  : null;

let pgReady = false;
let redisReady = false;
const pendingMatchReleaseTimers = new Map();
const firebaseAuthClientByProject = new Map();

function toBase64(raw) {
  const input = String(raw || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return `${input}${padding}`;
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = Buffer.from(toBase64(parts[1]), "base64").toString("utf8");
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function inferFirebaseProjectIdFromToken(token) {
  const payload = decodeJwtPayload(token);
  const aud = typeof payload?.aud === "string" ? payload.aud.trim() : "";
  if (!aud) return null;
  return aud;
}

function getFirebaseAdminAuth(projectIdOverride = "") {
  const effectiveProjectId = String(
    projectIdOverride || config.firebaseProjectId || "",
  ).trim();
  const cacheKey = effectiveProjectId || "default";
  const cached = firebaseAuthClientByProject.get(cacheKey);
  if (cached) {
    return cached;
  }

  const appName = `match-control-${cacheKey}`;
  const existingApp = getApps().find((app) => app.name === appName);
  if (existingApp) {
    const authClient = getFirebaseAuth(existingApp);
    firebaseAuthClientByProject.set(cacheKey, authClient);
    return authClient;
  }

  const parsedServiceAccount = safeParseJson(config.firebaseServiceAccountJson, null);
  const appOptions = {};

  if (parsedServiceAccount && typeof parsedServiceAccount === "object") {
    appOptions.credential = cert(parsedServiceAccount);
  } else if (!effectiveProjectId) {
    try {
      appOptions.credential = applicationDefault();
    } catch {
      // Project-only initialize can still verify Firebase ID tokens via public keys.
    }
  }

  if (effectiveProjectId) {
    appOptions.projectId = effectiveProjectId;
  }

  const adminApp = initializeFirebaseAdminApp(appOptions, appName);
  const authClient = getFirebaseAuth(adminApp);
  firebaseAuthClientByProject.set(cacheKey, authClient);
  return authClient;
}

async function verifyFirebaseTokenWithFallback(token) {
  const inferredProjectId = inferFirebaseProjectIdFromToken(token);
  const configuredProjectId = String(config.firebaseProjectId || "").trim();

  try {
    return await getFirebaseAdminAuth().verifyIdToken(token);
  } catch (primaryError) {
    if (!inferredProjectId) {
      throw primaryError;
    }
    if (configuredProjectId && configuredProjectId === inferredProjectId) {
      throw primaryError;
    }

    fastify.log.warn(
      {
        configuredProjectId: configuredProjectId || null,
        inferredProjectId,
      },
      "firebase_id_token_verify_retry_with_aud_project",
    );

    try {
      const decoded = await getFirebaseAdminAuth(inferredProjectId).verifyIdToken(
        token,
      );
      config.firebaseProjectId = inferredProjectId;
      return decoded;
    } catch {
      throw primaryError;
    }
  }
}

function normalizeObjectPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function parseJsonObjectField(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return normalizeObjectPayload(parsed);
  } catch {
    return null;
  }
}

function parseLifecycleMinute(value) {
  if (value == null || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const minute = Math.trunc(value);
    return minute >= 0 && minute <= 240 ? minute : null;
  }

  const text = String(value).trim();
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

  const normalizedDecimal = text.replace(",", ".");
  const decimalMatch = normalizedDecimal.match(/^(\d{1,3})(?:\.\d+)?$/);
  if (decimalMatch) {
    const minute = Number(decimalMatch[1]);
    if (Number.isInteger(minute) && minute >= 0 && minute <= 240) {
      return minute;
    }
    return null;
  }

  const apostropheMatch = normalizedDecimal.match(/^(\d{1,3})\s*'$/);
  if (apostropheMatch) {
    const minute = Number(apostropheMatch[1]);
    if (Number.isInteger(minute) && minute >= 0 && minute <= 240) {
      return minute;
    }
    return null;
  }

  const directMatch = text.match(/^(\d{1,3})$/);
  if (!directMatch) {
    return null;
  }

  const minute = Number(directMatch[1]);
  if (!Number.isInteger(minute) || minute < 0 || minute > 240) {
    return null;
  }
  return minute;
}

function nowIso() {
  return new Date().toISOString();
}

function unixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function normalizeNodeId(node) {
  return node?.id || node?.name || node?.url || "unknown-node";
}

function base64UrlEncode(raw) {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signJoinTicket(payload, secret) {
  const payloadStr = JSON.stringify(payload);
  const payloadBase64 = base64UrlEncode(payloadStr);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payloadBase64)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${payloadBase64}.${signature}`;
}

function issueJoinTicket({ matchId, userId, role, teamSide, ttlSec, secret }) {
  const exp = unixSeconds() + ttlSec;
  return signJoinTicket(
    {
      matchId,
      userId: userId || "unknown",
      role: role || "player",
      teamSide: teamSide || "spectator",
      exp,
    },
    secret || config.signingKey,
  );
}

function resolveTeamSide(match, userId, role = "player") {
  if (!match || !userId) {
    return "spectator";
  }

  const normalizedRole = String(role || "player").trim().toLowerCase();
  if (normalizedRole === "spectator") {
    return "spectator";
  }

  if (match.homeUserId && String(match.homeUserId) === String(userId)) {
    return "home";
  }

  if (match.awayUserId && String(match.awayUserId) === String(userId)) {
    return "away";
  }

  return "spectator";
}

function getBearerToken(request) {
  const auth = request.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

async function resolveRequestIdentity(request) {
  const token = getBearerToken(request);
  if (!token) {
    return { type: "anonymous" };
  }

  if (config.apiSecret && token === config.apiSecret) {
    return { type: "api_secret" };
  }

  try {
    const decoded = await verifyFirebaseTokenWithFallback(token);
    return {
      type: "firebase_user",
      uid: String(decoded.uid || ""),
      email: decoded.email || null,
      claims: decoded,
    };
  } catch (error) {
    fastify.log.warn(
      {
        err: error,
        firebaseProjectId: config.firebaseProjectId || null,
      },
      "firebase_id_token_verification_failed",
    );
    return { type: "invalid" };
  }
}

function requireApiAuth(request, reply) {
  if (!config.apiSecret) return true;
  if (getBearerToken(request) !== config.apiSecret) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

async function requireUserOrApiAuth(request, reply) {
  const identity = await resolveRequestIdentity(request);
  if (identity.type === "api_secret" || identity.type === "firebase_user") {
    request.identity = identity;
    return true;
  }

  reply.code(401).send({ error: "unauthorized" });
  return false;
}

function ensureClaimedUserMatches(identity, claimedUserId, reply, fieldName = "userId") {
  if (identity?.type === "api_secret") {
    return true;
  }

  if (identity?.type !== "firebase_user") {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }

  if (String(identity.uid || "") !== String(claimedUserId || "")) {
    reply.code(403).send({
      error: "token_user_mismatch",
      field: fieldName,
    });
    return false;
  }

  return true;
}

function ensureFriendlyRequestAccess(identity, pending, reply) {
  if (identity?.type === "api_secret") {
    return true;
  }

  if (identity?.type !== "firebase_user") {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }

  const allowed = new Set(
    [pending?.requesterUserId, pending?.opponentUserId, pending?.acceptedBy]
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );

  if (allowed.has(String(identity.uid || "").trim())) {
    return true;
  }

  reply.code(403).send({ error: "friendly_request_forbidden" });
  return false;
}

function ensureMatchAccess(identity, match, reply) {
  if (identity?.type === "api_secret") {
    return true;
  }

  if (identity?.type !== "firebase_user") {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }

  const allowed = new Set(
    [match?.homeUserId, match?.awayUserId]
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );

  if (!allowed.size || allowed.has(String(identity.uid || "").trim())) {
    return true;
  }

  reply.code(403).send({ error: "match_access_forbidden" });
  return false;
}

function requireCallbackAuth(request, reply) {
  if (!config.callbackToken) return true;
  if (getBearerToken(request) !== config.callbackToken) {
    reply.code(401).send({ error: "invalid_callback_token" });
    return false;
  }
  return true;
}

function buildNodeHeaders(node) {
  return node?.token ? { Authorization: `Bearer ${node.token}` } : {};
}

async function fetchNodeCapacity(node) {
  const response = await fetch(`${node.url}/agent/v1/capacity`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...buildNodeHeaders(node),
    },
  });

  if (!response.ok) {
    throw new Error(`capacity_${response.status}`);
  }

  return response.json();
}

async function allocateOnNode(node, allocation) {
  const response = await fetch(`${node.url}/agent/v1/allocations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildNodeHeaders(node),
    },
    body: JSON.stringify(allocation),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`allocation_${response.status}:${body}`);
  }

  return response.json();
}

async function startOnNode(node, matchId) {
  const response = await fetch(
    `${node.url}/agent/v1/allocations/${encodeURIComponent(matchId)}/start`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildNodeHeaders(node),
      },
      body: "{}",
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`start_${response.status}:${body}`);
  }

  return response.json();
}

async function releaseOnNode(node, matchId) {
  const response = await fetch(
    `${node.url}/agent/v1/allocations/${encodeURIComponent(matchId)}`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...buildNodeHeaders(node),
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`release_${response.status}:${body}`);
  }

  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isMatchReadyForClient(match) {
  const state = String(match?.status || "").trim().toLowerCase();
  return state === "server_started" || state === "running";
}

function isTerminalMatchState(match) {
  const state = String(match?.status || "").trim().toLowerCase();
  return state === "failed" || state === "ended" || state === "released";
}

async function waitForMatchReady(matchId, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 30000));
  const pollMs = Math.max(100, Number(options.pollMs || 400));
  const deadline = Date.now() + timeoutMs;
  let lastMatch = await getMatchById(matchId);

  if (isMatchReadyForClient(lastMatch)) {
    return lastMatch;
  }

  while (Date.now() < deadline) {
    await sleep(pollMs);
    const current = await getMatchById(matchId);
    if (current) {
      lastMatch = current;
    }

    if (isMatchReadyForClient(current)) {
      return current;
    }

    if (isTerminalMatchState(current)) {
      break;
    }
  }

  const error = new Error(
    isTerminalMatchState(lastMatch) ? "match_start_failed" : "match_start_timeout",
  );
  error.code = error.message;
  error.match = lastMatch || null;
  throw error;
}

function buildLifecycleCallbackUrl(matchId) {
  const base = config.lifecycleCallbackBaseUrl?.trim();
  if (!base) {
    return "";
  }
  return `${base.replace(/\/$/, "")}/v1/internal/matches/${encodeURIComponent(matchId)}/lifecycle`;
}

function resolveNodePool(mode) {
  if (mode === "league") {
    return Array.isArray(config.nodeAgentsLeague) ? config.nodeAgentsLeague : [];
  }
  if (mode === "friendly") {
    return Array.isArray(config.nodeAgentsFriendly)
      ? config.nodeAgentsFriendly
      : [];
  }
  return Array.isArray(config.nodeAgents) ? config.nodeAgents : [];
}

function isNoFreeSlotAllocationError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("no_free_slot") || message.includes("allocation_409");
}

async function rankNodesByCapacity(mode = "default") {
  const pool = resolveNodePool(mode);
  if (!pool.length) {
    throw new Error(`no_node_agents_configured_for_${mode}`);
  }

  const capacities = await Promise.allSettled(
    pool.map(async (node) => {
      const cap = await fetchNodeCapacity(node);
      return { node, cap };
    }),
  );

  const ranked = capacities.map((entry, index) => {
    if (entry.status === "fulfilled") {
      return {
        node: entry.value.node,
        freeSlots: Number(entry.value.cap?.freeSlots || 0),
        cpuLoad: Number(entry.value.cap?.cpuLoad || 0),
        healthy: true,
        index,
      };
    }
    return {
      node: pool[index],
      freeSlots: 0,
      cpuLoad: Number.POSITIVE_INFINITY,
      healthy: false,
      index,
    };
  });

  ranked.sort((a, b) => {
    const slotDelta = b.freeSlots - a.freeSlots;
    if (slotDelta !== 0) return slotDelta;
    if (a.healthy !== b.healthy) {
      return a.healthy ? -1 : 1;
    }
    const cpuDelta = a.cpuLoad - b.cpuLoad;
    if (cpuDelta !== 0) return cpuDelta;
    return a.index - b.index;
  });

  return ranked.map((entry) => entry.node);
}

async function selectNode(mode = "default") {
  const ranked = await rankNodesByCapacity(mode);
  if (!ranked.length) {
    throw new Error(`no_node_agents_configured_for_${mode}`);
  }
  return ranked[0];
}

async function allocateAcrossNodePool(mode, allocationPayload) {
  const candidates = await rankNodesByCapacity(mode);
  if (!candidates.length) {
    throw new Error(`no_node_agents_configured_for_${mode}`);
  }

  const errors = [];
  for (const node of candidates) {
    try {
      const allocation = await allocateOnNode(node, allocationPayload);
      return { node, allocation };
    } catch (error) {
      const message = String(error?.message || "allocation_failed");
      errors.push({
        nodeId: normalizeNodeId(node),
        message,
      });
      if (isNoFreeSlotAllocationError(error)) {
        continue;
      }
      continue;
    }
  }

  const error = new Error("no_free_slot");
  error.details = errors;
  throw error;
}

function sanitizeFriendlyRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    requesterUserId: row.requester_user_id ?? row.requesterUserId,
    opponentUserId: row.opponent_user_id ?? row.opponentUserId ?? null,
    homeTeamId: row.home_team_id ?? row.homeTeamId,
    awayTeamId: row.away_team_id ?? row.awayTeamId,
    status: row.status,
    acceptedBy: row.accepted_by ?? row.acceptedBy ?? null,
    matchId: row.match_id ?? row.matchId ?? null,
    homeTeamPayload:
      parseJsonObjectField(row.home_team_payload_json) ??
      normalizeObjectPayload(row.homeTeamPayload) ??
      null,
    awayTeamPayload:
      parseJsonObjectField(row.away_team_payload_json) ??
      normalizeObjectPayload(row.awayTeamPayload) ??
      null,
    createdAt: row.created_at ?? row.createdAt,
    expiresAt: row.expires_at ?? row.expiresAt,
  };
}

function sanitizeMatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    nodeId: row.node_id ?? row.nodeId,
    serverIp: row.server_ip ?? row.serverIp,
    serverPort: row.server_port ?? row.serverPort,
    sessionSecret: row.session_secret ?? row.sessionSecret,
    homeTeamId: row.home_team_id ?? row.homeTeamId,
    awayTeamId: row.away_team_id ?? row.awayTeamId,
    homeUserId: row.home_user_id ?? row.homeUserId ?? null,
    awayUserId: row.away_user_id ?? row.awayUserId ?? null,
    seasonId: row.season_id ?? row.seasonId ?? null,
    leagueId: row.league_id ?? row.leagueId,
    fixtureId: row.fixture_id ?? row.fixtureId,
    kickoffAt: row.kickoff_at ?? row.kickoffAt,
    endedReason: row.ended_reason ?? row.endedReason ?? null,
    homeScore: row.home_score ?? row.homeScore ?? null,
    awayScore: row.away_score ?? row.awayScore ?? null,
    homeTeamName: row.home_team_name ?? row.homeTeamName ?? null,
    awayTeamName: row.away_team_name ?? row.awayTeamName ?? null,
    liveMinute: row.live_minute ?? row.liveMinute ?? null,
    liveMinuteAt: row.live_minute_at ?? row.liveMinuteAt ?? null,
    resultPayload:
      normalizeObjectPayload(row.result_payload) ??
      parseJsonObjectField(row.resultPayload) ??
      null,
    endedAt: row.ended_at ?? row.endedAt ?? null,
    replayStatus: row.replay_status ?? row.replayStatus ?? "none",
    replayStoragePath: row.replay_storage_path ?? row.replayStoragePath ?? null,
    videoStatus: row.video_status ?? row.videoStatus ?? "none",
    videoStoragePath: row.video_storage_path ?? row.videoStoragePath ?? null,
    videoWatchUrl: row.video_watch_url ?? row.videoWatchUrl ?? null,
    updatedAt: row.updated_at ?? row.updatedAt,
    createdAt: row.created_at ?? row.createdAt,
  };
}

function sanitizeInternalMatch(row) {
  const match = sanitizeMatch(row);
  if (!match) {
    return null;
  }

  return {
    id: match.id,
    mode: match.mode,
    status: match.status,
    nodeId: match.nodeId,
    serverIp: match.serverIp,
    serverPort: match.serverPort,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    homeUserId: match.homeUserId,
    awayUserId: match.awayUserId,
    seasonId: match.seasonId,
    leagueId: match.leagueId,
    fixtureId: match.fixtureId,
    kickoffAt: match.kickoffAt,
    endedReason: match.endedReason,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homeTeamName: match.homeTeamName,
    awayTeamName: match.awayTeamName,
    liveMinute: match.liveMinute,
    liveMinuteAt: match.liveMinuteAt,
    resultPayload: match.resultPayload,
    endedAt: match.endedAt,
    replayStatus: match.replayStatus,
    replayStoragePath: match.replayStoragePath,
    videoStatus: match.videoStatus,
    videoStoragePath: match.videoStoragePath,
    videoWatchUrl: match.videoWatchUrl,
    updatedAt: match.updatedAt,
    createdAt: match.createdAt,
  };
}

async function initPg() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendly_requests (
      id TEXT PRIMARY KEY,
      requester_user_id TEXT NOT NULL,
      opponent_user_id TEXT,
      home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL,
      status TEXT NOT NULL,
      accepted_by TEXT,
      match_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`
    ALTER TABLE friendly_requests
    ADD COLUMN IF NOT EXISTS opponent_user_id TEXT;
  `);
  await pool.query(`
    ALTER TABLE friendly_requests
    ADD COLUMN IF NOT EXISTS home_team_payload_json TEXT;
  `);
  await pool.query(`
    ALTER TABLE friendly_requests
    ADD COLUMN IF NOT EXISTS away_team_payload_json TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      node_id TEXT,
      server_ip TEXT,
      server_port INTEGER,
      session_secret TEXT,
      home_team_id TEXT,
      away_team_id TEXT,
      home_user_id TEXT,
      away_user_id TEXT,
      season_id TEXT,
      league_id TEXT,
      fixture_id TEXT,
      kickoff_at TIMESTAMPTZ,
      ended_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS home_user_id TEXT;
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS away_user_id TEXT;
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS season_id TEXT;
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS home_score INTEGER;
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS away_score INTEGER;
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS home_team_name TEXT;
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS away_team_name TEXT;
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS result_payload JSONB;
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS replay_status TEXT DEFAULT 'none';
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS replay_storage_path TEXT;
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS video_status TEXT DEFAULT 'none';
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS video_storage_path TEXT;
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS video_watch_url TEXT;
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS live_minute INTEGER;
  `);
  await pool.query(`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS live_minute_at TIMESTAMPTZ;
  `);

  pgReady = true;
}

async function initRedis() {
  if (!redis) return;
  await redis.connect();
  redisReady = true;
}

async function storeFriendlyRequest(req) {
  memoryStore.friendlyRequests.set(req.id, req);
  if (!pool || !pgReady) return;

  await pool.query(
    `INSERT INTO friendly_requests (
       id, requester_user_id, opponent_user_id, home_team_id, away_team_id,
       status, accepted_by, match_id, expires_at, home_team_payload_json, away_team_payload_json
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET
       requester_user_id = EXCLUDED.requester_user_id,
       opponent_user_id = EXCLUDED.opponent_user_id,
       home_team_id = EXCLUDED.home_team_id,
       away_team_id = EXCLUDED.away_team_id,
       status = EXCLUDED.status,
       accepted_by = EXCLUDED.accepted_by,
       match_id = EXCLUDED.match_id,
       expires_at = EXCLUDED.expires_at,
       home_team_payload_json = EXCLUDED.home_team_payload_json,
       away_team_payload_json = EXCLUDED.away_team_payload_json`,
    [
      req.id,
      req.requesterUserId,
      req.opponentUserId || null,
      req.homeTeamId,
      req.awayTeamId,
      req.status,
      req.acceptedBy || null,
      req.matchId || null,
      req.expiresAt,
      req.homeTeamPayload ? JSON.stringify(req.homeTeamPayload) : null,
      req.awayTeamPayload ? JSON.stringify(req.awayTeamPayload) : null,
    ],
  );
}

async function getFriendlyRequestById(id) {
  const inMemory = memoryStore.friendlyRequests.get(id);
  if (inMemory) return inMemory;
  if (!pool || !pgReady) return null;

  const result = await pool.query("SELECT * FROM friendly_requests WHERE id = $1", [id]);
  if (!result.rowCount) return null;

  const mapped = sanitizeFriendlyRequest(result.rows[0]);
  if (mapped) memoryStore.friendlyRequests.set(mapped.id, mapped);
  return mapped;
}

async function listFriendlyRequestsByUser(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return [];
  }

  if (pool && pgReady) {
    const result = await pool.query(
      `SELECT * FROM friendly_requests
       WHERE requester_user_id = $1 OR opponent_user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [normalizedUserId],
    );

    return result.rows
      .map((row) => sanitizeFriendlyRequest(row))
      .filter((item) => item !== null);
  }

  return Array.from(memoryStore.friendlyRequests.values())
    .filter((item) => item.requesterUserId === normalizedUserId || item.opponentUserId === normalizedUserId)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 50);
}

async function getMatchById(matchId) {
  const inMemory = memoryStore.matches.get(matchId);
  if (inMemory) return inMemory;
  if (!pool || !pgReady) return null;

  const result = await pool.query("SELECT * FROM matches WHERE id = $1", [matchId]);
  if (!result.rowCount) return null;

  const mapped = sanitizeMatch(result.rows[0]);
  if (mapped) memoryStore.matches.set(mapped.id, mapped);
  return mapped;
}

async function findLeagueMatchByFixture(leagueId, fixtureId) {
  const normalizedLeagueId = String(leagueId || "").trim();
  const normalizedFixtureId = String(fixtureId || "").trim();
  if (!normalizedLeagueId || !normalizedFixtureId) {
    return null;
  }

  const inMemory = Array.from(memoryStore.matches.values()).find(
    (item) =>
      item?.mode === "league" &&
      String(item.leagueId || "") === normalizedLeagueId &&
      String(item.fixtureId || "") === normalizedFixtureId &&
      !["failed", "ended", "released"].includes(String(item.status || "").toLowerCase()),
  );
  if (inMemory) {
    return inMemory;
  }

  if (!pool || !pgReady) return null;

  const result = await pool.query(
    `SELECT *
       FROM matches
      WHERE mode = 'league'
        AND league_id = $1
        AND fixture_id = $2
        AND status NOT IN ('failed', 'ended', 'released')
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [normalizedLeagueId, normalizedFixtureId],
  );
  if (!result.rowCount) return null;

  const mapped = sanitizeMatch(result.rows[0]);
  if (mapped) memoryStore.matches.set(mapped.id, mapped);
  return mapped;
}

async function listFriendlyHistory({ userId, opponentUserId = null, limit = 20 }) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedOpponentUserId = String(opponentUserId || "").trim() || null;
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit || 20)));

  if (!normalizedUserId) {
    return [];
  }

  if (pool && pgReady) {
    const result = await pool.query(
      `SELECT *
       FROM matches
       WHERE mode = 'friendly'
         AND (
           status = 'ended'
           OR ended_at IS NOT NULL
           OR result_payload IS NOT NULL
           OR home_score IS NOT NULL
           OR away_score IS NOT NULL
         )
         AND ($1 = home_user_id OR $1 = away_user_id)
         AND (
           $2::text IS NULL
           OR ($1 = home_user_id AND $2 = away_user_id)
           OR ($1 = away_user_id AND $2 = home_user_id)
         )
       ORDER BY COALESCE(ended_at, updated_at, created_at) DESC
       LIMIT $3`,
      [normalizedUserId, normalizedOpponentUserId, normalizedLimit],
    );

    return result.rows.map((row) => sanitizeMatch(row)).filter(Boolean);
  }

  return Array.from(memoryStore.matches.values())
    .filter(
      (item) =>
        item?.mode === "friendly" &&
        (item?.status === "ended" ||
          item?.endedAt ||
          item?.resultPayload ||
          item?.homeScore != null ||
          item?.awayScore != null),
    )
    .filter(
      (item) =>
        item.homeUserId === normalizedUserId || item.awayUserId === normalizedUserId,
    )
    .filter((item) => {
      if (!normalizedOpponentUserId) return true;
      return (
        (item.homeUserId === normalizedUserId &&
          item.awayUserId === normalizedOpponentUserId) ||
        (item.awayUserId === normalizedUserId &&
          item.homeUserId === normalizedOpponentUserId)
      );
    })
    .sort(
      (a, b) =>
        new Date(b.endedAt || b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.endedAt || a.updatedAt || a.createdAt || 0).getTime(),
    )
    .slice(0, normalizedLimit);
}

async function storeMatch(match) {
  memoryStore.matches.set(match.id, match);
  if (!pool || !pgReady) return;

  await pool.query(
    `INSERT INTO matches (
      id, mode, status, node_id, server_ip, server_port, session_secret,
      home_team_id, away_team_id, home_user_id, away_user_id, season_id,
      league_id, fixture_id, kickoff_at, ended_reason,
      home_score, away_score, home_team_name, away_team_name,
      live_minute, live_minute_at, result_payload, ended_at, replay_status, replay_storage_path,
      video_status, video_storage_path, video_watch_url, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24,$25,$26,$27,$28,$29,now())
    ON CONFLICT (id) DO UPDATE SET
      mode = EXCLUDED.mode,
      status = EXCLUDED.status,
      node_id = EXCLUDED.node_id,
      server_ip = EXCLUDED.server_ip,
      server_port = EXCLUDED.server_port,
      session_secret = EXCLUDED.session_secret,
      home_team_id = EXCLUDED.home_team_id,
      away_team_id = EXCLUDED.away_team_id,
      home_user_id = EXCLUDED.home_user_id,
      away_user_id = EXCLUDED.away_user_id,
      season_id = EXCLUDED.season_id,
      league_id = EXCLUDED.league_id,
      fixture_id = EXCLUDED.fixture_id,
      kickoff_at = EXCLUDED.kickoff_at,
      ended_reason = EXCLUDED.ended_reason,
      home_score = EXCLUDED.home_score,
      away_score = EXCLUDED.away_score,
      home_team_name = EXCLUDED.home_team_name,
      away_team_name = EXCLUDED.away_team_name,
      live_minute = EXCLUDED.live_minute,
      live_minute_at = EXCLUDED.live_minute_at,
      result_payload = EXCLUDED.result_payload,
      ended_at = EXCLUDED.ended_at,
      replay_status = EXCLUDED.replay_status,
      replay_storage_path = EXCLUDED.replay_storage_path,
      video_status = EXCLUDED.video_status,
      video_storage_path = EXCLUDED.video_storage_path,
      video_watch_url = EXCLUDED.video_watch_url,
      updated_at = now()`,
    [
      match.id,
      match.mode,
      match.status,
      match.nodeId,
      match.serverIp,
      match.serverPort,
      match.sessionSecret,
      match.homeTeamId,
      match.awayTeamId,
      match.homeUserId || null,
      match.awayUserId || null,
      match.seasonId || null,
      match.leagueId,
      match.fixtureId,
      match.kickoffAt || null,
      match.endedReason || null,
      Number.isFinite(match.homeScore) ? Number(match.homeScore) : null,
      Number.isFinite(match.awayScore) ? Number(match.awayScore) : null,
      match.homeTeamName || null,
      match.awayTeamName || null,
      Number.isFinite(match.liveMinute) ? Number(match.liveMinute) : null,
      match.liveMinuteAt || null,
      match.resultPayload ? JSON.stringify(match.resultPayload) : null,
      match.endedAt || null,
      match.replayStatus || "none",
      match.replayStoragePath || null,
      match.videoStatus || "none",
      match.videoStoragePath || null,
      match.videoWatchUrl || null,
    ],
  );
}

async function forwardLeagueLifecycle(match, payload) {
  if (!match || match.mode !== "league") return;
  if (!config.firebaseLifecycleUrl) return;

  const minuteFromPayload = parseLifecycleMinute(payload?.minute);
  const minute =
    minuteFromPayload != null
      ? minuteFromPayload
      : parseLifecycleMinute(match.liveMinute);

  const body = {
    matchId: match.id,
    leagueId: match.leagueId || null,
    fixtureId: match.fixtureId || null,
    state: payload?.state || match.status || "",
    nodeId: match.nodeId || null,
    serverIp: match.serverIp || null,
    serverPort: match.serverPort || null,
    reason: payload?.reason || match.endedReason || "",
    minute,
    minuteUpdatedAt: match.liveMinuteAt || null,
    homeScore: Number.isFinite(match.homeScore) ? Number(match.homeScore) : null,
    awayScore: Number.isFinite(match.awayScore) ? Number(match.awayScore) : null,
    result: match.resultPayload || null,
    endedAt: match.endedAt || null,
    endedReason: match.endedReason || null,
    updatedAt: match.updatedAt || nowIso(),
  };

  const primaryToken =
    typeof config.firebaseLifecycleToken === "string"
      ? config.firebaseLifecycleToken.trim()
      : "";
  const fallbackToken =
    typeof config.apiSecret === "string" ? config.apiSecret.trim() : "";
  const authTokens = [];
  if (primaryToken) authTokens.push(primaryToken);
  if (fallbackToken && fallbackToken !== primaryToken) {
    authTokens.push(fallbackToken);
  }
  if (authTokens.length === 0) {
    authTokens.push("");
  }

  let lastStatus = 0;
  let lastBody = "";
  try {
    for (let i = 0; i < authTokens.length; i += 1) {
      const token = authTokens[i];
      const response = await fetch(config.firebaseLifecycleUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        return;
      }

      lastStatus = response.status;
      lastBody = await response.text().catch(() => "");
      const canRetryWithFallback =
        (response.status === 401 || response.status === 403) &&
        i < authTokens.length - 1;
      if (canRetryWithFallback) {
        fastify.log.warn(
          { matchId: match.id, status: response.status },
          "firebase_lifecycle_forward_retry_with_fallback_token",
        );
        continue;
      }
      break;
    }

    fastify.log.warn(
      { matchId: match.id, status: lastStatus, body: lastBody, payload: body },
      "firebase_lifecycle_forward_failed",
    );
  } catch (error) {
    fastify.log.warn(
      { err: error, matchId: match.id, payload: body },
      "firebase_lifecycle_forward_error",
    );
  }
}

async function acquireLock(lockKey, ttlMs = 10_000) {
  if (!redis || !redisReady) return true;
  const token = crypto.randomUUID();
  const result = await redis.set(lockKey, token, "PX", ttlMs, "NX");
  return result === "OK";
}

function ensureApiAuth(request, reply) {
  return requireApiAuth(request, reply);
}

async function releaseMatchNodeAllocation(match, reason = "completed") {
  if (!match?.nodeId) return;

  const node = (config.nodeAgents || []).find(
    (item) => normalizeNodeId(item) === match.nodeId,
  );

  if (!node) {
    fastify.log.warn({ matchId: match.id, nodeId: match.nodeId }, "node_not_found_for_release");
    return;
  }

  try {
    await releaseOnNode(node, match.id);
    fastify.log.info({ matchId: match.id, nodeId: match.nodeId, reason }, "node_slot_released");
  } catch (error) {
    fastify.log.error({ err: error, matchId: match.id }, "failed_to_release_node_allocation");
  }
}

function clearPendingMatchRelease(matchId) {
  const timer = pendingMatchReleaseTimers.get(matchId);
  if (timer) {
    clearTimeout(timer);
    pendingMatchReleaseTimers.delete(matchId);
  }
}

function scheduleMatchNodeRelease(match, reason = "completed") {
  if (!match?.id || !match?.nodeId) {
    return;
  }

  clearPendingMatchRelease(match.id);

  const delayMs = Math.max(5000, Number(config.matchEndReleaseDelayMs || 0));
  const timer = setTimeout(async () => {
    pendingMatchReleaseTimers.delete(match.id);
    await releaseMatchNodeAllocation(match, reason);
  }, delayMs);

  pendingMatchReleaseTimers.set(match.id, timer);
  fastify.log.info(
    { matchId: match.id, nodeId: match.nodeId, reason, delayMs },
    "node_slot_release_scheduled",
  );
}

fastify.get("/health", async () => ({
  ok: true,
  timestamp: nowIso(),
  pgReady,
  redisReady,
  nodeAgents: Array.isArray(config.nodeAgents) ? config.nodeAgents.length : 0,
  nodeAgentsFriendly: Array.isArray(config.nodeAgentsFriendly)
    ? config.nodeAgentsFriendly.length
    : 0,
  nodeAgentsLeague: Array.isArray(config.nodeAgentsLeague)
    ? config.nodeAgentsLeague.length
    : 0,
}));

fastify.post("/v1/friendly/requests", async (request, reply) => {
  if (!(await requireUserOrApiAuth(request, reply))) return;

  const body = request.body || {};
  const requesterUserId = String(body.requesterUserId || "").trim();
  const opponentUserId = String(body.opponentUserId || "").trim();
  const homeTeamId = String(body.homeTeamId || "").trim();
  const awayTeamId = String(body.awayTeamId || "").trim();
  const homeTeamPayload = normalizeObjectPayload(body.homeTeamPayload);
  const awayTeamPayload = normalizeObjectPayload(body.awayTeamPayload);

  if (!requesterUserId || !homeTeamId || !awayTeamId) {
    return reply
      .code(400)
      .send({ error: "requesterUserId, homeTeamId, awayTeamId required" });
  }

  if (!ensureClaimedUserMatches(request.identity, requesterUserId, reply, "requesterUserId")) {
    return;
  }

  const requestId = makeId("fr");
  const expiresAt = new Date(Date.now() + config.friendlyRequestTtlSec * 1000).toISOString();
  const data = {
    id: requestId,
    requesterUserId,
    opponentUserId: opponentUserId || null,
    homeTeamId,
    awayTeamId,
    homeTeamPayload,
    awayTeamPayload,
    status: "pending",
    acceptedBy: null,
    matchId: null,
    createdAt: nowIso(),
    expiresAt,
  };

  await storeFriendlyRequest(data);
  return reply.code(201).send({ requestId, status: data.status, expiresAt });
});

fastify.get("/v1/friendly/requests", async (request, reply) => {
  if (!(await requireUserOrApiAuth(request, reply))) return;

  const userId = String(request.query?.userId || "").trim();
  if (!userId) {
    return reply.code(400).send({ error: "userId query is required" });
  }

  if (!ensureClaimedUserMatches(request.identity, userId, reply, "userId")) {
    return;
  }

  const items = await listFriendlyRequestsByUser(userId);
  const responseItems = await Promise.all(
    items.map(async (item) => {
      const payload = {
        requestId: item.id,
        status: item.status,
        requesterUserId: item.requesterUserId,
        opponentUserId: item.opponentUserId || null,
    homeTeamId: item.homeTeamId,
    awayTeamId: item.awayTeamId,
        acceptedBy: item.acceptedBy || null,
        matchId: item.matchId || null,
        expiresAt: item.expiresAt,
        createdAt: item.createdAt || null,
      };

      if (!item.matchId) {
        return payload;
      }

      const match = await getMatchById(item.matchId);
      if (!match) {
        return payload;
      }

      return {
        ...payload,
        match: {
          matchId: match.id,
          state: match.status,
          serverIp: match.serverIp,
          serverPort: match.serverPort,
        },
      };
    }),
  );

  return reply.send({ items: responseItems });
});

fastify.get("/v1/friendly/requests/:requestId", async (request, reply) => {
  if (!(await requireUserOrApiAuth(request, reply))) return;

  const { requestId } = request.params;
  const pending = await getFriendlyRequestById(requestId);
  if (!pending) {
    return reply.code(404).send({ error: "friendly_request_not_found" });
  }

  if (!ensureFriendlyRequestAccess(request.identity, pending, reply)) {
    return;
  }

  const response = {
    requestId: pending.id,
    status: pending.status,
    requesterUserId: pending.requesterUserId,
    opponentUserId: pending.opponentUserId || null,
    homeTeamId: pending.homeTeamId,
    awayTeamId: pending.awayTeamId,
    acceptedBy: pending.acceptedBy,
    matchId: pending.matchId,
    expiresAt: pending.expiresAt,
  };

  if (pending.matchId) {
    const match = await getMatchById(pending.matchId);
    if (match) {
      return reply.send({
        ...response,
        match: {
          matchId: match.id,
          state: match.status,
          serverIp: match.serverIp,
          serverPort: match.serverPort,
        },
      });
    }
  }

  return reply.send(response);
});

fastify.get("/v1/friendly/history", async (request, reply) => {
  if (!(await requireUserOrApiAuth(request, reply))) return;

  const userId = String(request.query?.userId || "").trim();
  const opponentUserId = String(request.query?.opponentUserId || "").trim() || null;
  const limit = Number(request.query?.limit || 20);

  if (!userId) {
    return reply.code(400).send({ error: "userId query is required" });
  }

  if (!ensureClaimedUserMatches(request.identity, userId, reply, "userId")) {
    return;
  }

  const items = await listFriendlyHistory({ userId, opponentUserId, limit });
  return reply.send({
    items: items.map((item) => {
      const isHomeUser = String(item.homeUserId || "") === userId;
      const homeScore = Number.isFinite(item.homeScore) ? Number(item.homeScore) : 0;
      const awayScore = Number.isFinite(item.awayScore) ? Number(item.awayScore) : 0;
      const userScore = isHomeUser ? homeScore : awayScore;
      const opponentScore = isHomeUser ? awayScore : homeScore;
      let resultForUser = "draw";
      if (userScore > opponentScore) {
        resultForUser = "win";
      } else if (userScore < opponentScore) {
        resultForUser = "loss";
      }

      return {
        matchId: item.id,
        playedAt: item.endedAt || item.updatedAt || item.createdAt || null,
        homeUserId: item.homeUserId || null,
        awayUserId: item.awayUserId || null,
        homeTeamName: item.homeTeamName || item.homeTeamId || "Home",
        awayTeamName: item.awayTeamName || item.awayTeamId || "Away",
        homeScore,
        awayScore,
        resultForUser,
        videoStatus: item.videoStatus || "none",
        videoAvailable: Boolean(item.videoWatchUrl),
        videoWatchUrl: item.videoWatchUrl || null,
        replayStatus: item.replayStatus || "none",
      };
    }),
  });
});

fastify.post("/v1/friendly/requests/:requestId/accept", async (request, reply) => {
  if (!(await requireUserOrApiAuth(request, reply))) return;

  const { requestId } = request.params;
  const body = request.body || {};
  const acceptingUserId = String(body.acceptingUserId || "").trim();
  const requestedRole = String(body.role || "player").trim().toLowerCase();
  const acceptedRole = requestedRole === "spectator" ? "spectator" : "player";

  if (!acceptingUserId) {
    return reply.code(400).send({ error: "acceptingUserId required" });
  }

  if (!ensureClaimedUserMatches(request.identity, acceptingUserId, reply, "acceptingUserId")) {
    return;
  }

  const lockKey = `lock:friendly:${requestId}`;
  const locked = await acquireLock(lockKey);
  if (!locked) {
    return reply.code(409).send({ error: "request_locked" });
  }

  const pending = await getFriendlyRequestById(requestId);
  if (!pending) {
    return reply.code(404).send({ error: "friendly_request_not_found" });
  }

  if (pending.status === "accepted" && pending.matchId) {
    const existingMatch = await getMatchById(pending.matchId);
    if (!existingMatch) {
      return reply.code(409).send({ error: "accepted_match_missing" });
    }

    let readyMatch = existingMatch;
    try {
      readyMatch = isMatchReadyForClient(existingMatch)
        ? existingMatch
        : await waitForMatchReady(existingMatch.id);
    } catch (error) {
      fastify.log.warn(
        { err: error, matchId: existingMatch.id },
        "friendly_accept_existing_match_not_ready",
      );
      return reply.code(503).send({ error: error.code || "match_not_ready" });
    }

    const joinTicket = issueJoinTicket({
      matchId: readyMatch.id,
      userId: acceptingUserId,
      role: acceptedRole,
      teamSide: resolveTeamSide(readyMatch, acceptingUserId, acceptedRole),
      ttlSec: config.joinTicketTtlSec,
      secret: readyMatch.sessionSecret,
    });

    return reply.send({
      requestId,
      matchId: readyMatch.id,
      state: readyMatch.status,
      serverIp: readyMatch.serverIp,
      serverPort: readyMatch.serverPort,
      joinTicket,
      expiresAt: new Date(Date.now() + config.joinTicketTtlSec * 1000).toISOString(),
      reused: true,
    });
  }

  if (pending.status !== "pending") {
    return reply.code(404).send({ error: "friendly_request_not_pending" });
  }

  if (pending.opponentUserId && pending.opponentUserId !== acceptingUserId) {
    return reply.code(403).send({ error: "forbidden_accepting_user" });
  }

  if (new Date(pending.expiresAt).getTime() < Date.now()) {
    pending.status = "expired";
    await storeFriendlyRequest(pending);
    return reply.code(410).send({ error: "friendly_request_expired" });
  }

  const matchId = makeId("m");
  const sessionSecret = crypto.randomBytes(24).toString("hex");
  const callbackUrl = buildLifecycleCallbackUrl(matchId);
  const allocationResult = await allocateAcrossNodePool("friendly", {
    matchId,
    mode: "friendly",
    maxClients: Number(body.maxClients || config.defaultFriendlyMaxClients),
    sessionSecret,
    homeTeamId: pending.homeTeamId,
    awayTeamId: pending.awayTeamId,
    homeTeamPayload: pending.homeTeamPayload || undefined,
    awayTeamPayload: pending.awayTeamPayload || undefined,
    autoStart: false,
    callbackUrl,
    callbackToken: config.callbackToken,
  });
  const node = allocationResult.node;
  const allocation = allocationResult.allocation;

  const match = {
    id: matchId,
    mode: "friendly",
    status: "starting",
    nodeId: normalizeNodeId(node),
    serverIp: allocation.serverIp,
    serverPort: allocation.serverPort,
    sessionSecret,
    homeTeamId: pending.homeTeamId,
    awayTeamId: pending.awayTeamId,
    homeUserId: pending.requesterUserId,
    awayUserId: acceptingUserId,
    leagueId: null,
    fixtureId: null,
    kickoffAt: null,
    endedReason: null,
    liveMinute: null,
    liveMinuteAt: null,
    updatedAt: nowIso(),
  };

  await storeMatch(match);

  try {
    await startOnNode(node, matchId);
    const readyMatch = await waitForMatchReady(matchId);
    match.status = readyMatch.status || "server_started";
    match.updatedAt = nowIso();
    await storeMatch(match);
  } catch (error) {
    match.status = "failed";
    match.endedReason = error.code || "match_start_failed";
    match.updatedAt = nowIso();
    await storeMatch(match);

    try {
      await releaseOnNode(node, matchId);
    } catch (releaseError) {
      fastify.log.warn(
        { err: releaseError, matchId },
        "friendly_accept_release_after_start_failure_failed",
      );
    }

    fastify.log.warn({ err: error, matchId }, "friendly_accept_match_not_ready");
    return reply.code(503).send({ error: error.code || "match_not_ready" });
  }

  pending.status = "accepted";
  pending.acceptedBy = acceptingUserId;
  pending.matchId = matchId;
  await storeFriendlyRequest(pending);

  const joinTicket = issueJoinTicket({
    matchId,
    userId: acceptingUserId,
    role: acceptedRole,
    teamSide: resolveTeamSide(match, acceptingUserId, acceptedRole),
    ttlSec: config.joinTicketTtlSec,
    secret: sessionSecret,
  });

  return reply.send({
    requestId,
    matchId,
    state: match.status,
    serverIp: match.serverIp,
    serverPort: match.serverPort,
    joinTicket,
    expiresAt: new Date(Date.now() + config.joinTicketTtlSec * 1000).toISOString(),
  });
});

fastify.post("/v1/matches/:matchId/join-ticket", async (request, reply) => {
  if (!(await requireUserOrApiAuth(request, reply))) return;

  const { matchId } = request.params;
  const body = request.body || {};
  const claimedUserId = String(body.userId || "").trim();
  let userId = claimedUserId;
  const role = String(body.role || "spectator").trim();

  if (request.identity?.type === "firebase_user") {
    userId = String(request.identity.uid || "").trim();
    if (!userId) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (claimedUserId && claimedUserId !== userId) {
      fastify.log.warn(
        { claimedUserId, uid: userId, matchId },
        "join_ticket_userid_overridden_by_token_uid",
      );
    }
  } else {
    if (!userId) {
      return reply.code(400).send({ error: "userId required" });
    }
    if (!ensureClaimedUserMatches(request.identity, userId, reply, "userId")) {
      return;
    }
  }

  const match = await getMatchById(matchId);
  if (!match) {
    return reply.code(404).send({ error: "match_not_found" });
  }

  if (!ensureMatchAccess(request.identity, match, reply)) {
    return;
  }

  if (match.mode === "league") {
    const allowedUserIds = new Set(
      [match.homeUserId, match.awayUserId]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    );
    if (!allowedUserIds.size) {
      return reply.code(409).send({ error: "league_match_user_binding_missing" });
    }
    if (!allowedUserIds.has(userId)) {
      return reply.code(403).send({ error: "league_match_join_forbidden" });
    }
  }

  let readyMatch = match;
  try {
    readyMatch = isMatchReadyForClient(match)
      ? match
      : await waitForMatchReady(matchId);
  } catch (error) {
    fastify.log.warn({ err: error, matchId }, "join_ticket_match_not_ready");
    return reply.code(503).send({ error: error.code || "match_not_ready" });
  }

  const ttlSec =
    readyMatch.mode === "league"
      ? config.leagueJoinTicketTtlSec
      : config.joinTicketTtlSec;
  const effectiveRole = readyMatch.mode === "league" ? "player" : role;

  const joinTicket = issueJoinTicket({
    matchId,
    userId,
    role: effectiveRole,
    teamSide: resolveTeamSide(readyMatch, userId, effectiveRole),
    ttlSec,
    secret: readyMatch.sessionSecret,
  });

  return reply.send({
    matchId,
    joinTicket,
    serverIp: readyMatch.serverIp,
    serverPort: readyMatch.serverPort,
    expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
  });
});

fastify.get("/v1/matches/:matchId/status", async (request, reply) => {
  if (!(await requireUserOrApiAuth(request, reply))) return;

  const { matchId } = request.params;
  const match = await getMatchById(matchId);
  if (!match) {
    return reply.code(404).send({ error: "match_not_found" });
  }

  if (!ensureMatchAccess(request.identity, match, reply)) {
    return;
  }

  return reply.send({
    matchId: match.id,
    state: match.status,
    serverIp: match.serverIp,
    serverPort: match.serverPort,
    updatedAt: match.updatedAt || nowIso(),
  });
});

fastify.get("/v1/internal/matches/:matchId", async (request, reply) => {
  if (!ensureApiAuth(request, reply)) return;

  const { matchId } = request.params;
  const match = await getMatchById(matchId);
  if (!match) {
    return reply.code(404).send({ error: "match_not_found" });
  }

  return reply.send({ match: sanitizeInternalMatch(match) });
});

fastify.post("/v1/league/prepare-slot", async (request, reply) => {
  if (!ensureApiAuth(request, reply)) return;

  const body = request.body || {};
  const leagueId = String(body.leagueId || "").trim();
  const fixtureId = String(body.fixtureId || "").trim();
  const requestedMatchId = String(body.matchId || "").trim();
  const seasonId = String(body.seasonId || "").trim();
  const homeTeamId = String(body.homeTeamId || "").trim();
  const awayTeamId = String(body.awayTeamId || "").trim();
  const homeUserId = String(body.homeUserId || "").trim();
  const awayUserId = String(body.awayUserId || "").trim();
  const kickoffAt = body.kickoffAt ? new Date(body.kickoffAt).toISOString() : null;
  const homeTeamPayload = normalizeObjectPayload(body.homeTeamPayload);
  const awayTeamPayload = normalizeObjectPayload(body.awayTeamPayload);
  const resultUploadUrl = typeof body.resultUploadUrl === "string" ? body.resultUploadUrl.trim() : "";
  const replayUploadUrl = typeof body.replayUploadUrl === "string" ? body.replayUploadUrl.trim() : "";
  const videoUploadUrl = typeof body.videoUploadUrl === "string" ? body.videoUploadUrl.trim() : "";
  const requestToken = typeof body.requestToken === "string" ? body.requestToken.trim() : "";

  if (!leagueId || !fixtureId || !homeTeamId || !awayTeamId) {
    return reply
      .code(400)
      .send({ error: "leagueId, fixtureId, homeTeamId, awayTeamId required" });
  }

  const existing = await findLeagueMatchByFixture(leagueId, fixtureId);
  if (existing) {
    return reply.send({
      matchId: existing.id,
      state: existing.status,
      allocatedNodeId: existing.nodeId,
      nodeId: existing.nodeId,
      serverIp: existing.serverIp,
      serverPort: existing.serverPort,
      expiresAt: existing.kickoffAt || kickoffAt,
      reused: true,
    });
  }

  const matchId = requestedMatchId || makeId("lg");
  const sessionSecret = crypto.randomBytes(24).toString("hex");
  const callbackUrl = buildLifecycleCallbackUrl(matchId);
  const allocationResult = await allocateAcrossNodePool("league", {
    matchId,
    mode: "league",
    maxClients: Number(body.maxClients || config.defaultLeagueMaxClients),
    sessionSecret,
    homeTeamId,
    awayTeamId,
    homeUserId: homeUserId || null,
    awayUserId: awayUserId || null,
    seasonId: seasonId || null,
    leagueId,
    fixtureId,
    kickoffAt,
    homeTeamPayload: homeTeamPayload || undefined,
    awayTeamPayload: awayTeamPayload || undefined,
    resultUploadUrl: resultUploadUrl || undefined,
    replayUploadUrl: replayUploadUrl || undefined,
    videoUploadUrl: videoUploadUrl || undefined,
    requestToken: requestToken || undefined,
    autoStart: false,
    callbackUrl,
    callbackToken: config.callbackToken,
  });
  const node = allocationResult.node;
  const allocation = allocationResult.allocation;

  const match = {
    id: matchId,
    mode: "league",
    status: "warm",
    nodeId: normalizeNodeId(node),
    serverIp: allocation.serverIp,
    serverPort: allocation.serverPort,
    sessionSecret,
    homeTeamId,
    awayTeamId,
    homeUserId: homeUserId || null,
    awayUserId: awayUserId || null,
    seasonId: seasonId || null,
    leagueId,
    fixtureId,
    kickoffAt,
    endedReason: null,
    liveMinute: null,
    liveMinuteAt: null,
    updatedAt: nowIso(),
  };

  await storeMatch(match);

  return reply.send({
    matchId,
    state: match.status,
    allocatedNodeId: match.nodeId,
    nodeId: match.nodeId,
    serverIp: match.serverIp,
    serverPort: match.serverPort,
    expiresAt: kickoffAt,
  });
});

fastify.post("/v1/league/kickoff-slot", async (request, reply) => {
  if (!ensureApiAuth(request, reply)) return;

  const body = request.body || {};
  const matchId = String(body.matchId || "").trim();
  if (!matchId) {
    return reply.code(400).send({ error: "matchId required" });
  }

  const match = await getMatchById(matchId);
  if (!match) {
    return reply.code(404).send({ error: "match_not_found" });
  }

  const node = (config.nodeAgents || []).find(
    (item) => normalizeNodeId(item) === match.nodeId,
  );

  if (!node) {
    return reply.code(500).send({ error: "node_not_found_for_match" });
  }

  const started = await startOnNode(node, matchId);
  match.status = started.state || "running";
  match.updatedAt = nowIso();
  await storeMatch(match);

  return reply.send({
    matchId,
    state: match.status,
    nodeId: match.nodeId,
    serverIp: match.serverIp,
    serverPort: match.serverPort,
  });
});

fastify.post("/v1/internal/matches/:matchId/lifecycle", async (request, reply) => {
  if (!requireCallbackAuth(request, reply)) return;

  const { matchId } = request.params;
  const body = request.body || {};
  const state = typeof body.state === "string" ? body.state.trim() : "";
  const reason = String(body.reason || "").trim();
  const minute = parseLifecycleMinute(body.minute);
  const resultPayload = normalizeObjectPayload(body.result);
  const replayPayload = normalizeObjectPayload(body.replay);
  const videoPayload = normalizeObjectPayload(body.video);

  const match = await getMatchById(matchId);
  if (!match) {
    return reply.code(404).send({ error: "match_not_found" });
  }

  if (state) {
    match.status = state;
  }
  match.updatedAt = nowIso();

  if (reason) {
    match.endedReason = reason;
  }

  if (minute != null) {
    match.liveMinute = minute;
    match.liveMinuteAt = nowIso();
  }

  if (resultPayload) {
    if (Number.isFinite(resultPayload.homeGoals)) {
      match.homeScore = Number(resultPayload.homeGoals);
    }
    if (Number.isFinite(resultPayload.awayGoals)) {
      match.awayScore = Number(resultPayload.awayGoals);
    }
    const homeTeam = normalizeObjectPayload(resultPayload.homeTeam);
    const awayTeam = normalizeObjectPayload(resultPayload.awayTeam);
    if (homeTeam?.teamName) {
      match.homeTeamName = String(homeTeam.teamName);
    }
    if (awayTeam?.teamName) {
      match.awayTeamName = String(awayTeam.teamName);
    }
    match.resultPayload = resultPayload;
  }

  if (resultPayload && !state && match.status !== "ended") {
    match.status = "ended";
  }

  const inferredVideoPayload =
    videoPayload ||
    normalizeObjectPayload(
      normalizeObjectPayload(resultPayload?.extra)?.video,
    );

  if (replayPayload) {
    if (replayPayload.status) {
      match.replayStatus = String(replayPayload.status);
    }
    if (replayPayload.storagePath) {
      match.replayStoragePath = String(replayPayload.storagePath);
    }
  }

  if (inferredVideoPayload) {
    if (inferredVideoPayload.status) {
      match.videoStatus = String(inferredVideoPayload.status);
    } else if (inferredVideoPayload.success === true) {
      match.videoStatus = "ready";
    } else if (inferredVideoPayload.success === false) {
      match.videoStatus = "failed";
    }

    if (inferredVideoPayload.storagePath) {
      match.videoStoragePath = String(inferredVideoPayload.storagePath);
    }
    if (inferredVideoPayload.outputPath) {
      match.videoStoragePath = String(inferredVideoPayload.outputPath);
    }
    if (inferredVideoPayload.watchUrl) {
      match.videoWatchUrl = String(inferredVideoPayload.watchUrl);
    }
  }

  if ((state === "ended" || (resultPayload && match.status === "ended")) && !match.endedAt) {
    match.endedAt = nowIso();
  }

  await storeMatch(match);
  await forwardLeagueLifecycle(match, {
    state: match.status,
    reason,
    minute,
  });

  if (state === "failed") {
    clearPendingMatchRelease(match.id);
    await releaseMatchNodeAllocation(match, reason || state);
  } else if (state === "ended") {
    scheduleMatchNodeRelease(match, reason || state);
  }

  return reply.send({ ok: true, matchId, state: match.status });
});

fastify.setErrorHandler((error, _request, reply) => {
  fastify.log.error(error);

  if (reply.sent) {
    return;
  }

  const message = error?.message || "internal_error";
  const statusCode = Number(error?.statusCode || 500);
  reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 500).send({
    error: message,
  });
});

async function start() {
  try {
    await initPg();
  } catch (error) {
    fastify.log.warn(
      { err: error },
      "Postgres init failed. Falling back to in-memory state.",
    );
  }

  try {
    await initRedis();
  } catch (error) {
    fastify.log.warn(
      { err: error },
      "Redis init failed. Continuing without distributed lock.",
    );
  }

  await fastify.listen({ port: config.port, host: config.host });
  fastify.log.info({ port: config.port, host: config.host }, "match-control-api started");
}

start().catch((error) => {
  fastify.log.error(error);
  process.exit(1);
});
