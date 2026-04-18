export const MATCH_ENTRY_ACCESS_TTL_MS = 10 * 60 * 1000;

export type MatchEntryKind = 'friendly' | 'league' | 'champions';

type TimestampLike = {
  toMillis: () => number;
};

type MatchEntryAccessLike = {
  expiresAt?: unknown;
};

const toMillis = (value: unknown): number | null => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as TimestampLike).toMillis === 'function'
  ) {
    try {
      return Number((value as TimestampLike).toMillis());
    } catch {
      return null;
    }
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return null;
};

export const buildMatchEntryAccessDocId = (
  uid: string,
  matchKind: MatchEntryKind,
  targetId: string,
) => `${uid}__${matchKind}__${targetId}`;

export const resolveMatchEntryAccessStatus = (
  grant: MatchEntryAccessLike | undefined,
  nowMs = Date.now(),
) => {
  const expiresAtMs = toMillis(grant?.expiresAt);
  return {
    active: expiresAtMs != null && expiresAtMs > nowMs,
    expiresAtIso: expiresAtMs == null ? null : new Date(expiresAtMs).toISOString(),
  };
};
