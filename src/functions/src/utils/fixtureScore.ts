export type CanonicalFixtureScore = {
  home: number;
  away: number;
};

type ReplayGoalEvent = {
  type?: unknown;
  club?: unknown;
};

const parseNonNegativeInt = (value: unknown): number | null => {
  if (value == null || value === '') {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const normalized = Math.trunc(numeric);
  return normalized >= 0 ? normalized : null;
};

export const normalizeCanonicalFixtureScore = (
  raw: unknown,
): CanonicalFixtureScore | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const score = raw as Record<string, unknown>;
  const home =
    parseNonNegativeInt(score.home) ??
    parseNonNegativeInt(score.h) ??
    parseNonNegativeInt(score.homeGoals);
  const away =
    parseNonNegativeInt(score.away) ??
    parseNonNegativeInt(score.a) ??
    parseNonNegativeInt(score.awayGoals);

  if (home == null || away == null) {
    return null;
  }

  return { home, away };
};

export const hasCanonicalFixtureScore = (raw: unknown): boolean =>
  normalizeCanonicalFixtureScore(raw) != null;

export const deriveReplayPayloadScore = (
  raw: unknown,
): CanonicalFixtureScore | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const payload = raw as Record<string, unknown>;
  const summary =
    payload.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)
      ? (payload.summary as Record<string, unknown>)
      : null;

  const summaryScore = normalizeCanonicalFixtureScore(summary);
  if (summaryScore) {
    return summaryScore;
  }

  const events = Array.isArray(summary?.events) ? (summary?.events as ReplayGoalEvent[]) : [];
  if (events.length <= 0) {
    return null;
  }

  let home = 0;
  let away = 0;
  for (const event of events) {
    if (String(event?.type || '').trim().toLowerCase() !== 'goal') {
      continue;
    }
    const club = String(event?.club || '').trim().toLowerCase();
    if (club === 'home') {
      home += 1;
    } else if (club === 'away') {
      away += 1;
    }
  }

  return { home, away };
};
