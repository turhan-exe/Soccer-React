import { formatInTimeZone } from 'date-fns-tz';
import { alignLeagueStartDate } from './leagueKickoff.js';
import { dateForRound } from './time.js';

const TZ = 'Europe/Istanbul';
const ACTIVE_FIXTURE_WINDOW_MINUTES = 30;

type TimestampLike =
  | Date
  | { toDate?: () => Date; seconds?: number; nanoseconds?: number }
  | string
  | null
  | undefined;

export type LeagueFixtureCalendarLike = {
  kickoffHourTR?: unknown;
  startDate?: TimestampLike;
};

export type LeagueFixtureCalendarFixtureLike = {
  round?: unknown;
  date?: TimestampLike;
  status?: unknown;
  live?: {
    matchId?: unknown;
    state?: unknown;
    lastLifecycleAt?: TimestampLike;
    startedAt?: TimestampLike;
    kickoffAttemptedAt?: TimestampLike;
    prewarmedAt?: TimestampLike;
  } | null | undefined;
};

export type FixtureCalendarDriftKind = 'day_only' | 'day_and_time' | 'time_only';

export type FixtureCalendarRepairAction =
  | 'invalid'
  | 'noop'
  | 'played_date_only'
  | 'skip_active'
  | 'skip_played'
  | 'unplayed_reset';

export type FixtureCalendarRepairPlan = {
  action: FixtureCalendarRepairAction;
  actualDate: Date | null;
  canonicalDate: Date | null;
  driftKind: FixtureCalendarDriftKind | null;
  round: number | null;
  status: string;
};

export function timestampLikeToDate(value: TimestampLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const resolved = value.toDate();
    return resolved instanceof Date && !Number.isNaN(resolved.getTime()) ? resolved : null;
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    const millis = value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1_000_000);
    const resolved = new Date(millis);
    return Number.isNaN(resolved.getTime()) ? null : resolved;
  }
  return null;
}

function normalizeStatus(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function isTerminalLiveState(value: unknown) {
  const state = normalizeStatus(value);
  return state === 'ended' || state === 'failed';
}

function resolveLatestLifecycleAt(fixture: LeagueFixtureCalendarFixtureLike): Date | null {
  const live = fixture.live;
  if (!live) return null;
  const values = [
    timestampLikeToDate(live.lastLifecycleAt),
    timestampLikeToDate(live.startedAt),
    timestampLikeToDate(live.kickoffAttemptedAt),
    timestampLikeToDate(live.prewarmedAt),
  ]
    .filter((value): value is Date => value instanceof Date)
    .sort((left, right) => right.getTime() - left.getTime());
  return values[0] ?? null;
}

export function isActiveFixtureRuntime(
  fixture: LeagueFixtureCalendarFixtureLike,
  now = new Date(),
  activeWindowMinutes = ACTIVE_FIXTURE_WINDOW_MINUTES,
) {
  const status = normalizeStatus(fixture.status);
  const liveState = normalizeStatus(fixture.live?.state);
  const hasMatchId = String(fixture.live?.matchId || '').trim().length > 0;
  if (status !== 'running' || !hasMatchId || isTerminalLiveState(liveState)) {
    return false;
  }

  const latestLifecycleAt = resolveLatestLifecycleAt(fixture);
  if (!latestLifecycleAt) {
    return true;
  }

  const ageMs = now.getTime() - latestLifecycleAt.getTime();
  return ageMs >= -5 * 60_000 && ageMs <= activeWindowMinutes * 60_000;
}

function dayKeyTR(date: Date) {
  return formatInTimeZone(date, TZ, 'yyyy-MM-dd');
}

export function resolveFixtureCalendarDriftKind(
  actualDate: Date | null,
  canonicalDate: Date | null,
): FixtureCalendarDriftKind | null {
  if (!actualDate || !canonicalDate) return null;
  if (actualDate.getTime() === canonicalDate.getTime()) return null;

  const sameDay = dayKeyTR(actualDate) === dayKeyTR(canonicalDate);
  if (sameDay) {
    return 'time_only';
  }

  const actualClock = formatInTimeZone(actualDate, TZ, 'HH:mm');
  const canonicalClock = formatInTimeZone(canonicalDate, TZ, 'HH:mm');
  return actualClock === canonicalClock ? 'day_only' : 'day_and_time';
}

export function resolveCanonicalLeagueFixtureDate(
  league: LeagueFixtureCalendarLike,
  round: unknown,
): Date | null {
  const normalizedRound = Number(round);
  if (!Number.isInteger(normalizedRound) || normalizedRound <= 0) {
    return null;
  }

  const startDate = timestampLikeToDate(league.startDate);
  if (!startDate) {
    return null;
  }

  return dateForRound(
    alignLeagueStartDate(startDate, league.kickoffHourTR),
    normalizedRound,
  );
}

export function planFixtureCalendarRepair(input: {
  fixture: LeagueFixtureCalendarFixtureLike;
  includePlayed?: boolean;
  league: LeagueFixtureCalendarLike;
  now?: Date;
}): FixtureCalendarRepairPlan {
  const now =
    input.now instanceof Date && !Number.isNaN(input.now.getTime()) ? input.now : new Date();
  const round = Number.isInteger(Number(input.fixture.round)) ? Number(input.fixture.round) : null;
  const status = normalizeStatus(input.fixture.status);
  const actualDate = timestampLikeToDate(input.fixture.date);
  const canonicalDate = resolveCanonicalLeagueFixtureDate(input.league, input.fixture.round);
  const driftKind = resolveFixtureCalendarDriftKind(actualDate, canonicalDate);

  if (!actualDate || !canonicalDate || !round) {
    return {
      action: 'invalid',
      actualDate,
      canonicalDate,
      driftKind,
      round,
      status,
    };
  }

  if (!driftKind) {
    return {
      action: 'noop',
      actualDate,
      canonicalDate,
      driftKind,
      round,
      status,
    };
  }

  if (status === 'played') {
    return {
      action: input.includePlayed === false ? 'skip_played' : 'played_date_only',
      actualDate,
      canonicalDate,
      driftKind,
      round,
      status,
    };
  }

  if (isActiveFixtureRuntime(input.fixture, now)) {
    return {
      action: 'skip_active',
      actualDate,
      canonicalDate,
      driftKind,
      round,
      status,
    };
  }

  return {
    action: 'unplayed_reset',
    actualDate,
    canonicalDate,
    driftKind,
    round,
    status,
  };
}
