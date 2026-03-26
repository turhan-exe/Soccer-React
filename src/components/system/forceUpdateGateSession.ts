import {
  normalizeAndroidMobileUpdatePolicy,
  type AndroidMobileUpdatePolicy,
} from '@/services/mobileUpdatePolicy';
import type { PlayUpdateState } from '@/services/playUpdate';

export type GatePhase = 'checking' | 'ready' | 'blocked';

export type GateState = {
  phase: GatePhase;
  policy: AndroidMobileUpdatePolicy | null;
  installedVersionCode: number | null;
  installedVersionName: string;
  playUpdateState: PlayUpdateState;
};

type PersistedGateStateEnvelope = {
  savedAt: number;
  state: {
    phase: Exclude<GatePhase, 'checking'>;
    policy: AndroidMobileUpdatePolicy | null;
    installedVersionCode: number | null;
    installedVersionName: string;
  };
};

type PersistedAutoStartKeyEnvelope = {
  savedAt: number;
  key: string;
};

export const GATE_STATE_TTL_MS = 15 * 60 * 1000;
export const AUTO_START_KEY_TTL_MS = 6 * 60 * 60 * 1000;
export const MIN_BACKGROUND_DURATION_MS = 15 * 1000;
export const MIN_RESUME_CHECK_INTERVAL_MS = 60 * 1000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const parseInteger = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return null;
};

const parseNullableInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return parseInteger(value);
};

const parsePhase = (value: unknown): Exclude<GatePhase, 'checking'> | null => {
  if (value === 'ready' || value === 'blocked') {
    return value;
  }

  return null;
};

const isFresh = (savedAt: number, ttlMs: number, now: number) => now - savedAt <= ttlMs;

export const createPersistedGateState = (
  state: GateState,
  now = Date.now(),
): string | null => {
  if (state.phase === 'checking') {
    return null;
  }

  const envelope: PersistedGateStateEnvelope = {
    savedAt: now,
    state: {
      phase: state.phase,
      policy: state.policy,
      installedVersionCode: state.installedVersionCode,
      installedVersionName: state.installedVersionName,
    },
  };

  return JSON.stringify(envelope);
};

export const restorePersistedGateState = (
  raw: string | null,
  fallbackPlayState: PlayUpdateState,
  now = Date.now(),
): GateState | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedGateStateEnvelope;
    if (!isObject(parsed)) {
      return null;
    }

    const savedAt = parseInteger(parsed.savedAt);
    if (savedAt === null || !isFresh(savedAt, GATE_STATE_TTL_MS, now)) {
      return null;
    }

    const rawState = parsed.state;
    if (!isObject(rawState)) {
      return null;
    }

    const phase = parsePhase(rawState.phase);
    if (!phase) {
      return null;
    }

    const policy = normalizeAndroidMobileUpdatePolicy(rawState.policy ?? null);
    if (phase === 'blocked' && !policy) {
      return null;
    }

    const installedVersionCode = parseNullableInteger(rawState.installedVersionCode);
    if (rawState.installedVersionCode !== null && rawState.installedVersionCode !== undefined && installedVersionCode === null) {
      return null;
    }

    return {
      phase,
      policy,
      installedVersionCode,
      installedVersionName:
        typeof rawState.installedVersionName === 'string' ? rawState.installedVersionName : '',
      playUpdateState: fallbackPlayState,
    };
  } catch {
    return null;
  }
};

export const createPersistedAutoStartKey = (key: string, now = Date.now()): string =>
  JSON.stringify({
    savedAt: now,
    key,
  } satisfies PersistedAutoStartKeyEnvelope);

export const restorePersistedAutoStartKey = (
  raw: string | null,
  now = Date.now(),
): string | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedAutoStartKeyEnvelope;
    if (!isObject(parsed)) {
      return null;
    }

    const savedAt = parseInteger(parsed.savedAt);
    if (savedAt === null || !isFresh(savedAt, AUTO_START_KEY_TTL_MS, now)) {
      return null;
    }

    const key = typeof parsed.key === 'string' ? parsed.key.trim() : '';
    return key || null;
  } catch {
    return null;
  }
};

export const shouldRunResumeUpdateCheck = ({
  now,
  lastCompletedCheckAt,
  lastBackgroundedAt,
  minBackgroundDurationMs = MIN_BACKGROUND_DURATION_MS,
  minResumeIntervalMs = MIN_RESUME_CHECK_INTERVAL_MS,
}: {
  now: number;
  lastCompletedCheckAt: number;
  lastBackgroundedAt: number | null;
  minBackgroundDurationMs?: number;
  minResumeIntervalMs?: number;
}): boolean => {
  if (lastBackgroundedAt === null) {
    return false;
  }

  if (now - lastBackgroundedAt < minBackgroundDurationMs) {
    return false;
  }

  if (lastCompletedCheckAt > 0 && now - lastCompletedCheckAt < minResumeIntervalMs) {
    return false;
  }

  return true;
};
