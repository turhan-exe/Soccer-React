import "dotenv/config";
import os from "node:os";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import Fastify from "fastify";

const fastify = Fastify({ logger: true });

fastify.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (request, body, done) => {
    const raw = typeof body === "string" ? body.trim() : "";
    if (!raw) {
      done(null, {});
      return;
    }

    try {
      done(null, JSON.parse(raw));
    } catch (error) {
      done(error, undefined);
    }
  },
);

const config = {
  port: Number(process.env.PORT || 9090),
  host: process.env.HOST || "0.0.0.0",
  agentSecret: process.env.NODE_AGENT_SECRET || "",
  nodeId: process.env.NODE_ID || os.hostname(),
  publicIp: process.env.NODE_PUBLIC_IP || "",
  privateIp: process.env.NODE_PRIVATE_IP || "",
  unityBinaryPath: process.env.UNITY_SERVER_BINARY || "/app/OSMHeadless.x86_64",
  unityWorkingDir: process.env.UNITY_SERVER_WORKDIR || "",
  allocatablePorts: parsePorts(process.env.ALLOCATABLE_PORTS || "21001,21002,21003"),
  defaultMaxClients: Number(process.env.DEFAULT_MAX_CLIENTS || 2),
  autoReleaseOnExit: toBool(process.env.AUTO_RELEASE_ON_EXIT, true),
  processKillTimeoutMs: Number(process.env.PROCESS_KILL_TIMEOUT_MS || 6000),
  matchHardTimeoutMs: Number(
    process.env.MATCH_HARD_TIMEOUT_MS || process.env.LIVE_MATCH_HARD_TIMEOUT_MS || 30 * 60 * 1000,
  ),
  matchMinuteHeartbeatEnabled: toBool(process.env.MATCH_MINUTE_HEARTBEAT_ENABLED, true),
  matchMinuteCloseThreshold: Number(process.env.MATCH_MINUTE_CLOSE_THRESHOLD || 90),
  matchMinuteCloseGraceMs: Number(process.env.MATCH_MINUTE_CLOSE_GRACE_MS || 300_000),
  callbackBaseUrl: process.env.MATCH_CONTROL_CALLBACK_BASE_URL || "",
  callbackToken: process.env.MATCH_CONTROL_CALLBACK_TOKEN || "",
  unityMatchRole: normalizeUnityMatchRole(
    process.env.UNITY_MATCH_ROLE || process.env.MATCH_ROLE || "server",
  ),
  unityCallbackUrl: process.env.UNITY_MATCH_CONTROL_CALLBACK_URL || "",
  unityCallbackToken: process.env.UNITY_MATCH_CONTROL_CALLBACK_TOKEN || "",
  unityCallbackAllowInsecureHttp: toBool(
    process.env.UNITY_MATCH_CONTROL_CALLBACK_ALLOW_INSECURE_HTTP,
    false,
  ),
  debugChildLogs: toBool(process.env.NODE_AGENT_DEBUG_CHILD_LOGS, false),
  ffmpegBinary: process.env.FFMPEG_BINARY || "ffmpeg",
  xvfbRunBinary: process.env.XVFB_RUN_BINARY || "xvfb-run",
  recordingWidth: Number(process.env.MATCH_VIDEO_WIDTH || 1920),
  recordingHeight: Number(process.env.MATCH_VIDEO_HEIGHT || 1080),
  recordingFps: Number(process.env.MATCH_VIDEO_FPS || 20),
  recordingsDir:
    process.env.NODE_AGENT_RECORDINGS_DIR || path.join(process.cwd(), "recordings"),
  payloadsDir:
    process.env.NODE_AGENT_PAYLOADS_DIR || path.join(os.tmpdir(), "fhs-match-payloads"),
};

const allocations = new Map();

