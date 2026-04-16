import { Capacitor } from '@capacitor/core';
import {
  getFriendlyMatchReadyStates,
  getFriendlyRequestStatus,
  listFriendlyRequests,
  requestJoinTicket,
  waitForMatchReady,
  type FriendlyRequestListItem,
  type FriendlyRequestStatusResponse,
} from '@/services/matchControl';
import { unityBridge } from '@/services/unityBridge';

const ACTIVE_LAUNCH_STORAGE_KEY = 'friendly_launch_active_v1';
const RECENT_LAUNCH_STORAGE_KEY = 'friendly_launch_recent_v1';
const CLAIMED_LAUNCH_STORAGE_KEY = 'friendly_launch_claimed_v1';
const RESTORE_WINDOW_MS = 120_000;
const CLAIMED_LAUNCH_TTL_MS = 12 * 60 * 60 * 1000;
const REQUEST_READY_TIMEOUT_MS = 60_000;
const JOIN_TICKET_TIMEOUT_MS = 15_000;
const UNITY_HANDOFF_TIMEOUT_MS = 20_000;
const REQUEST_POLL_MS = 1_000;

export type FriendlyLaunchPhase =
  | 'locating_request'
  | 'waiting_accept'
  | 'waiting_match'
  | 'waiting_server'
  | 'requesting_join_ticket'
  | 'opening_unity'
  | 'booting_gameplay_scene'
  | 'waiting_gameplay_graph'
  | 'awaiting_unity_handoff'
  | 'waiting_runtime_snapshot'
  | 'waiting_gameplay_actors'
  | 'waiting_other_client'
  | 'waiting_simulation_release'
  | 'done'
  | 'failed';

export type FriendlyLaunchFailureReason =
  | 'request_not_found'
  | 'request_expired'
  | 'match_not_ready'
  | 'join_ticket_failed'
  | 'open_match_failed'
  | 'launch_timeout'
  | 'concurrent_launch';

export type FriendlyLaunchContext = {
  attemptId: string;
  source: string;
  originSource: string;
  userId: string;
  homeId: string;
  awayId: string;
  phase: FriendlyLaunchPhase;
  startedAt: number;
  updatedAt: number;
  requestId?: string;
  matchId?: string;
  failureReason?: FriendlyLaunchFailureReason;
  errorMessage?: string;
};

type FriendlyLaunchTrigger = 'manual' | 'auto' | 'resume';

type FriendlyLaunchStartArgs = {
  source: string;
  userId: string;
  homeId: string;
  awayId: string;
  requestId?: string;
  matchId?: string;
  trigger?: FriendlyLaunchTrigger;
};

type FriendlyLaunchListener = (context: FriendlyLaunchContext | null) => void;

type RecentLaunchRegistry = Record<string, number>;
type ClaimedLaunchRegistry = Record<string, {
  attemptId: string;
  source: string;
  claimedAt: number;
}>;

type FriendlyRequestSnapshot = FriendlyRequestListItem | FriendlyRequestStatusResponse;

export class FriendlyLaunchError extends Error {
  readonly reason: FriendlyLaunchFailureReason;
  readonly context: FriendlyLaunchContext;

  constructor(reason: FriendlyLaunchFailureReason, message: string, context: FriendlyLaunchContext) {
    super(message);
    this.name = 'FriendlyLaunchError';
    this.reason = reason;
    this.context = context;
  }
}

const listeners = new Set<FriendlyLaunchListener>();
let activeContext: FriendlyLaunchContext | null = readActiveLaunchContext();
let activeLaunchKey: string | null = activeContext ? getLaunchKey(activeContext) : null;
let activeLaunchPromise: Promise<FriendlyLaunchContext | null> | null = null;

