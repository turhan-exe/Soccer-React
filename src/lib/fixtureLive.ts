import type { FirebaseTimestamp } from '@/types';
import { normalizeFixtureScore } from './fixtureScore';

type TimestampLike =
  | FirebaseTimestamp
  | Date
  | { toDate?: () => Date; seconds?: number; nanoseconds?: number }
  | null
  | undefined;

type FixtureLiveLike = {
  matchId?: string | null;
  state?: string | null;
  reason?: string | null;
  resultMissing?: boolean | null;
  prewarmedAt?: TimestampLike;
  kickoffAttemptedAt?: TimestampLike;
  startedAt?: TimestampLike;
  endedAt?: TimestampLike;
  lastLifecycleAt?: TimestampLike;
} | null | undefined;

type FixtureLiveAware = {
  status?: string | null;
  date?: Date | TimestampLike;
  score?: unknown;
  live?: FixtureLiveLike;
};

export const LIVE_JOINABLE_STATES = new Set(['server_started', 'running']);

const LIVE_PREPARING_STATES = new Set(['warm', 'starting', 'server_started']);
const LIVE_ACTIVE_STATES = new Set(['warm', 'starting', 'server_started', 'running']);
const LIVE_DELAYED_STATES = new Set(['warm', 'starting', 'server_started']);
const QUEUE_REASON_TOKENS = ['no_free_slot', 'allocation_failed'];
const LIVE_ACTIVITY_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const LIVE_PREP_FUTURE_WINDOW_MS = 3 * 60 * 60 * 1000;
const LIVE_PREP_PAST_GRACE_MS = 2 * 60 * 60 * 1000;
const LIVE_RUNNING_DATE_WINDOW_MS = 18 * 60 * 60 * 1000;
const LIVE_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type FixtureLivePresentationState =
  | 'live'
  | 'preparing'
  | 'queued'
  | 'preparing_delayed'
  | 'result_pending'
  | 'finished'
  | 'error';

export type FixtureWatchAvailability =
  | 'joinable'
  | 'queued'
  | 'preparing_delayed'
  | 'unavailable';

export function normalizeFixtureStatus(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function toMillis(value: TimestampLike): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1_000_000);
  }
  return null;
}

function hasQueueReason(fixture: FixtureLiveAware): boolean {
  const reason = normalizeFixtureStatus(fixture.live?.reason);
  return QUEUE_REASON_TOKENS.some((token) => reason.includes(token));
}

function isKickoffReached(fixture: FixtureLiveAware, nowMs = Date.now()): boolean {
  const fixtureDateMs = toMillis(fixture.date as TimestampLike);
  return fixtureDateMs != null && nowMs >= fixtureDateMs;
}

function getLatestLifecycleAtMs(fixture: FixtureLiveAware): number | null {
  const live = fixture.live;
  if (!live) return null;

  const values = [
    toMillis(live.lastLifecycleAt),
    toMillis(live.startedAt),
    toMillis(live.kickoffAttemptedAt),
    toMillis(live.prewarmedAt),
  ].filter((value): value is number => Number.isFinite(value));

  if (!values.length) return null;
  return Math.max(...values);
}

function hasFreshLifecycleSignal(fixture: FixtureLiveAware, nowMs = Date.now()): boolean {
  const latest = getLatestLifecycleAtMs(fixture);
  if (latest == null) return false;
  const ageMs = nowMs - latest;
  return ageMs >= -LIVE_FUTURE_CLOCK_SKEW_MS && ageMs <= LIVE_ACTIVITY_MAX_AGE_MS;
}

export function hasActiveFixtureLiveSignal(fixture: FixtureLiveAware, nowMs = Date.now()): boolean {
  const fixtureStatus = normalizeFixtureStatus(fixture.status);
  const liveState = normalizeFixtureStatus(fixture.live?.state);

  if (!LIVE_ACTIVE_STATES.has(liveState) && fixtureStatus !== 'running') {
    return false;
  }

  if (hasFreshLifecycleSignal(fixture, nowMs)) {
    return true;
  }

  const fixtureDateMs = toMillis(fixture.date as TimestampLike);
  if (fixtureDateMs == null) {
    return false;
  }

  const deltaMs = fixtureDateMs - nowMs;
  if (LIVE_PREPARING_STATES.has(liveState)) {
    return deltaMs >= -LIVE_PREP_PAST_GRACE_MS && deltaMs <= LIVE_PREP_FUTURE_WINDOW_MS;
  }

  if (fixtureStatus === 'running' || LIVE_JOINABLE_STATES.has(liveState)) {
    return Math.abs(deltaMs) <= LIVE_RUNNING_DATE_WINDOW_MS;
  }

  return false;
}