async function postLifecycleUpdate(allocation, payload) {
  if (!allocation?.callbackUrl) {
    return;
  }

  try {
    const response = await fetch(allocation.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(allocation.callbackToken
          ? { Authorization: `Bearer ${allocation.callbackToken}` }
          : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      fastify.log.warn(
        {
          matchId: allocation.matchId,
          status: response.status,
          body: text,
          payload,
        },
        "match_lifecycle_callback_failed",
      );
    }
  } catch (error) {
    fastify.log.warn(
      {
        err: error,
        matchId: allocation.matchId,
        payload,
      },
      "match_lifecycle_callback_error",
    );
  }
}

function buildVideoPayloadFromResult(result) {
  const extra = result && typeof result === "object" ? result.extra : null;
  const video = extra && typeof extra === "object" ? extra.video : null;
  if (!video || typeof video !== "object") {
    return null;
  }

  const payload = {};
  if (typeof video.status === "string" && video.status.trim()) {
    payload.status = video.status.trim();
  } else if (video.success === true) {
    payload.status = "ready";
  } else if (video.success === false) {
    payload.status = "failed";
  }

  if (typeof video.outputPath === "string" && video.outputPath.trim()) {
    payload.storagePath = video.outputPath.trim();
  } else if (typeof video.storagePath === "string" && video.storagePath.trim()) {
    payload.storagePath = video.storagePath.trim();
  }

  if (typeof video.watchUrl === "string" && video.watchUrl.trim()) {
    payload.watchUrl = video.watchUrl.trim();
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

async function maybePublishRecordedVideo(allocation, source = "unknown") {
  if (!allocation || allocation.videoPublished) {
    return false;
  }

  const finalizedVideo = finalizeRecordedVideo(allocation);
  if (!finalizedVideo) {
    return false;
  }

  allocation.videoPublished = true;
  allocation.videoPayload = finalizedVideo;
  allocation.updatedAt = nowIso();

  await postLifecycleUpdate(allocation, {
    video: finalizedVideo,
  });

  fastify.log.info(
    {
      matchId: allocation.matchId,
      source,
      storagePath: finalizedVideo.storagePath,
      watchUrl: finalizedVideo.watchUrl,
    },
    "live_video_published",
  );

  return true;
}

function clearVideoPublishRetry(allocation) {
  if (!allocation?.videoPublishRetryTimer) {
    return;
  }

  clearTimeout(allocation.videoPublishRetryTimer);
  allocation.videoPublishRetryTimer = null;
}

function scheduleVideoPublishRetry(allocation, source = "unknown", attempt = 0) {
  if (!allocation || allocation.videoPublished || !shouldEnableLiveVideoForAllocation()) {
    return;
  }

  clearVideoPublishRetry(allocation);

  const normalizedAttempt = Math.max(0, Number(attempt) || 0);
  const maxAttempts = 12;
  const delayMs = normalizedAttempt === 0 ? 750 : 1000;

  allocation.videoPublishRetryTimer = setTimeout(async () => {
    allocation.videoPublishRetryTimer = null;

    try {
      const published = await maybePublishRecordedVideo(
        allocation,
        `${source}_retry_${normalizedAttempt}`,
      );
      if (!published && normalizedAttempt + 1 < maxAttempts) {
        scheduleVideoPublishRetry(allocation, source, normalizedAttempt + 1);
        return;
      }
      if (!published) {
        fastify.log.warn(
          {
            matchId: allocation.matchId,
            source,
            attempts: normalizedAttempt + 1,
            outputPath: allocation.videoOutputPath || null,
          },
          "live_video_publish_retry_exhausted",
        );
      }
    } catch (error) {
      fastify.log.warn(
        {
          err: error,
          matchId: allocation.matchId,
          source,
          attempt: normalizedAttempt,
        },
        "live_video_publish_retry_failed",
      );
      if (normalizedAttempt + 1 < maxAttempts) {
        scheduleVideoPublishRetry(allocation, source, normalizedAttempt + 1);
      }
    }
  }, delayMs);
}

async function handleUnityResultLine(allocation, line) {
  if (!allocation || allocation.resultForwarded) {
    return;
  }

  const marker = "unityMatchFinished =>";
  const markerIndex = line.indexOf(marker);
  if (markerIndex < 0) {
    return;
  }

  const rawJson = line.slice(markerIndex + marker.length).trim();
  if (!rawJson) {
    return;
  }

  try {
    const result = JSON.parse(rawJson);
    allocation.resultForwarded = true;
    allocation.terminalLifecycleState = "ended";
    clearHardTimeoutTimer(allocation);
    clearMinuteCloseTimer(allocation);
    allocation.finalResult = result;
    allocation.updatedAt = nowIso();

    const payload = {
      state: "ended",
      reason: "finished",
      result,
    };

    const video = buildVideoPayloadFromResult(result);
    if (video) {
      payload.video = video;
    }

    await postLifecycleUpdate(allocation, payload);
    fastify.log.info({ matchId: allocation.matchId }, "unity_match_result_forwarded");

    if (allocation.videoEncodingCompleted || !allocation.videoProcess) {
      const published = await maybePublishRecordedVideo(allocation, "unity_result_line");
      if (!published) {
        scheduleVideoPublishRetry(allocation, "unity_result_line");
      }
    } else if (video) {
      scheduleVideoPublishRetry(allocation, "unity_result_line");
    }
  } catch (error) {
    fastify.log.warn(
      {
        err: error,
        matchId: allocation.matchId,
        rawJson,
      },
      "unity_match_result_parse_failed",
    );
  }
}

async function maybeHandleUnityLifecycleLine(allocation, line) {
  if (!allocation || allocation.readyForwarded) {
    return;
  }

  const normalized = String(line || "").trim();
  if (!normalized) {
    return;
  }

  const readySignals = [
    "Server listening on port",
    "[MatchNetworkManager][OnStartServer]",
  ];

  if (!readySignals.some((signal) => normalized.includes(signal))) {
    return;
  }

  allocation.readyForwarded = true;
  allocation.state = "running";
  allocation.updatedAt = nowIso();

  fastify.log.info(
    {
      matchId: allocation.matchId,
      line: normalized,
    },
    "unity_server_ready_detected",
  );

  await postLifecycleUpdate(allocation, {
    state: "server_started",
    reason: "node_agent_detected_server_ready",
  });
}

function parseMinuteToken(raw) {
  if (raw == null || raw === "") {
    return null;
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
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

  const normalizedDecimal = text.replace(",", ".");
  const decimalMatch = normalizedDecimal.match(/^(\d{1,3})(?:\.\d+)?$/);
  if (decimalMatch) {
    const minute = Math.trunc(Number(decimalMatch[1]));
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

function parseMatchMinuteFromLine(line) {
  const normalized = String(line || "").trim();
  if (!normalized) {
    return null;
  }

  const patterns = [
    // [MatchManager] Status: Playing, Minutes: 22,35357, IsServer: True
    /\bminutes?\b[^\d]{0,12}(\d{1,3}(?:[.,]\d+)?(?:\s*\+\s*\d{1,2})?)/i,
    // prevMinute=12,03 incomingMinute=12,08 minuteReference=12,08
    /\b(?:prevMinute|incomingMinute|minuteReference)\b\s*[:=]\s*(\d{1,3}(?:[.,]\d+)?)/i,
    // dakika 45+2
    /\bdakika\b[^\d]{0,12}(\d{1,3}(?:\s*\+\s*\d{1,2})?)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }

    const minute = parseMinuteToken(match[1]);
    if (Number.isInteger(minute)) {
      return minute;
    }
  }

  return null;
}

function normalizeTimeoutMs(rawValue, fallbackMs) {
  const raw = Number(rawValue);
  const fallback = Number(fallbackMs);
  const resolved = Number.isFinite(raw) ? raw : fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    return 0;
  }
  return Math.max(1_000, Math.trunc(resolved));
}

function isTerminalAllocationState(allocation) {
  if (!allocation) {
    return true;
  }
  if (allocation.resultForwarded) {
    return true;
  }
  if (allocation.terminalLifecycleState) {
    return true;
  }
  return ["failed", "ended", "released", "stopping"].includes(allocation.state);
}

function clearHardTimeoutTimer(allocation) {
  if (!allocation) {
    return;
  }
  if (!allocation?.hardTimeoutTimer) {
    allocation.hardTimeoutAt = null;
    return;
  }
  clearTimeout(allocation.hardTimeoutTimer);
  allocation.hardTimeoutTimer = null;
  allocation.hardTimeoutAt = null;
}

function clearMinuteCloseTimer(allocation) {
  if (!allocation) {
    return;
  }
  if (!allocation?.minuteCloseTimer) {
    allocation.minuteCloseDueAt = null;
    return;
  }
  clearTimeout(allocation.minuteCloseTimer);
  allocation.minuteCloseTimer = null;
  allocation.minuteCloseDueAt = null;
}

function clearAllocationTimers(allocation) {
  clearHardTimeoutTimer(allocation);
  clearMinuteCloseTimer(allocation);
}

async function forceStopAllocation(allocation, { reason, state = "failed", source = "unknown" }) {
  if (!allocation?.process || isTerminalAllocationState(allocation)) {
    return false;
  }

  allocation.terminalLifecycleState = state;
  allocation.releaseReason = reason;
  allocation.updatedAt = nowIso();
  clearAllocationTimers(allocation);

  await postLifecycleUpdate(allocation, {
    state,
    reason,
    minute: Number.isInteger(allocation.liveMinute) ? allocation.liveMinute : undefined,
  });

  await stopProcess(allocation, reason);
  fastify.log.warn(
    {
      matchId: allocation.matchId,
      reason,
      state,
      minute: allocation.liveMinute ?? null,
      source,
    },
    "allocation_forced_stop",
  );
  return true;
}

function scheduleHardTimeout(allocation) {
  if (!allocation?.process) {
    return;
  }

  const timeoutMs = normalizeTimeoutMs(config.matchHardTimeoutMs, 30 * 60 * 1000);
  if (!timeoutMs) {
    return;
  }

  clearHardTimeoutTimer(allocation);
  allocation.hardTimeoutAt = new Date(Date.now() + timeoutMs).toISOString();
  const timeoutMinutes = Math.max(1, Math.round(timeoutMs / 60_000));

  allocation.hardTimeoutTimer = setTimeout(() => {
    allocation.hardTimeoutTimer = null;
    allocation.hardTimeoutAt = null;
    void forceStopAllocation(allocation, {
      reason: `hard_timeout_${timeoutMinutes}m`,
      state: "failed",
      source: "hard_timeout",
    });
  }, timeoutMs);
}

function scheduleMinuteCloseAfterNinety(allocation, reachedMinute) {
  if (!allocation?.process || isTerminalAllocationState(allocation)) {
    return;
  }

  const threshold = Math.max(1, Math.trunc(Number(config.matchMinuteCloseThreshold || 90)));
  if (!Number.isInteger(reachedMinute) || reachedMinute < threshold) {
    return;
  }
  if (allocation.minuteCloseTimer) {
    return;
  }

  const graceMs = normalizeTimeoutMs(config.matchMinuteCloseGraceMs, 60_000);
  if (!graceMs) {
    return;
  }

  allocation.minuteCloseDueAt = new Date(Date.now() + graceMs).toISOString();
  allocation.minuteCloseTimer = setTimeout(() => {
    allocation.minuteCloseTimer = null;
    allocation.minuteCloseDueAt = null;
    void forceStopAllocation(allocation, {
      reason: `minute_${threshold}_plus_grace_timeout`,
      state: "failed",
      source: "minute_close_guard",
    });
  }, graceMs);

  fastify.log.info(
    {
      matchId: allocation.matchId,
      reachedMinute,
      threshold,
      graceMs,
      dueAt: allocation.minuteCloseDueAt,
    },
    "minute_close_guard_armed",
  );
}

async function maybeHandleUnityMinuteHeartbeatLine(allocation, line) {
  if (!config.matchMinuteHeartbeatEnabled) {
    return;
  }
  if (!allocation?.process || isTerminalAllocationState(allocation)) {
    return;
  }

  const minute = parseMatchMinuteFromLine(line);
  if (!Number.isInteger(minute)) {
    return;
  }

  const lastMinute = Number.isInteger(allocation.liveMinute) ? allocation.liveMinute : null;
  if (lastMinute != null && minute <= lastMinute) {
    return;
  }

  allocation.liveMinute = minute;
  allocation.liveMinuteAt = nowIso();
  allocation.updatedAt = allocation.liveMinuteAt;

  await postLifecycleUpdate(allocation, {
    state: "running",
    reason: "minute_heartbeat",
    minute,
  });

  scheduleMinuteCloseAfterNinety(allocation, minute);
}

function parsePorts(raw) {
  return String(raw || "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isInteger(x) && x > 0 && x < 65536)
    .sort((a, b) => a - b);
}

function toBool(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  const lowered = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(lowered)) return true;
  if (["0", "false", "no", "n", "off"].includes(lowered)) return false;
  return fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function ensureRecordingsDir() {
  mkdirSync(config.recordingsDir, { recursive: true });
}

function isLiveVideoRecordingEnabled() {
  return toBool(
    process.env.MATCH_VIDEO_RECORDING ?? process.env.UNITY_VIDEO_RECORDING,
    false,
  );
}

function shouldUseVirtualDisplayForRecording() {
  return process.platform === "linux" && isLiveVideoRecordingEnabled();
}

function shouldEnableLiveVideoForAllocation() {
  return toBool(process.env.NODE_AGENT_ENABLE_LIVE_VIDEO, false) && isLiveVideoRecordingEnabled();
}

function hasUsableXvfb() {
  if (!shouldUseVirtualDisplayForRecording()) {
    return false;
  }

  try {
    const result = spawnSync(config.xvfbRunBinary, ["--help"], {
      stdio: "ignore",
      timeout: 2000,
    });
    return result.status === 0 || result.status === 1;
  } catch {
    return false;
  }
}

function canRenderLiveVideo() {
  if (!shouldEnableLiveVideoForAllocation()) {
    return false;
  }

  if (!shouldUseVirtualDisplayForRecording()) {
    return true;
  }

  return hasUsableXvfb();
}

function buildRecordedVideoPath(matchId) {
  ensureRecordingsDir();
  return path.join(config.recordingsDir, `${String(matchId)}.mp4`);
}

function buildLiveVideoPipePath(matchId) {
  return path.join("/tmp", `${String(matchId)}.render.pipe`);
}

function buildLiveVideoTempOutputPath(matchId) {
  return path.join("/tmp", `${String(matchId)}.render.mp4`);
}

function buildVideoWatchUrl(matchId) {
  return `http://${safePublicIp()}:${config.port}/agent/v1/videos/${encodeURIComponent(String(matchId))}`;
}

function normalizeObjectPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function encodePayloadForEnv(value) {
  const normalized = normalizeObjectPayload(value);
  if (!normalized) return "";
  try {
    return Buffer.from(JSON.stringify(normalized), "utf8").toString("base64");
  } catch {
    return "";
  }
}

function encodePayloadForArg(value) {
  const normalized = normalizeObjectPayload(value);
  if (!normalized) return "";
  try {
    return JSON.stringify(normalized);
  } catch {
    return "";
  }
}

function normalizeMode(rawMode) {
  const mode = String(rawMode || "friendly").toLowerCase();
  return mode === "league" ? "league" : "friendly";
}

function normalizeUnityMatchRole(rawRole) {
  const role = String(rawRole || "server").trim().toLowerCase();
  if (role === "host" || role === "client") {
    return role;
  }
  return "server";
}

function ensurePayloadsDir() {
  mkdirSync(config.payloadsDir, { recursive: true });
}

function buildPayloadFilePath(matchId, side) {
  const safeMatchId = String(matchId || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(config.payloadsDir, `${safeMatchId}.${side}.json`);
}

function cleanupPayloadFiles(allocation) {
  for (const payloadPath of [
    allocation?.homeTeamPayloadPath,
    allocation?.awayTeamPayloadPath,
  ]) {
    if (!payloadPath) continue;
    try {
      rmSync(payloadPath, { force: true });
    } catch {}
  }

  if (allocation) {
    allocation.homeTeamPayloadPath = "";
    allocation.awayTeamPayloadPath = "";
  }
}

function preparePayloadFiles(allocation) {
  cleanupPayloadFiles(allocation);
  ensurePayloadsDir();

  const homePayload = normalizeObjectPayload(allocation?.homeTeamPayload);
  if (homePayload) {
    const homePath = buildPayloadFilePath(allocation.matchId, "home");
    writeFileSync(homePath, JSON.stringify(homePayload), "utf8");
    allocation.homeTeamPayloadPath = homePath;
  }

  const awayPayload = normalizeObjectPayload(allocation?.awayTeamPayload);
  if (awayPayload) {
    const awayPath = buildPayloadFilePath(allocation.matchId, "away");
    writeFileSync(awayPath, JSON.stringify(awayPayload), "utf8");
    allocation.awayTeamPayloadPath = awayPath;
  }
}

function getBearerToken(request) {
  const auth = request.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function requireAgentAuth(request, reply) {
  if (!config.agentSecret) return true;
  if (getBearerToken(request) !== config.agentSecret) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

function isPortReservedByAllocation(allocation) {
  if (!allocation) return false;
  return ["allocated", "starting", "running", "stopping"].includes(allocation.state);
}

function isPidAlive(pid) {
  const normalizedPid = Number(pid || 0);
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) {
    return false;
  }

  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") {
      return true;
    }
    if (error?.code === "ESRCH") {
      return false;
    }
    return false;
  }
}

function pruneStaleInMemoryAllocations(source = "unknown") {
  let released = 0;
  for (const [matchId, allocation] of allocations.entries()) {
    if (!allocation) {
      allocations.delete(matchId);
      continue;
    }
    if (!isPortReservedByAllocation(allocation)) {
      continue;
    }
    if (allocation.process) {
      continue;
    }
    if (allocation.pid && isPidAlive(allocation.pid)) {
      continue;
    }

    // League warm allocations are intentionally process-less until kickoff.
    // Keep them reserved until shortly after their planned kickoff time.
    if (allocation.state === "allocated" && allocation.mode === "league") {
      const kickoffAtMs = Date.parse(allocation.kickoffAt || "");
      const createdAtMs = Date.parse(allocation.createdAt || allocation.updatedAt || "");
      const retainUntilMs = Number.isFinite(kickoffAtMs)
        ? kickoffAtMs + 2 * 60 * 60 * 1000
        : createdAtMs + 2 * 60 * 60 * 1000;
      if (Number.isFinite(retainUntilMs) && Date.now() <= retainUntilMs) {
        continue;
      }
    }

    allocation.state = "released";
    allocation.releaseReason = allocation.releaseReason || `stale_in_memory_${source}`;
    allocation.pid = null;
    allocation.updatedAt = nowIso();
    allocations.delete(matchId);
    released += 1;
  }

  if (released > 0) {
    fastify.log.warn({ source, released }, "stale_in_memory_allocations_pruned");
  }

  return released;
}

function getReservedPorts() {
  pruneStaleInMemoryAllocations("getReservedPorts");
  const result = new Set();
  for (const allocation of allocations.values()) {
    if (isPortReservedByAllocation(allocation)) {
      result.add(allocation.serverPort);
    }
  }
  return result;
}

function getSystemListeningPorts() {
  const ports = new Set();

  try {
    const result = spawnSync("ss", ["-ltnH"], {
      encoding: "utf8",
      timeout: 2000,
    });

    if (result.status !== 0) {
      return ports;
    }

    const allocatablePortSet = new Set(config.allocatablePorts);
    for (const line of String(result.stdout || "").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const columns = trimmed.split(/\s+/);
      if (columns.length < 4) continue;

      const localAddress = columns[3];
      const match = localAddress.match(/:(\d+)$/);
      if (!match) continue;

      const port = Number(match[1]);
      if (allocatablePortSet.has(port)) {
        ports.add(port);
      }
    }
  } catch {}

  return ports;
}

function listManagedUnityProcesses() {
  const entries = [];
  const expectedBinary = path.resolve(config.unityBinaryPath);
  const expectedBinaryName = path.basename(expectedBinary);

  try {
    const result = spawnSync("ps", ["-eo", "pid=,args="], {
      encoding: "utf8",
      timeout: 3000,
    });

    if (result.status !== 0) {
      return entries;
    }

    for (const line of String(result.stdout || "").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const match = trimmed.match(/^(\d+)\s+(.+)$/);
      if (!match) continue;

      const pid = Number(match[1]);
      const args = match[2] || "";
      if (!Number.isInteger(pid) || pid <= 0) continue;

      if (
        args.includes(expectedBinary) ||
        args.includes(`/${expectedBinaryName}`) ||
        args.includes(`\\${expectedBinaryName}`)
      ) {
        entries.push({ pid, args });
      }
    }
  } catch {}

  return entries;
}

async function cleanupOrphanedUnityProcesses(source = "unknown") {
  const trackedPids = new Set(
    Array.from(allocations.values())
      .map((allocation) => Number(allocation?.pid || 0))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  );

  const orphaned = listManagedUnityProcesses().filter(
    (entry) => !trackedPids.has(entry.pid),
  );

  if (!orphaned.length) {
    fastify.log.info({ source }, "orphan_unity_cleanup_noop");
    return 0;
  }

  fastify.log.warn(
    {
      source,
      count: orphaned.length,
      pids: orphaned.map((entry) => entry.pid),
    },
    "orphan_unity_cleanup_started",
  );

  for (const entry of orphaned) {
    try {
      process.kill(entry.pid, "SIGTERM");
    } catch {}
  }

  await sleep(1500);

  const orphanedPidSet = new Set(orphaned.map((entry) => entry.pid));
  const remaining = listManagedUnityProcesses().filter(
    (entry) => orphanedPidSet.has(entry.pid) && !trackedPids.has(entry.pid),
  );

  for (const entry of remaining) {
    try {
      process.kill(entry.pid, "SIGKILL");
    } catch {}
  }

  if (remaining.length) {
    await sleep(500);
  }

  const survivors = listManagedUnityProcesses().filter(
    (entry) => orphanedPidSet.has(entry.pid) && !trackedPids.has(entry.pid),
  );

  fastify.log.warn(
    {
      source,
      terminated: orphaned.length - survivors.length,
      survivorPids: survivors.map((entry) => entry.pid),
    },
    "orphan_unity_cleanup_finished",
  );

  return orphaned.length - survivors.length;
}

function pickFreePort() {
  const reserved = getReservedPorts();
  const listening = getSystemListeningPorts();
  return (
    config.allocatablePorts.find(
      (port) => !reserved.has(port) && !listening.has(port),
    ) || null
  );
}

function safePublicIp() {
  return config.publicIp || config.privateIp || "127.0.0.1";
}

function computeCapacity() {
  pruneStaleInMemoryAllocations("computeCapacity");
  const totalSlots = config.allocatablePorts.length;
  let usedSlots = 0;
  let runningSlots = 0;

  for (const allocation of allocations.values()) {
    if (isPortReservedByAllocation(allocation)) {
      usedSlots += 1;
    }
    if (allocation.state === "running") {
      runningSlots += 1;
    }
  }

  const freeSlots = Math.max(0, totalSlots - usedSlots);
  const cpuLoad = os.loadavg()[0] || 0;

  return {
    nodeId: config.nodeId,
    serverIp: safePublicIp(),
    totalSlots,
    usedSlots,
    runningSlots,
    freeSlots,
    cpuLoad,
    timestamp: nowIso(),
  };
}

function allocationSummary(allocation) {
  return {
    matchId: allocation.matchId,
    mode: allocation.mode,
    unityMatchRole: allocation.unityMatchRole,
    state: allocation.state,
    nodeId: config.nodeId,
    serverIp: safePublicIp(),
    serverPort: allocation.serverPort,
    pid: allocation.pid || null,
    maxClients: allocation.maxClients,
    leagueId: allocation.leagueId || null,
    fixtureId: allocation.fixtureId || null,
    createdAt: allocation.createdAt,
    updatedAt: allocation.updatedAt,
    liveMinute: Number.isInteger(allocation.liveMinute) ? allocation.liveMinute : null,
    liveMinuteAt: allocation.liveMinuteAt || null,
    hardTimeoutAt: allocation.hardTimeoutAt || null,
    minuteCloseDueAt: allocation.minuteCloseDueAt || null,
    lastExitCode: allocation.lastExitCode ?? null,
    lastExitSignal: allocation.lastExitSignal ?? null,
    releaseReason: allocation.releaseReason || null,
  };
}

function buildCallbackUrl(allocation, body) {
  if (body?.callbackUrl) {
    return String(body.callbackUrl);
  }

  if (!config.callbackBaseUrl) {
    return "";
  }

  return `${config.callbackBaseUrl.replace(/\/$/, "")}/v1/internal/matches/${encodeURIComponent(allocation.matchId)}/lifecycle`;
}

function withMatchIdPlaceholder(url, matchId) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  return raw.replace(/\{matchId\}/g, encodeURIComponent(String(matchId || "").trim()));
}

function resolveUnityCallbackConfig(allocation, body) {
  const bodyUrl = withMatchIdPlaceholder(body?.unityCallbackUrl, allocation.matchId);
  const envUrl = withMatchIdPlaceholder(config.unityCallbackUrl, allocation.matchId);
  const fallbackUrl = String(allocation.callbackUrl || "").trim();

  let url = bodyUrl || envUrl || fallbackUrl;
  let suppressedInsecureHttp = false;

  if (url.startsWith("http://") && !config.unityCallbackAllowInsecureHttp) {
    suppressedInsecureHttp = true;
    url = "";
  }

  const bodyToken = String(body?.unityCallbackToken || "").trim();
  const envToken = String(config.unityCallbackToken || "").trim();
  const fallbackToken = String(allocation.callbackToken || "").trim();
  const token = url ? bodyToken || envToken || fallbackToken : "";

  return {
    url,
    token,
    suppressedInsecureHttp,
  };
}

function buildProcessArgs(allocation) {
  const args = [
    "-batchmode",
    "--listen-port",
    String(allocation.serverPort),
    "--match-id",
    allocation.matchId,
    "--session-secret",
    allocation.sessionSecret,
    "--mode",
    allocation.mode,
    "--match-role",
    allocation.unityMatchRole,
    "--max-clients",
    String(allocation.maxClients),
    "--auto-start-server",
    "true",
  ];

  if (!canRenderLiveVideo()) {
    args.splice(1, 0, "-nographics");
  }

  if (allocation.homeTeamId) {
    args.push("--home-team-id", allocation.homeTeamId);
  }

  if (allocation.awayTeamId) {
    args.push("--away-team-id", allocation.awayTeamId);
  }

  if (allocation.unityCallbackUrl) {
    args.push("--match-control-callback-url", allocation.unityCallbackUrl);
  }

  if (allocation.unityCallbackToken) {
    args.push("--match-control-callback-token", allocation.unityCallbackToken);
  }

  return args;
}

function buildChildEnv(allocation) {
  const liveVideoRecordingEnabled = canRenderLiveVideo();

  return {
    ...process.env,
    LISTEN_PORT: String(allocation.serverPort),
    MATCH_ID: allocation.matchId,
    SESSION_SECRET: allocation.sessionSecret,
    MATCH_MODE: allocation.mode,
    MATCH_ROLE: allocation.unityMatchRole,
    MATCH_MAX_CLIENTS: String(allocation.maxClients),
    MATCH_CONTROL_CALLBACK_URL: allocation.unityCallbackUrl || "",
    MATCH_CONTROL_CALLBACK_TOKEN: allocation.unityCallbackToken || "",
    AUTO_START_SERVER: "true",
    LEAGUE_ID: allocation.leagueId || "",
    FIXTURE_ID: allocation.fixtureId || "",
    SEASON_ID: allocation.seasonId || "",
    HOME_USER_ID: allocation.homeUserId || "",
    AWAY_USER_ID: allocation.awayUserId || "",
    HOME_TEAM_ID: allocation.homeTeamId || "",
    AWAY_TEAM_ID: allocation.awayTeamId || "",
    HOME_TEAM_PAYLOAD_PATH: allocation.homeTeamPayloadPath || "",
    AWAY_TEAM_PAYLOAD_PATH: allocation.awayTeamPayloadPath || "",
    HOME_TEAM_PAYLOAD_JSON: "",
    AWAY_TEAM_PAYLOAD_JSON: "",
    HOME_TEAM_PAYLOAD_B64: "",
    AWAY_TEAM_PAYLOAD_B64: "",
    // Some FHS runtime variants read UNITY_* keys instead of generic keys.
    UNITY_MATCH_ID: allocation.matchId,
    UNITY_SESSION_SECRET: allocation.sessionSecret,
    UNITY_MATCH_MODE: allocation.mode,
    UNITY_MATCH_ROLE: allocation.unityMatchRole,
    UNITY_AUTO_START_SERVER: "true",
    UNITY_LISTEN_PORT: String(allocation.serverPort),
    UNITY_SERVER_PORT: String(allocation.serverPort),
    UNITY_SERVER_IP: safePublicIp(),
    UNITY_MAX_CLIENTS: String(allocation.maxClients),
    UNITY_HOME_TEAM_ID: allocation.homeTeamId || "",
    UNITY_AWAY_TEAM_ID: allocation.awayTeamId || "",
    UNITY_HOME_TEAM_PAYLOAD_PATH: allocation.homeTeamPayloadPath || "",
    UNITY_AWAY_TEAM_PAYLOAD_PATH: allocation.awayTeamPayloadPath || "",
    LIVE_MATCH_RESULT_UPLOAD_URL: allocation.resultUploadUrl || "",
    LIVE_MATCH_REPLAY_UPLOAD_URL: allocation.replayUploadUrl || "",
    LIVE_MATCH_VIDEO_UPLOAD_URL: allocation.videoUploadUrl || "",
    LIVE_MATCH_REQUEST_TOKEN: allocation.requestToken || "",
    MATCH_VIDEO_RECORDING: liveVideoRecordingEnabled ? "true" : "",
    MATCH_VIDEO_PIPE_PATH: allocation.videoPipePath || "",
    MATCH_VIDEO_OUTPUT_PATH: allocation.videoOutputPath || "",
    LIBGL_ALWAYS_SOFTWARE: shouldUseVirtualDisplayForRecording() ? "1" : (process.env.LIBGL_ALWAYS_SOFTWARE || ""),
    MESA_LOADER_DRIVER_OVERRIDE: shouldUseVirtualDisplayForRecording() ? "llvmpipe" : (process.env.MESA_LOADER_DRIVER_OVERRIDE || ""),
    // Live friendly/league servers are not replay-render workers.
    // If these envs leak through, Unity enters RenderBootstrap and exits early.
    UNITY_VIDEO_RECORDING: "",
    REPLAY_URL: "",
    REPLAY_PATH: "",
    VIDEO_UPLOAD_URL: "",
    VIDEO_PATH: "",
    VIDEO_STORAGE_PATH: "",
    RENDER_FAST: "",
    RENDER_QUALITY: "",
    RENDER_WIDTH: "",
    RENDER_HEIGHT: "",
    RENDER_FPS: "",
    RENDER_UI: "",
    RENDER_CROWD: "",
  };
}

function finalizeRecordedVideo(allocation) {
  const result = allocation?.finalResult;
  const extra = result && typeof result === "object" ? result.extra : null;
  const video = extra && typeof extra === "object" ? extra.video : null;
  const sourcePath =
    typeof video?.outputPath === "string" && video.outputPath.trim()
      ? video.outputPath.trim()
      : typeof video?.storagePath === "string" && video.storagePath.trim()
        ? video.storagePath.trim()
        : allocation?.videoOutputPath || "";

  if (!sourcePath || !existsSync(sourcePath)) {
    return null;
  }

  const targetPath = buildRecordedVideoPath(allocation.matchId);
  if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
    copyFileSync(sourcePath, targetPath);
  }

  const stats = statSync(targetPath);
  if (!stats.isFile() || stats.size <= 0) {
    return null;
  }

  return {
    status: "ready",
    storagePath: targetPath,
    watchUrl: buildVideoWatchUrl(allocation.matchId),
  };
}

function validateUnityBinaryPath() {
  try {
    accessSync(config.unityBinaryPath, fsConstants.X_OK);
  } catch (error) {
    if (error?.code === "EACCES" && existsSync(config.unityBinaryPath)) {
      // Windows-produced runtime archives can lose the execute bit on Linux.
      // Self-heal once before failing the allocation start.
      chmodSync(config.unityBinaryPath, 0o755);
      accessSync(config.unityBinaryPath, fsConstants.X_OK);
      fastify.log.warn(
        { unityBinaryPath: config.unityBinaryPath },
        "unity_binary_execute_bit_restored",
      );
      return;
    }
    throw error;
  }
}

async function stopProcess(allocation, reason = "released") {
  const child = allocation.process;
  clearAllocationTimers(allocation);
  if (
    !allocation.terminalLifecycleState &&
    (reason === "deleted_via_api" || String(reason || "").startsWith("shutdown_"))
  ) {
    allocation.terminalLifecycleState = "released";
  }
  allocation.state = "stopping";
  allocation.updatedAt = nowIso();
  allocation.releaseReason = reason;

  if (!child || child.killed) {
    allocation.state = "released";
    allocation.updatedAt = nowIso();
    cleanupPayloadFiles(allocation);
    return;
  }

  await new Promise((resolve) => {
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      finish();
    }, Math.max(1000, config.processKillTimeoutMs));

    child.once("exit", () => {
      clearTimeout(timeout);
      finish();
    });

    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(timeout);
      finish();
    }
  });

  allocation.state = "released";
  allocation.updatedAt = nowIso();
  cleanupPayloadFiles(allocation);
}