function now(): number {
  return Date.now();
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function createAttemptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `friendly-${now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneContext(context: FriendlyLaunchContext | null): FriendlyLaunchContext | null {
  return context ? { ...context } : null;
}

function getLaunchKey(input: Pick<FriendlyLaunchContext, 'requestId' | 'matchId'>): string | null {
  const requestId = String(input.requestId || '').trim();
  if (requestId) return `request:${requestId}`;
  const matchId = String(input.matchId || '').trim();
  if (matchId) return `match:${matchId}`;
  return null;
}

function getLaunchKeys(input: Pick<FriendlyLaunchContext, 'requestId' | 'matchId'>): string[] {
  const keys: string[] = [];
  const requestId = String(input.requestId || '').trim();
  const matchId = String(input.matchId || '').trim();
  if (requestId) {
    keys.push(`request:${requestId}`);
  }
  if (matchId) {
    keys.push(`match:${matchId}`);
  }
  return keys;
}

function isTerminalPhase(phase: FriendlyLaunchPhase): boolean {
  return phase === 'done' || phase === 'failed';
}

function isRestorableContext(context: FriendlyLaunchContext | null): context is FriendlyLaunchContext {
  if (!context) return false;
  if (isTerminalPhase(context.phase)) return false;
  return now() - Number(context.startedAt || 0) <= RESTORE_WINDOW_MS;
}

function readActiveLaunchContext(): FriendlyLaunchContext | null {
  const storage = getStorage();
  const parsed = safeParseJson<FriendlyLaunchContext>(storage?.getItem(ACTIVE_LAUNCH_STORAGE_KEY) || null);
  if (!parsed) return null;
  if (!isRestorableContext(parsed)) {
    storage?.removeItem(ACTIVE_LAUNCH_STORAGE_KEY);
    return null;
  }
  return parsed;
}

function writeActiveLaunchContext(context: FriendlyLaunchContext | null): void {
  const storage = getStorage();
  if (!storage) return;
  if (!context || isTerminalPhase(context.phase)) {
    storage.removeItem(ACTIVE_LAUNCH_STORAGE_KEY);
    return;
  }
  storage.setItem(ACTIVE_LAUNCH_STORAGE_KEY, JSON.stringify(context));
}

function readRecentLaunchRegistry(): RecentLaunchRegistry {
  const storage = getStorage();
  const parsed = safeParseJson<RecentLaunchRegistry>(storage?.getItem(RECENT_LAUNCH_STORAGE_KEY) || null);
  if (!parsed || typeof parsed !== 'object') return {};
  return parsed;
}

function writeRecentLaunchRegistry(registry: RecentLaunchRegistry): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(RECENT_LAUNCH_STORAGE_KEY, JSON.stringify(registry));
}

function readClaimedLaunchRegistry(): ClaimedLaunchRegistry {
  const storage = getStorage();
  const parsed = safeParseJson<ClaimedLaunchRegistry>(storage?.getItem(CLAIMED_LAUNCH_STORAGE_KEY) || null);
  if (!parsed || typeof parsed !== 'object') return {};
  return parsed;
}

function writeClaimedLaunchRegistry(registry: ClaimedLaunchRegistry): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(CLAIMED_LAUNCH_STORAGE_KEY, JSON.stringify(registry));
}

function pruneRecentLaunchRegistry(): RecentLaunchRegistry {
  const registry = readRecentLaunchRegistry();
  const cutoff = now() - RESTORE_WINDOW_MS;
  const nextEntries = Object.entries(registry).filter(([, completedAt]) => Number(completedAt) >= cutoff);
  const next = Object.fromEntries(nextEntries);
  if (nextEntries.length !== Object.keys(registry).length) {
    writeRecentLaunchRegistry(next);
  }
  return next;
}

function pruneClaimedLaunchRegistry(): ClaimedLaunchRegistry {
  const registry = readClaimedLaunchRegistry();
  const cutoff = now() - CLAIMED_LAUNCH_TTL_MS;
  const nextEntries = Object.entries(registry).filter(([, value]) => Number(value?.claimedAt || 0) >= cutoff);
  const next = Object.fromEntries(nextEntries);
  if (nextEntries.length !== Object.keys(registry).length) {
    writeClaimedLaunchRegistry(next);
  }
  return next;
}

function wasRecentlyCompleted(key: string | null): boolean {
  if (!key) return false;
  const registry = pruneRecentLaunchRegistry();
  const completedAt = Number(registry[key] || 0);
  return completedAt > 0 && now() - completedAt <= RESTORE_WINDOW_MS;
}

function markCompleted(key: string | null): void {
  if (!key) return;
  const registry = pruneRecentLaunchRegistry();
  registry[key] = now();
  writeRecentLaunchRegistry(registry);
}

function markLaunchClaim(context: Pick<FriendlyLaunchContext, 'attemptId' | 'source' | 'requestId' | 'matchId'>): void {
  const keys = getLaunchKeys(context);
  if (keys.length === 0) return;
  const registry = pruneClaimedLaunchRegistry();
  const claimedAt = now();
  keys.forEach((key) => {
    registry[key] = {
      attemptId: context.attemptId,
      source: context.source,
      claimedAt,
    };
  });
  writeClaimedLaunchRegistry(registry);
}

export function clearFriendlyLaunchClaim(input: Pick<FriendlyLaunchContext, 'requestId' | 'matchId'>): void {
  const keys = getLaunchKeys(input);
  if (keys.length === 0) return;
  const registry = pruneClaimedLaunchRegistry();
  let changed = false;
  keys.forEach((key) => {
    if (registry[key]) {
      delete registry[key];
      changed = true;
    }
  });
  if (changed) {
    writeClaimedLaunchRegistry(registry);
  }
}

export function isFriendlyLaunchClaimed(input: Pick<FriendlyLaunchContext, 'requestId' | 'matchId'>): boolean {
  const keys = getLaunchKeys(input);
  if (keys.length === 0) return false;
  const registry = pruneClaimedLaunchRegistry();
  return keys.some((key) => !!registry[key]);
}

function emit(context: FriendlyLaunchContext | null): void {
  const snapshot = cloneContext(context);
  listeners.forEach((listener) => listener(snapshot));
}

function logFriendlyLaunch(
  event: string,
  context: Pick<FriendlyLaunchContext, 'attemptId' | 'source' | 'requestId' | 'matchId'>,
  extra?: Record<string, unknown>,
): void {
  console.info(`[friendly_launch] ${event}`, {
    attemptId: context.attemptId,
    source: context.source,
    requestId: context.requestId || null,
    matchId: context.matchId || null,
    ...(extra || {}),
  });
}

function updateActiveContext(patch: Partial<FriendlyLaunchContext>): FriendlyLaunchContext {
  if (!activeContext) {
    throw new Error('Friendly launch context is missing.');
  }
  activeContext = {
    ...activeContext,
    ...patch,
    updatedAt: now(),
  };
  activeLaunchKey = getLaunchKey(activeContext);
  markLaunchClaim(activeContext);
  writeActiveLaunchContext(activeContext);
  emit(activeContext);
  return activeContext;
}

function resetActiveContext(): void {
  activeContext = null;
  activeLaunchKey = null;
  activeLaunchPromise = null;
  writeActiveLaunchContext(null);
  emit(null);
}

function createFriendlyLaunchError(
  reason: FriendlyLaunchFailureReason,
  message: string,
): FriendlyLaunchError {
  const claimTarget = activeContext
    ? {
        requestId: activeContext.requestId,
        matchId: activeContext.matchId,
      }
    : null;
  const context = updateActiveContext({
    phase: 'failed',
    failureReason: reason,
    errorMessage: message,
  });
  logFriendlyLaunch('friendly_launch_failed', context, {
    reason,
    message,
  });
  if (claimTarget) {
    clearFriendlyLaunchClaim(claimTarget);
  }
  writeActiveLaunchContext(null);
  activeLaunchPromise = null;
  emit(context);
  return new FriendlyLaunchError(reason, message, context);
}

function getRequestStatus(snapshot: FriendlyRequestSnapshot | null): string {
  return String(snapshot?.status || '').trim().toLowerCase();
}

function getRequestMatchId(snapshot: FriendlyRequestSnapshot | null): string {
  return String(snapshot?.match?.matchId || snapshot?.matchId || '').trim();
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(onTimeout());
    }, timeoutMs);

    promise.then((value) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      reject(error);
    });
  });
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function shouldWaitForNativeUnityHandoff(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

async function waitForUnityLaunchHandoff(
  matchId: string,
  timeoutMs: number,
): Promise<string> {
  if (!shouldWaitForNativeUnityHandoff()) {
    return 'not_native_android';
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let removeListener: (() => Promise<void>) | null = null;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

    const finalize = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutId) {
        globalThis.clearTimeout(timeoutId);
      }

      const finish = () => callback();
      if (removeListener) {
        void removeListener()
          .catch(() => undefined)
          .finally(finish);
      } else {
        finish();
      }
    };

    timeoutId = globalThis.setTimeout(() => {
      finalize(() => reject(new Error('unity_handoff_timeout')));
    }, timeoutMs);

    void unityBridge.onUnityEvent((event) => {
      if (settled) return;

      const eventType = String(event?.type || '').trim().toLowerCase();
      const eventMatchId = String(event?.matchId || '').trim();
      if (eventMatchId && matchId && eventMatchId !== matchId) {
        return;
      }

      if (eventType === 'ready' || eventType === 'connected') {
        finalize(() => resolve(eventType));
        return;
      }

      if (eventType === 'error' || eventType === 'connection_failed') {
        const message = String(event?.message || '').trim() || 'Unity handoff failed.';
        finalize(() => reject(new Error(message)));
      }
    }).then((remove) => {
      removeListener = remove;
    }).catch((error) => {
      finalize(() => reject(error instanceof Error ? error : new Error('unity_handoff_listener_failed')));
    });
  });
}

function shouldSkipAutoLaunch(args: FriendlyLaunchStartArgs): boolean {
  const trigger = args.trigger || 'manual';
  if (trigger === 'manual') return false;
  if (isFriendlyLaunchClaimed(args)) {
    return true;
  }
  return wasRecentlyCompleted(getLaunchKey(args));
}

function describeFriendlyRequest(snapshot: FriendlyRequestSnapshot | null): Record<string, unknown> {
  return {
    status: getRequestStatus(snapshot),
    requestId: String(snapshot?.requestId || '').trim() || null,
    matchId: getRequestMatchId(snapshot) || null,
  };
}

async function findFriendlyRequest(args: FriendlyLaunchStartArgs): Promise<FriendlyRequestSnapshot | null> {
  if (args.requestId) {
    return getFriendlyRequestStatus(args.requestId);
  }

  if (!args.userId) return null;

  const items = await listFriendlyRequests(args.userId);
  if (args.matchId) {
    return items.find((item) => String(item.match?.matchId || item.matchId || '').trim() === args.matchId) || null;
  }

  return items.find((item) => {
    const state = getRequestStatus(item);
    return state === 'accepted' || state === 'pending';
  }) || null;
}

function syncContextFromRequest(snapshot: FriendlyRequestSnapshot | null): void {
  if (!snapshot || !activeContext) return;
  const requestId = String(snapshot.requestId || '').trim();
  const matchId = getRequestMatchId(snapshot);
  updateActiveContext({
    requestId: requestId || activeContext.requestId,
    matchId: matchId || activeContext.matchId,
  });
}

async function waitForAcceptedRequest(
  requestId: string,
  timeoutMs: number,
): Promise<FriendlyRequestSnapshot> {
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    const snapshot = await getFriendlyRequestStatus(requestId);
    syncContextFromRequest(snapshot);
    const status = getRequestStatus(snapshot);

    if (status === 'accepted') {
      return snapshot;
    }

    if (status === 'expired') {
      throw createFriendlyLaunchError('request_expired', 'Dostluk isteginin suresi doldu.');
    }

    await pause(REQUEST_POLL_MS);
  }

  throw createFriendlyLaunchError('launch_timeout', 'Dostluk istegi zamaninda kabul edilmedi.');
}

async function waitForMatchAssignment(
  requestId: string,
  timeoutMs: number,
): Promise<FriendlyRequestSnapshot> {
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    const snapshot = await getFriendlyRequestStatus(requestId);
    syncContextFromRequest(snapshot);
    const status = getRequestStatus(snapshot);
    const matchId = getRequestMatchId(snapshot);

    if (status === 'expired') {
      throw createFriendlyLaunchError('request_expired', 'Dostluk isteginin suresi doldu.');
    }

    if (matchId) {
      return snapshot;
    }

    await pause(REQUEST_POLL_MS);
  }

  throw createFriendlyLaunchError('match_not_ready', 'Dostluk maci zamaninda hazir olmadi.');
}

async function runFriendlyLaunch(args: FriendlyLaunchStartArgs): Promise<FriendlyLaunchContext | null> {
  const requestId = String(args.requestId || '').trim();
  const matchId = String(args.matchId || '').trim();
  const source = args.source.trim();
  const trigger = args.trigger || 'manual';

  activeContext = {
    attemptId: createAttemptId(),
    source,
    originSource: source,
    userId: args.userId,
    homeId: args.homeId,
    awayId: args.awayId,
    requestId: requestId || undefined,
    matchId: matchId || undefined,
    phase: requestId ? 'locating_request' : matchId ? 'requesting_join_ticket' : 'locating_request',
    startedAt: now(),
    updatedAt: now(),
  };
  activeLaunchKey = getLaunchKey(activeContext);
  markLaunchClaim(activeContext);
  writeActiveLaunchContext(activeContext);
  emit(activeContext);

  try {
    let requestSnapshot: FriendlyRequestSnapshot | null = null;

    if (requestId || !matchId) {
      updateActiveContext({ phase: 'locating_request' });
      requestSnapshot = await findFriendlyRequest(args);
      if (!requestSnapshot) {
        throw createFriendlyLaunchError('request_not_found', 'Kabul edilmis dostluk istegi bulunamadi.');
      }
      syncContextFromRequest(requestSnapshot);
      logFriendlyLaunch('friendly_launch_detected_request', activeContext, describeFriendlyRequest(requestSnapshot));
    }

    if (requestSnapshot && getRequestStatus(requestSnapshot) === 'pending') {
      updateActiveContext({ phase: 'waiting_accept' });
      requestSnapshot = await waitForAcceptedRequest(String(activeContext?.requestId || ''), REQUEST_READY_TIMEOUT_MS);
    }

    if (requestSnapshot && !getRequestMatchId(requestSnapshot)) {
      updateActiveContext({ phase: 'waiting_server' });
      requestSnapshot = await waitForMatchAssignment(String(activeContext?.requestId || ''), REQUEST_READY_TIMEOUT_MS);
    }

    const resolvedMatchId = String(getRequestMatchId(requestSnapshot) || activeContext?.matchId || '').trim();
    if (!resolvedMatchId) {
      throw createFriendlyLaunchError('match_not_ready', 'Dostluk maci icin match id alinmadi.');
    }

    updateActiveContext({ matchId: resolvedMatchId, phase: 'requesting_join_ticket' });
    logFriendlyLaunch('friendly_launch_join_ticket_started', activeContext);

    const ticket = await withTimeout(
      requestJoinTicket({
        matchId: resolvedMatchId,
        userId: args.userId,
        role: 'player',
      }),
      JOIN_TICKET_TIMEOUT_MS,
      () => createFriendlyLaunchError('launch_timeout', 'Join ticket alma islemi zaman asimina ugradi.'),
    ).catch((error: unknown) => {
      if (error instanceof FriendlyLaunchError) throw error;
      throw createFriendlyLaunchError('join_ticket_failed', error instanceof Error ? error.message : 'Join ticket alinamadi.');
    });

    updateActiveContext({ matchId: ticket.matchId });
    logFriendlyLaunch('friendly_launch_join_ticket_succeeded', activeContext);

    const readyMatch = await waitForMatchReady(ticket.matchId, {
      timeoutMs: 90_000,
      pollMs: 700,
      readyStates: getFriendlyMatchReadyStates(),
    }).catch((error: unknown) => {
      throw createFriendlyLaunchError('match_not_ready', error instanceof Error ? error.message : 'Mac sunucusu hazir olmadi.');
    });

    updateActiveContext({ matchId: readyMatch.matchId, phase: 'booting_gameplay_scene' });
    logFriendlyLaunch('friendly_launch_open_match_started', activeContext, {
      serverIp: readyMatch.serverIp,
      serverPort: readyMatch.serverPort,
    });

    updateActiveContext({ phase: 'opening_unity' });
    const handoffPromise = waitForUnityLaunchHandoff(readyMatch.matchId, UNITY_HANDOFF_TIMEOUT_MS);
    const launchPromise = unityBridge.launchMatchActivity(readyMatch.serverIp, readyMatch.serverPort, {
      matchId: readyMatch.matchId,
      joinTicket: ticket.joinTicket,
      homeId: args.homeId,
      awayId: args.awayId,
      mode: 'friendly',
      role: 'player',
    });

    updateActiveContext({ phase: 'awaiting_unity_handoff' });

    const launchResult = await withTimeout(
      launchPromise,
      UNITY_HANDOFF_TIMEOUT_MS,
      () => createFriendlyLaunchError('launch_timeout', 'Unity host acilisi zaman asimina ugradi.'),
    ).catch((error: unknown) => {
      if (error instanceof FriendlyLaunchError) throw error;
      throw createFriendlyLaunchError('open_match_failed', error instanceof Error ? error.message : 'Unity acilamadi.');
    });

    logFriendlyLaunch('friendly_launch_native_launch_resolved', activeContext, {
      nativeLaunch: launchResult.nativeLaunch,
      alreadyActive: Boolean(launchResult.alreadyActive),
      bridgeMode: launchResult.bridgeMode || null,
      activityClass: launchResult.activityClass || null,
    });

    let handoffEventType = 'already_active';
    if (launchResult.alreadyActive) {
      void handoffPromise.catch(() => undefined);
    } else {
      handoffEventType = await withTimeout(
        handoffPromise,
        UNITY_HANDOFF_TIMEOUT_MS,
        () => createFriendlyLaunchError('launch_timeout', 'Unity handoff zaman asimina ugradi.'),
      ).catch((error: unknown) => {
        if (error instanceof FriendlyLaunchError) throw error;
        throw createFriendlyLaunchError('open_match_failed', error instanceof Error ? error.message : 'Unity handoff tamamlanamadi.');
      });
    }

    updateActiveContext({ phase: 'waiting_runtime_snapshot' });
    logFriendlyLaunch('friendly_launch_handoff_resolved', activeContext, {
      eventType: handoffEventType,
      nativeLaunch: launchResult.nativeLaunch,
      alreadyActive: Boolean(launchResult.alreadyActive),
    });

    const completed = updateActiveContext({ phase: 'done' });
    logFriendlyLaunch('friendly_launch_open_match_succeeded', completed);
    if (trigger !== 'manual') {
      markCompleted(activeLaunchKey);
    } else {
      markCompleted(activeLaunchKey);
    }
    resetActiveContext();
    return completed;
  } catch (error: unknown) {
    if (error instanceof FriendlyLaunchError) {
      throw error;
    }

    throw createFriendlyLaunchError(
      'open_match_failed',
      error instanceof Error ? error.message : 'Dostluk maci baglantisi baslatilamadi.',
    );
  } finally {
    activeLaunchPromise = null;
  }
}

export function subscribeFriendlyLaunch(listener: FriendlyLaunchListener): () => void {
  listeners.add(listener);
  listener(cloneContext(activeContext));
  return () => {
    listeners.delete(listener);
  };
}

export function getFriendlyLaunchSnapshot(): FriendlyLaunchContext | null {
  return cloneContext(activeContext);
}

export function clearFriendlyLaunchState(): void {
  resetActiveContext();
}

export function describeFriendlyLaunchPhase(phase: FriendlyLaunchPhase): { title: string; detail: string } {
  switch (phase) {
    case 'locating_request':
      return {
        title: 'Dostluk maci aranıyor',
        detail: 'Kabul edilen istek ve mac bilgisi bulunuyor.',
      };
    case 'waiting_accept':
      return {
        title: 'Rakip onayı bekleniyor',
        detail: 'Istek kabul edilene kadar kontrol ediliyor.',
      };
    case 'waiting_server':
      return {
        title: 'Sunucu hazirlaniyor',
        detail: 'Dedicated dostluk maci ayaga kalkana kadar bekleniyor.',
      };
    case 'waiting_match':
      return {
        title: 'Mac hazırlanıyor',
        detail: 'Dedicated mac kaydi olusana kadar bekleniyor.',
      };
    case 'requesting_join_ticket':
      return {
        title: 'Mac baglantisi hazirlaniyor',
        detail: 'Join ticket aliniyor ve mac sunucusunun durumu dogrulaniyor.',
      };
    case 'booting_gameplay_scene':
      return {
        title: 'Stadyum aciliyor',
        detail: 'Unity tarafi gameplay sahnesini baslatmak icin hazirlaniyor.',
      };
    case 'waiting_gameplay_graph':
      return {
        title: 'Mac grafiği hazırlanıyor',
        detail: 'Stadyum sahnesi icinde oyuncular, top ve temel mac grafiği bekleniyor.',
      };
    case 'opening_unity':
      return {
        title: 'Unity aciliyor',
        detail: 'Unity eslesmesi icin gerekli yerel gecis baslatiliyor.',
      };
    case 'waiting_runtime_snapshot':
      return {
        title: 'Mac verisi bekleniyor',
        detail: 'Unity handoff ve ilk runtime snapshot senkronu bekleniyor.',
      };
    case 'waiting_gameplay_actors':
      return {
        title: 'Oyuncular senkronize ediliyor',
        detail: 'Oyuncu ve top varliklari gameplay sahnesine baglaniyor.',
      };
    case 'waiting_other_client':
      return {
        title: 'Diger cihaz bekleniyor',
        detail: 'Sen hazirsin, rakip cihazin da maca girmesi bekleniyor.',
      };
    case 'waiting_simulation_release':
      return {
        title: 'Simulasyon baslatiliyor',
        detail: 'Iki cihaz hazir olduktan sonra simulasyon serbest birakiliyor.',
      };
    case 'awaiting_unity_handoff':
      return {
        title: 'Unity alanina geciliyor',
        detail: 'Uygulama Unity ekranina gecene kadar bekleniyor.',
      };
    case 'done':
      return {
        title: 'Unity baslatildi',
        detail: 'Mac baglantisi Unity tarafina aktarildi.',
      };
    case 'failed':
    default:
      return {
        title: 'Baglanti basarisiz',
        detail: 'Dostluk maci baglantisi tamamlanamadi.',
      };
  }
}

export function getFriendlyLaunchFailureMessage(
  reason: FriendlyLaunchFailureReason | undefined,
  fallback = 'Dostluk maci baglantisi baslatilamadi.',
): string {
  switch (reason) {
    case 'request_not_found':
      return 'Kabul edilen dostluk istegi bulunamadi.';
    case 'request_expired':
      return 'Dostluk isteginin suresi doldu.';
    case 'match_not_ready':
      return 'Mac sunucusu zamaninda hazir olmadi.';
    case 'join_ticket_failed':
      return 'Join ticket alinamadi.';
    case 'open_match_failed':
      return 'Unity acilis istegi tamamlanamadi.';
    case 'launch_timeout':
      return 'Dostluk maci baglantisi zaman asimina ugradi.';
    case 'concurrent_launch':
      return 'Baska bir mac baglantisi zaten hazırlanıyor.';
    default:
      return fallback;
  }
}

export async function startFriendlyLaunch(args: FriendlyLaunchStartArgs): Promise<FriendlyLaunchContext | null> {
  const dedupeKey = getLaunchKey(args);
  const trigger = args.trigger || 'manual';

  if (shouldSkipAutoLaunch(args)) {
    return null;
  }

  if (activeLaunchPromise && activeContext && !isTerminalPhase(activeContext.phase)) {
    if (activeLaunchKey && dedupeKey && activeLaunchKey === dedupeKey) {
      return activeLaunchPromise;
    }

    if (trigger !== 'manual') {
      return null;
    }

    throw new FriendlyLaunchError(
      'concurrent_launch',
      'Baska bir mac baglantisi zaten hazırlanıyor.',
      cloneContext(activeContext) || {
        attemptId: createAttemptId(),
        source: args.source,
        originSource: args.source,
        userId: args.userId,
        homeId: args.homeId,
        awayId: args.awayId,
        phase: 'failed',
        startedAt: now(),
        updatedAt: now(),
        failureReason: 'concurrent_launch',
        errorMessage: 'Baska bir mac baglantisi zaten hazırlanıyor.',
      },
    );
  }

  activeLaunchPromise = runFriendlyLaunch(args);
  return activeLaunchPromise;
}

export async function resumeFriendlyLaunch(args: {
  source: string;
  userId: string;
  homeId: string;
  awayId: string;
}): Promise<FriendlyLaunchContext | null> {
  const persisted = readActiveLaunchContext();
  if (!persisted || persisted.userId !== args.userId) {
    return null;
  }

  logFriendlyLaunch('friendly_launch_resumed', {
    attemptId: persisted.attemptId,
    source: args.source,
    requestId: persisted.requestId,
    matchId: persisted.matchId,
  });

  return startFriendlyLaunch({
    source: args.source,
    userId: args.userId,
    homeId: persisted.homeId || args.homeId,
    awayId: persisted.awayId || args.awayId,
    requestId: persisted.requestId,
    matchId: persisted.matchId,
    trigger: 'resume',
  });
}
