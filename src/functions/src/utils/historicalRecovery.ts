export const NIGHTLY_RECOVERY_BATCH_SIZE = 30;
export const NIGHTLY_RECOVERY_MAX_ATTEMPTS = 2;
export const NIGHTLY_RECOVERY_RETRY_DELAY_MINUTES = 30;
export const NIGHTLY_RECOVERY_SCAN_LIMIT = NIGHTLY_RECOVERY_BATCH_SIZE * 6;
export const NIGHTLY_RECOVERY_WAVE_LOCK_MINUTES = 180;
export const NIGHTLY_RECOVERY_RUNNER_LOCK_MINUTES = 12;
export const NIGHTLY_RECOVERY_WAVE_STALE_MINUTES = 30;

type TimestampLike =
  | Date
  | { toDate?: () => Date; seconds?: number; nanoseconds?: number }
  | null
  | undefined;

export type HistoricalRecoveryLike = {
  state?: unknown;
  attemptCount?: unknown;
  lockExpiresAt?: TimestampLike;
  nextRetryAt?: TimestampLike;
  reservedKickoffAt?: TimestampLike;
} | null | undefined;

export type HistoricalRecoveryFixtureLike = {
  status?: unknown;
  date?: TimestampLike;
  videoMissing?: unknown;
  live?: {
    matchId?: unknown;
    state?: unknown;
    reason?: unknown;
    lastLifecycleAt?: TimestampLike;
    startedAt?: TimestampLike;
    kickoffAttemptedAt?: TimestampLike;
    prewarmedAt?: TimestampLike;
    endedAt?: TimestampLike;
    resultMissing?: unknown;
  } | null | undefined;
  recovery?: HistoricalRecoveryLike;
};

export type HistoricalRecoveryCandidateKind =
  | 'scheduled'
  | 'failed'
  | 'running_stale'
  | 'result_missing';

export function toTimestampMillis(value: TimestampLike): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const resolved = value.toDate();
    return resolved instanceof Date && !Number.isNaN(resolved.getTime())
      ? resolved.getTime()
      : null;
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1_000_000);
  }
  return null;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

export function normalizeHistoricalRecoveryState(value: unknown): string {
  return normalizeText(value);
}

export function getHistoricalRecoveryAttemptCount(
  value: HistoricalRecoveryFixtureLike | HistoricalRecoveryLike,
): number {
  const rawAttemptCount =
    value && typeof value === 'object' && 'recovery' in value
      ? (value as HistoricalRecoveryFixtureLike).recovery?.attemptCount
      : (value as HistoricalRecoveryLike)?.attemptCount;
  const attemptCount = Number(rawAttemptCount ?? 0);
  return Number.isFinite(attemptCount) && attemptCount > 0 ? Math.trunc(attemptCount) : 0;
}

export function isHistoricalRecoverySettled(value: HistoricalRecoveryFixtureLike | HistoricalRecoveryLike) {
  const state =
    value && typeof value === 'object' && 'recovery' in value
      ? normalizeHistoricalRecoveryState((value as HistoricalRecoveryFixtureLike).recovery?.state)
      : normalizeHistoricalRecoveryState((value as HistoricalRecoveryLike)?.state);
  return state === 'settled' || state === 'fallback_applied';
}

export function hasHistoricalRecoveryLock(
  fixture: HistoricalRecoveryFixtureLike,
  now = new Date(),
) {
  const lockExpiresAtMs = toTimestampMillis(fixture.recovery?.lockExpiresAt);
  if (lockExpiresAtMs == null) return false;
  return lockExpiresAtMs > now.getTime();
}

export function isHistoricalRecoveryRetryDue(
  fixture: HistoricalRecoveryFixtureLike,
  now = new Date(),
) {
  const nextRetryAtMs = toTimestampMillis(fixture.recovery?.nextRetryAt);
  if (nextRetryAtMs == null) return true;
  return nextRetryAtMs <= now.getTime();
}