function cleanupLiveVideoArtifacts(allocation) {
  for (const artifactPath of [allocation?.videoPipePath, allocation?.videoOutputPath]) {
    if (!artifactPath) continue;
    try {
      rmSync(artifactPath, { force: true });
    } catch {}
  }
}

function prepareLiveVideoRecording(allocation) {
  if (!canRenderLiveVideo()) {
    allocation.videoPipePath = "";
    allocation.videoOutputPath = "";
    allocation.videoProcess = null;
    return;
  }

  ensureRecordingsDir();

  allocation.videoPipePath = buildLiveVideoPipePath(allocation.matchId);
  allocation.videoOutputPath = buildLiveVideoTempOutputPath(allocation.matchId);
  allocation.videoProcess = null;

  cleanupLiveVideoArtifacts(allocation);

  const mkfifoResult = spawnSync("mkfifo", [allocation.videoPipePath], {
    stdio: "pipe",
  });

  if (mkfifoResult.status !== 0) {
    const stderr = String(mkfifoResult.stderr || "").trim();
    throw new Error(`mkfifo_failed:${stderr || mkfifoResult.status}`);
  }

  const ffmpegArgs = [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-video_size",
    `${config.recordingWidth}x${config.recordingHeight}`,
    "-framerate",
    String(config.recordingFps),
    "-i",
    allocation.videoPipePath,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    allocation.videoOutputPath,
  ];

  const ffmpeg = spawn(config.ffmpegBinary, ffmpegArgs, {
    stdio: ["ignore", "ignore", config.debugChildLogs ? "pipe" : "ignore"],
  });

  ffmpeg.on("error", (error) => {
    fastify.log.warn(
      { err: error, matchId: allocation.matchId },
      "live_video_ffmpeg_spawn_failed",
    );
  });

  if (config.debugChildLogs) {
    ffmpeg.stderr?.on("data", (chunk) => {
      const log = String(chunk || "").trim();
      if (log) {
        fastify.log.warn({ matchId: allocation.matchId, log }, "ffmpeg_stderr");
      }
    });
  }

  ffmpeg.once("exit", async (code, signal) => {
    allocation.videoEncodingCompleted = true;
    allocation.videoProcess = null;

    fastify.log.info(
      {
        matchId: allocation.matchId,
        exitCode: code,
        signal,
      },
      "live_video_encoder_exit",
    );

    if (allocation?.videoPipePath) {
      try {
        rmSync(allocation.videoPipePath, { force: true });
      } catch {}
    }

    const published = await maybePublishRecordedVideo(allocation, "ffmpeg_exit");
    if (!published) {
      scheduleVideoPublishRetry(allocation, "ffmpeg_exit");
    }
  });

  allocation.videoProcess = ffmpeg;
  fastify.log.info(
    {
      matchId: allocation.matchId,
      pipePath: allocation.videoPipePath,
      outputPath: allocation.videoOutputPath,
    },
    "live_video_recording_prepared",
  );
}

