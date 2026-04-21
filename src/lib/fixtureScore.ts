export type FixtureScore = { home: number; away: number };

function toScoreNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

export function normalizeFixtureScore(value: unknown): FixtureScore | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const home =
    toScoreNumber(raw.home) ??
    toScoreNumber(raw.h) ??
    toScoreNumber(raw.homeGoals);
  const away =
    toScoreNumber(raw.away) ??
    toScoreNumber(raw.a) ??
    toScoreNumber(raw.awayGoals);

  if (home == null || away == null) {
    return null;
  }

  return { home, away };
}
