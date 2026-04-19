import { trAt } from './time.js';

export const DEFAULT_LEAGUE_KICKOFF_HOUR_TR = 19;

export function normalizeLeagueKickoffHour(value: unknown): number | null {
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }
  return hour;
}

export function parseLeagueKickoffHours(
  raw: unknown,
  fallbackHour: number = DEFAULT_LEAGUE_KICKOFF_HOUR_TR,
) {
  const values = String(raw || '')
    .split(',')
    .map((part) => normalizeLeagueKickoffHour(part.trim()))
    .filter((hour): hour is number => hour != null);
  const uniqueSorted = Array.from(new Set(values)).sort((a, b) => a - b);
  return uniqueSorted.length > 0 ? uniqueSorted : [fallbackHour];
}

export function assignLeagueKickoffHours(input: {
  pool: number[];
  count: number;
  existingHours?: Array<number | null | undefined>;
}) {
  const pool = input.pool.length > 0
    ? Array.from(new Set(input.pool)).sort((a, b) => a - b)
    : [DEFAULT_LEAGUE_KICKOFF_HOUR_TR];
  const counts = new Map<number, number>();
  pool.forEach((hour) => counts.set(hour, 0));
  (input.existingHours || []).forEach((hour) => {
    if (hour != null && counts.has(hour)) {
      counts.set(hour, (counts.get(hour) || 0) + 1);
    }
  });

  const assigned: number[] = [];
  for (let index = 0; index < input.count; index += 1) {
    const nextHour = [...pool].sort((left, right) => {
      const countDiff = (counts.get(left) || 0) - (counts.get(right) || 0);
      return countDiff !== 0 ? countDiff : left - right;
    })[0] ?? DEFAULT_LEAGUE_KICKOFF_HOUR_TR;
    assigned.push(nextHour);
    counts.set(nextHour, (counts.get(nextHour) || 0) + 1);
  }

  return assigned;
}

export function alignLeagueStartDate(
  baseDate: Date,
  kickoffHourTR: unknown,
  fallbackHour: number = DEFAULT_LEAGUE_KICKOFF_HOUR_TR,
) {
  const hour = normalizeLeagueKickoffHour(kickoffHourTR) ?? fallbackHour;
  return trAt(baseDate, hour);
}