async function finalizeLiveVideoRecording(allocation) {
  const ffmpeg = allocation?.videoProcess;
  allocation.videoProcess = null;

  if (!ffmpeg) {
    if (!allocation?.videoPublished) {
      await maybePublishRecordedVideo(allocation, "finalize_without_ffmpeg");
    }
    cleanupLiveVideoArtifacts(allocation);
    return;
  }

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const timeout = setTimeout(() => {
      try {
        ffmpeg.kill("SIGKILL");
      } catch {}
      finish();
    }, 5000);

    ffmpeg.once("exit", () => {
      clearTimeout(timeout);
      finish();
    });
  });

  if (allocation?.videoPipePath) {
    try {
      rmSync(allocation.videoPipePath, { force: true });
    } catch {}
  }

  await maybePublishRecordedVideo(allocation, "finalize_after_ffmpeg_wait");
  if (!allocation?.videoPublished) {
    scheduleVideoPublishRetry(allocation, "finalize_after_ffmpeg_wait");
  }
}

function attachChildHandlers(allocation, child) {
  let stdoutBuffer = "";

  child.on("error", (error) => {
    allocation.state = "failed";
    allocation.updatedAt = nowIso();
    allocation.lastExitCode = null;
    allocation.lastExitSignal = "spawn_error";
    fastify.log.error({ err: error, matchId: allocation.matchId }, "unity_spawn_failed");
  });

  child.on("exit", async (code, signal) => {
    clearAllocationTimers(allocation);
    allocation.process = null;
    allocation.pid = null;
    allocation.lastExitCode = code;
    allocation.lastExitSignal = signal;
    allocation.updatedAt = nowIso();

    const trailingStdout = stdoutBuffer.trim();
    if (trailingStdout) {
      stdoutBuffer = "";
      await handleUnityResultLine(allocation, trailingStdout);
    }

    if (allocation.state !== "released" && allocation.state !== "stopping") {
      allocation.state = code === 0 ? "ended" : "failed";
    } else {
      allocation.state = "released";
    }

    if (config.autoReleaseOnExit) {
      allocation.releaseReason = allocation.releaseReason || "process_exit";
      allocation.state = "released";
    }

    fastify.log.info(
      {
        matchId: allocation.matchId,
        exitCode: code,
        signal,
        state: allocation.state,
      },
      "unity_process_exit",
    );

    cleanupPayloadFiles(allocation);

    await finalizeLiveVideoRecording(allocation);

    await maybePublishRecordedVideo(allocation, "process_exit");
    if (!allocation.videoPublished) {
      scheduleVideoPublishRetry(allocation, "process_exit");
    }

    if (!allocation.resultForwarded && !allocation.terminalLifecycleState) {
      const fallbackState = code === 0 ? "ended" : "failed";
      allocation.terminalLifecycleState = allocation.terminalLifecycleState || fallbackState;
      void postLifecycleUpdate(allocation, {
        state: fallbackState,
        reason: signal || (code === 0 ? "process_exit" : "process_failed"),
      });
    }
  });
  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    if (config.debugChildLogs) {
      const trimmed = text.trim();
      if (trimmed) {
        fastify.log.info({ matchId: allocation.matchId, log: trimmed }, "unity_stdout");
      }
    }

    stdoutBuffer += text;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        continue;
      }
      void maybeHandleUnityLifecycleLine(allocation, trimmedLine);
      void maybeHandleUnityMinuteHeartbeatLine(allocation, trimmedLine);
      void handleUnityResultLine(allocation, trimmedLine);
    }
  });

  if (config.debugChildLogs) {
    child.stderr?.on("data", (chunk) => {
      fastify.log.warn({ matchId: allocation.matchId, log: String(chunk).trim() }, "unity_stderr");
    });
  }
}

