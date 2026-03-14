import { normalizeCapacity } from './roundrobin.js';

export const DEFAULT_MONTHLY_LEAGUE_COUNT = 25;
export const DEFAULT_MONTHLY_CAPACITY = 16;

export function resolveLeagueCapacity(input?: unknown): number {
  const raw = Number(input ?? DEFAULT_MONTHLY_CAPACITY);
  if (!Number.isFinite(raw)) {
    return DEFAULT_MONTHLY_CAPACITY;
  }
  return normalizeCapacity(raw);
}

export function resolveLeagueCount(input?: unknown): number {
  const raw = Number(input ?? DEFAULT_MONTHLY_LEAGUE_COUNT);
  if (!Number.isFinite(raw)) {
    return DEFAULT_MONTHLY_LEAGUE_COUNT;
  }
  return Math.max(1, Math.floor(raw));
}

export function roundsForCapacity(input?: unknown): number {
  const capacity = resolveLeagueCapacity(input);
  return Math.max(2, (capacity - 1) * 2);
}
