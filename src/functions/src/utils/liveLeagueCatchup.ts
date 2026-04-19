import { formatInTimeZone } from 'date-fns-tz';
import { trAt } from './time.js';

export type ManualKickoffSelection = {
  allForDay?: boolean;
  kickoffHour?: number | null;
};

export const MANUAL_CATCHUP_RESERVATION_BUFFER_MINUTES = 30;
const TZ = 'Europe/Istanbul';

function normalizeKickoffHours(kickoffHours: number[]): number[] {
  return Array.from(
    new Set(
      kickoffHours.filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23),
    ),
  ).sort((left, right) => left - right);
}

function dayKeyTR(date: Date) {
  return formatInTimeZone(date, TZ, 'yyyy-MM-dd');
}

export function resolveReservationKickoffAt(
  kickoffAt: Date | null | undefined,
  options: ManualKickoffSelection = {},
  now = new Date(),
): Date | null {
  if (!(kickoffAt instanceof Date) || Number.isNaN(kickoffAt.getTime())) {
    return null;
  }

  const isManualCatchup =
    options.allForDay === true || typeof options.kickoffHour === 'number';
  if (!isManualCatchup) {
    return kickoffAt;
  }

  const normalizedNow =
    now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  if (kickoffAt.getTime() >= normalizedNow.getTime()) {
    return kickoffAt;
  }

  return new Date(
    normalizedNow.getTime() +
      MANUAL_CATCHUP_RESERVATION_BUFFER_MINUTES * 60_000,
  );
}

export function resolveSameDayRetryKickoffAt(
  fixtureKickoffAt: Date | null | undefined,
  now = new Date(),
  kickoffHours: number[] = [],
  minDelayMinutes = 5,
): Date | null {
  if (!(fixtureKickoffAt instanceof Date) || Number.isNaN(fixtureKickoffAt.getTime())) {
    return null;
  }

  const normalizedNow =
    now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const resolvedHours = normalizeKickoffHours(kickoffHours);
  if (resolvedHours.length === 0) {
    return null;
  }

  const earliestMs = Math.max(
    normalizedNow.getTime() + Math.max(1, minDelayMinutes) * 60_000,
    fixtureKickoffAt.getTime() + 60_000,
  );
  const fixtureDayKey = dayKeyTR(fixtureKickoffAt);
  const earliestDayKey = dayKeyTR(new Date(earliestMs));
  if (fixtureDayKey !== earliestDayKey) {
    return null;
  }

  for (const hour of resolvedHours) {
    const candidate = trAt(fixtureKickoffAt, hour, 0);
    if (candidate.getTime() >= earliestMs) {
      return candidate;
    }
  }

  return null;
}