function startAllocationProcess(allocation) {
  if (allocation.state === "running" || allocation.state === "starting") {
    return allocation;
  }

  clearAllocationTimers(allocation);
  allocation.readyForwarded = false;
  allocation.resultForwarded = false;
  allocation.finalResult = null;
  allocation.terminalLifecycleState = null;
  allocation.liveMinute = null;
  allocation.liveMinuteAt = null;
  allocation.minuteCloseDueAt = null;
  allocation.hardTimeoutAt = null;

  if (allocation.unityCallbackSuppressedInsecureHttp) {
    fastify.log.warn(
      {
        matchId: allocation.matchId,
        attemptedUrl: allocation.callbackUrl,
      },
      "unity_callback_http_suppressed_use_https_or_allow_insecure",
    );
  }

  validateUnityBinaryPath();
  try {
    if (isLiveVideoRecordingEnabled() && shouldUseVirtualDisplayForRecording() && !hasUsableXvfb()) {
      fastify.log.warn(
        { matchId: allocation.matchId, xvfbRunBinary: config.xvfbRunBinary },
        "live_video_recording_disabled_xvfb_unavailable",
      );
    }
    prepareLiveVideoRecording(allocation);
  } catch (error) {
    allocation.videoPipePath = "";
    allocation.videoOutputPath = "";
    allocation.videoProcess = null;
    fastify.log.warn(
      { err: error, matchId: allocation.matchId },
      "live_video_recording_prepare_failed",
    );
  }

  preparePayloadFiles(allocation);

  const args = buildProcessArgs(allocation);
  const useVirtualDisplay = canRenderLiveVideo() && shouldUseVirtualDisplayForRecording();
  const command = useVirtualDisplay ? config.xvfbRunBinary : config.unityBinaryPath;
  const commandArgs = useVirtualDisplay
    ? [
        "-a",
        "-s",
        `-screen 0 ${config.recordingWidth}x${config.recordingHeight}x24`,
        config.unityBinaryPath,
        ...args,
      ]
    : args;

  let child;
  try {
    child = spawn(command, commandArgs, {
      cwd: config.unityWorkingDir || path.dirname(config.unityBinaryPath),
      stdio: ["ignore", "pipe", config.debugChildLogs ? "pipe" : "ignore"],
      env: buildChildEnv(allocation),
    });
  } catch (error) {
    cleanupPayloadFiles(allocation);
    throw error;
  }

  allocation.process = child;
  allocation.pid = child.pid || null;
  allocation.state = "starting";
  allocation.updatedAt = nowIso();
  scheduleHardTimeout(allocation);

  attachChildHandlers(allocation, child);

  fastify.log.info(
    {
      matchId: allocation.matchId,
      pid: allocation.pid,
      port: allocation.serverPort,
      mode: allocation.mode,
      command,
      useVirtualDisplay,
    },
    "unity_process_started",
  );

  return allocation;
}