export function resolveHistoricalRecoveryKickoffAt(
  fixture: HistoricalRecoveryFixtureLike,
): Date | null {
  const recoveryKickoffMs = toTimestampMillis(fixture.recovery?.reservedKickoffAt);
  if (recoveryKickoffMs != null) {
    return new Date(recoveryKickoffMs);
  }
  const fixtureKickoffMs = toTimestampMillis(fixture.date);
  return fixtureKickoffMs != null ? new Date(fixtureKickoffMs) : null;
}

export function resolveHistoricalRecoveryCandidateKind(
  fixture: HistoricalRecoveryFixtureLike,
  now = new Date(),
  runningTimeoutMinutes = 120,
): HistoricalRecoveryCandidateKind | null {
  const nowMs = now.getTime();
  const fixtureDateMs = toTimestampMillis(fixture.date);
  if (fixtureDateMs == null || fixtureDateMs >= nowMs) {
    return null;
  }

  if (isHistoricalRecoverySettled(fixture)) {
    return null;
  }

  if (hasHistoricalRecoveryLock(fixture, now) && !isHistoricalRecoveryRetryDue(fixture, now)) {
    return null;
  }

  const status = normalizeText(fixture.status);
  const liveState = normalizeText(fixture.live?.state);
  const hasMatchId = String(fixture.live?.matchId || '').trim().length > 0;
  const resultMissing = readBoolean(fixture.live?.resultMissing);
  const videoMissing = readBoolean(fixture.videoMissing);
  const retryDue = isHistoricalRecoveryRetryDue(fixture, now);

  if ((status === 'scheduled' || status === 'failed') && retryDue) {
    return status as HistoricalRecoveryCandidateKind;
  }

  if (status !== 'running') {
    return null;
  }

  if (resultMissing || (videoMissing && liveState === 'ended')) {
    return 'result_missing';
  }

  const kickoffAtMs = toTimestampMillis(resolveHistoricalRecoveryKickoffAt(fixture));
  const lifecycleMs = [
    toTimestampMillis(fixture.live?.lastLifecycleAt),
    toTimestampMillis(fixture.live?.startedAt),
    toTimestampMillis(fixture.live?.kickoffAttemptedAt),
    toTimestampMillis(fixture.live?.prewarmedAt),
    toTimestampMillis(fixture.live?.endedAt),
  ]
    .filter((value): value is number => value != null)
    .sort((left, right) => right - left)[0] ?? null;

  if (!hasMatchId) {
    return retryDue ? 'running_stale' : null;
  }

  if (liveState === 'ended') {
    return 'result_missing';
  }

  const staleReferenceMs = lifecycleMs ?? kickoffAtMs;
  if (staleReferenceMs == null) {
    return retryDue ? 'running_stale' : null;
  }

  const staleThresholdMs = runningTimeoutMinutes * 60_000;
  return nowMs - staleReferenceMs >= staleThresholdMs && retryDue
    ? 'running_stale'
    : null;
}

export function compareHistoricalFixtureDates(
  left: HistoricalRecoveryFixtureLike,
  right: HistoricalRecoveryFixtureLike,
) {
  const leftMs = toTimestampMillis(left.date) ?? Number.MAX_SAFE_INTEGER;
  const rightMs = toTimestampMillis(right.date) ?? Number.MAX_SAFE_INTEGER;
  return leftMs - rightMs;
}

export function resolveHistoricalRetryAt(
  now = new Date(),
  delayMinutes = NIGHTLY_RECOVERY_RETRY_DELAY_MINUTES,
) {
  return new Date(now.getTime() + Math.max(1, delayMinutes) * 60_000);
}

export function shouldFallbackAfterHistoricalAttempts(
  attemptCount: number,
  maxAttempts = NIGHTLY_RECOVERY_MAX_ATTEMPTS,
) {
  return attemptCount >= Math.max(1, maxAttempts);
}