export function resolveEffectiveFixtureLiveState(fixture: FixtureLiveAware, nowMs = Date.now()): string {
  const fixtureStatus = normalizeFixtureStatus(fixture.status);
  const liveState = normalizeFixtureStatus(fixture.live?.state);

  if (liveState === 'result_pending') return 'result_pending';
  if (fixtureStatus === 'played' && normalizeFixtureScore(fixture.score)) return 'ended';
  if (fixtureStatus === 'failed' && LIVE_JOINABLE_STATES.has(liveState)) return 'failed';
  if (!hasActiveFixtureLiveSignal(fixture, nowMs)) return '';
  return liveState;
}

export function resolveFixtureLivePresentationState(
  fixture: FixtureLiveAware,
  nowMs = Date.now(),
): FixtureLivePresentationState | null {
  const fixtureStatus = normalizeFixtureStatus(fixture.status);
  const rawLiveState = normalizeFixtureStatus(fixture.live?.state);
  const effectiveLiveState = resolveEffectiveFixtureLiveState(fixture, nowMs);
  const liveState = effectiveLiveState || rawLiveState;
  const hasMatchId = String(fixture.live?.matchId || '').trim().length > 0;
  const kickoffReached = isKickoffReached(fixture, nowMs);
  const hasScore = normalizeFixtureScore(fixture.score) != null;
  const resultPending =
    rawLiveState === 'result_pending' ||
    fixture.live?.resultMissing === true ||
    ((fixtureStatus === 'played' || rawLiveState === 'ended') && !hasScore);
  const queuedFailure =
    kickoffReached
    && hasQueueReason(fixture)
    && (
      rawLiveState === 'failed'
      || rawLiveState === 'prepare_failed'
      || rawLiveState === 'kickoff_failed'
    );

  if (resultPending) {
    return 'result_pending';
  }

  if ((fixtureStatus === 'played' && hasScore) || liveState === 'ended') {
    return 'finished';
  }

  if (isFixtureLiveJoinable(fixture, nowMs)) {
    return 'live';
  }

  if (queuedFailure) {
    return hasMatchId ? 'preparing_delayed' : 'queued';
  }

  if (
    rawLiveState === 'failed'
    || rawLiveState === 'prepare_failed'
    || rawLiveState === 'kickoff_failed'
    || fixtureStatus === 'failed'
  ) {
    return 'error';
  }

  if (kickoffReached) {
    if (hasMatchId || LIVE_DELAYED_STATES.has(rawLiveState) || LIVE_DELAYED_STATES.has(liveState)) {
      return 'preparing_delayed';
    }
    if (
      fixtureStatus === 'scheduled'
      || fixtureStatus === 'running'
      || hasQueueReason(fixture)
    ) {
      return 'queued';
    }
  }

  if (LIVE_PREPARING_STATES.has(liveState) || LIVE_PREPARING_STATES.has(rawLiveState)) {
    return 'preparing';
  }

  return null;
}

export function resolveFixtureWatchAvailability(
  fixture: FixtureLiveAware,
  nowMs = Date.now(),
): FixtureWatchAvailability {
  const state = resolveFixtureLivePresentationState(fixture, nowMs);
  if (state === 'live') return 'joinable';
  if (state === 'queued') return 'queued';
  if (state === 'preparing_delayed') return 'preparing_delayed';
  return 'unavailable';
}

export function getLeagueActionableFixture<T extends FixtureLiveAware>(
  fixtures: T[],
  nowMs = Date.now(),
): { fixture: T; state: 'live' | 'queued' | 'preparing_delayed' } | null {
  const ranked = fixtures
    .map((fixture) => ({
      fixture,
      state: resolveFixtureLivePresentationState(fixture, nowMs),
      dateMs: toMillis(fixture.date as TimestampLike) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => left.dateMs - right.dateMs);

  for (const targetState of ['live', 'preparing_delayed', 'queued'] as const) {
    const match = ranked.find((item) => item.state === targetState);
    if (match) {
      return { fixture: match.fixture, state: targetState };
    }
  }

  return null;
}

export function isFixtureEffectivelyRunning(fixture: FixtureLiveAware, nowMs = Date.now()): boolean {
  return normalizeFixtureStatus(fixture.status) === 'running' && hasActiveFixtureLiveSignal(fixture, nowMs);
}

export function isFixtureLiveJoinable(fixture: FixtureLiveAware, nowMs = Date.now()): boolean {
  const matchId = String(fixture.live?.matchId || '').trim();
  const fixtureStatus = normalizeFixtureStatus(fixture.status);
  const liveState = resolveEffectiveFixtureLiveState(fixture, nowMs);

  if (!matchId) return false;
  if (fixtureStatus !== 'running') return false;
  return LIVE_JOINABLE_STATES.has(liveState);
}