function createAllocation(body) {
  pruneStaleInMemoryAllocations("createAllocation");
  const matchId = String(body.matchId || "").trim();
  if (!matchId) {
    throw new Error("matchId_required");
  }

  const existing = allocations.get(matchId);
  if (existing) {
    return existing;
  }

  const port = pickFreePort();
  if (!port) {
    throw new Error("no_free_slot");
  }

  const allocation = {
    matchId,
    mode: normalizeMode(body.mode),
    unityMatchRole: normalizeUnityMatchRole(body.unityMatchRole || config.unityMatchRole),
    state: "allocated",
    maxClients: Number(body.maxClients || config.defaultMaxClients),
    sessionSecret: String(body.sessionSecret || ""),
    homeTeamId: body.homeTeamId ? String(body.homeTeamId) : "",
    awayTeamId: body.awayTeamId ? String(body.awayTeamId) : "",
    homeUserId: body.homeUserId ? String(body.homeUserId) : "",
    awayUserId: body.awayUserId ? String(body.awayUserId) : "",
    homeTeamPayload: normalizeObjectPayload(body.homeTeamPayload),
    awayTeamPayload: normalizeObjectPayload(body.awayTeamPayload),
    seasonId: body.seasonId ? String(body.seasonId) : "",
    leagueId: body.leagueId ? String(body.leagueId) : "",
    fixtureId: body.fixtureId ? String(body.fixtureId) : "",
    kickoffAt: body.kickoffAt ? String(body.kickoffAt) : "",
    resultUploadUrl: body.resultUploadUrl ? String(body.resultUploadUrl) : "",
    replayUploadUrl: body.replayUploadUrl ? String(body.replayUploadUrl) : "",
    videoUploadUrl: body.videoUploadUrl ? String(body.videoUploadUrl) : "",
    requestToken: body.requestToken ? String(body.requestToken) : "",
    callbackUrl: "",
    callbackToken: "",
    unityCallbackUrl: "",
    unityCallbackToken: "",
    unityCallbackSuppressedInsecureHttp: false,
    serverPort: port,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    process: null,
    pid: null,
    lastExitCode: null,
    lastExitSignal: null,
    releaseReason: null,
    readyForwarded: false,
    resultForwarded: false,
    finalResult: null,
    videoPublished: false,
    videoPayload: null,
    homeTeamPayloadPath: "",
    awayTeamPayloadPath: "",
    videoEncodingCompleted: false,
    videoPublishRetryTimer: null,
    hardTimeoutTimer: null,
    hardTimeoutAt: null,
    minuteCloseTimer: null,
    minuteCloseDueAt: null,
    liveMinute: null,
    liveMinuteAt: null,
    terminalLifecycleState: null,
  };

  allocation.callbackUrl = buildCallbackUrl(allocation, body);
  allocation.callbackToken = String(body.callbackToken || config.callbackToken || "");
  const unityCallback = resolveUnityCallbackConfig(allocation, body);
  allocation.unityCallbackUrl = unityCallback.url;
  allocation.unityCallbackToken = unityCallback.token;
  allocation.unityCallbackSuppressedInsecureHttp =
    unityCallback.suppressedInsecureHttp;

  allocations.set(matchId, allocation);
  return allocation;
}

fastify.get("/health", async () => ({
  ok: true,
  nodeId: config.nodeId,
  timestamp: nowIso(),
  capacity: computeCapacity(),
}));

fastify.get("/agent/v1/capacity", async (request, reply) => {
  if (!requireAgentAuth(request, reply)) return;
  return computeCapacity();
});

fastify.get("/agent/v1/allocations/:matchId", async (request, reply) => {
  if (!requireAgentAuth(request, reply)) return;
  const { matchId } = request.params;
  const allocation = allocations.get(String(matchId));
  if (!allocation) {
    return reply.code(404).send({ error: "allocation_not_found" });
  }
  return allocationSummary(allocation);
});

fastify.post("/agent/v1/allocations", async (request, reply) => {
  if (!requireAgentAuth(request, reply)) return;

  const body = request.body || {};
  let allocation;
  try {
    allocation = createAllocation(body);
  } catch (error) {
    if (error.message === "matchId_required") {
      return reply.code(400).send({ error: "matchId required" });
    }
    if (error.message === "no_free_slot") {
      await cleanupOrphanedUnityProcesses("allocation_no_free_slot_retry");
      try {
        allocation = createAllocation(body);
      } catch (retryError) {
        if (retryError.message === "no_free_slot") {
          return reply.code(409).send({ error: "no_free_slot" });
        }
        throw retryError;
      }
    } else {
      throw error;
    }
  }

  if (toBool(body.autoStart, false)) {
    try {
      startAllocationProcess(allocation);
    } catch (error) {
      allocation.state = "failed";
      allocation.updatedAt = nowIso();
      fastify.log.error({ err: error, matchId: allocation.matchId }, "auto_start_failed");
      return reply.code(500).send({ error: "auto_start_failed", detail: error.message });
    }
  }

  return reply.send(allocationSummary(allocation));
});

fastify.post("/agent/v1/allocations/:matchId/start", async (request, reply) => {
  if (!requireAgentAuth(request, reply)) return;

  const { matchId } = request.params;
  const allocation = allocations.get(String(matchId));
  if (!allocation) {
    return reply.code(404).send({ error: "allocation_not_found" });
  }

  if (allocation.state === "running") {
    return reply.send(allocationSummary(allocation));
  }

  try {
    startAllocationProcess(allocation);
  } catch (error) {
    allocation.state = "failed";
    allocation.updatedAt = nowIso();
    fastify.log.error({ err: error, matchId: allocation.matchId }, "start_failed");
    return reply.code(500).send({ error: "start_failed", detail: error.message });
  }

  return reply.send(allocationSummary(allocation));
});

fastify.delete("/agent/v1/allocations/:matchId", async (request, reply) => {
  if (!requireAgentAuth(request, reply)) return;

  const { matchId } = request.params;
  const allocation = allocations.get(String(matchId));
  if (!allocation) {
    return reply.send({ ok: true, released: true, alreadyMissing: true });
  }

  await stopProcess(allocation, "deleted_via_api");
  clearAllocationTimers(allocation);
  clearVideoPublishRetry(allocation);
  allocations.delete(String(matchId));
  return reply.send({ ok: true, released: true, matchId: String(matchId) });
});

fastify.get("/agent/v1/videos/:matchId", async (request, reply) => {
  const { matchId } = request.params;
  const targetPath = buildRecordedVideoPath(String(matchId));

  if (!existsSync(targetPath)) {
    return reply.code(404).send({ error: "video_not_found" });
  }

  reply.header("Content-Type", "video/mp4");
  reply.header("Cache-Control", "public, max-age=3600");
  return reply.send(createReadStream(targetPath));
});

fastify.post("/agent/v1/heartbeat", async (request, reply) => {
  if (!requireAgentAuth(request, reply)) return;

  return reply.send({
    ok: true,
    nodeId: config.nodeId,
    timestamp: nowIso(),
    capacity: computeCapacity(),
  });
});

fastify.setErrorHandler((error, _request, reply) => {
  fastify.log.error(error);
  if (reply.sent) return;
  const statusCode = Number(error?.statusCode || 500);
  reply
    .code(statusCode >= 400 && statusCode < 600 ? statusCode : 500)
    .send({ error: error?.message || "internal_error" });
});

async function gracefulShutdown(signal) {
  fastify.log.warn({ signal }, "node-agent shutdown initiated");

  for (const allocation of allocations.values()) {
    clearAllocationTimers(allocation);
    clearVideoPublishRetry(allocation);
  }

  const running = Array.from(allocations.values()).filter(
    (allocation) => allocation.process,
  );

  for (const allocation of running) {
    try {
      await stopProcess(allocation, `shutdown_${signal}`);
    } catch (error) {
      fastify.log.error({ err: error, matchId: allocation.matchId }, "shutdown_stop_failed");
    }
  }

  await fastify.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  gracefulShutdown("SIGINT").catch(() => process.exit(1));
});

process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM").catch(() => process.exit(1));
});

async function start() {
  if (!config.allocatablePorts.length) {
    throw new Error("ALLOCATABLE_PORTS must contain at least one valid port");
  }

  await cleanupOrphanedUnityProcesses("startup");

  await fastify.listen({ host: config.host, port: config.port });
  fastify.log.info(
    {
      host: config.host,
      port: config.port,
      nodeId: config.nodeId,
      slots: config.allocatablePorts,
      unityBinaryPath: config.unityBinaryPath,
    },
    "node-agent started",
  );
}

start().catch((error) => {
  fastify.log.error(error);
  process.exit(1);
});
