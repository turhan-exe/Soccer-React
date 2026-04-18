import { describe, expect, it } from 'vitest';
import {
  MATCH_ENTRY_ACCESS_TTL_MS,
  buildMatchEntryAccessDocId,
  resolveMatchEntryAccessStatus,
} from './matchEntryAccess';

describe('economy matchEntryAccess helpers', () => {
  it('uses a ten-minute ttl', () => {
    expect(MATCH_ENTRY_ACCESS_TTL_MS).toBe(600_000);
  });

  it('builds deterministic firestore doc ids', () => {
    expect(buildMatchEntryAccessDocId('u1', 'league', 'fx-1')).toBe('u1__league__fx-1');
  });

  it('marks grants active only while expiresAt is in the future', () => {
    const nowMs = Date.parse('2026-04-19T10:00:00.000Z');
    const active = resolveMatchEntryAccessStatus(
      {
        expiresAt: {
          toMillis: () => nowMs + 60_000,
        },
      },
      nowMs,
    );
    const expired = resolveMatchEntryAccessStatus(
      {
        expiresAt: {
          toMillis: () => nowMs - 1,
        },
      },
      nowMs,
    );

    expect(active).toEqual({
      active: true,
      expiresAtIso: '2026-04-19T10:01:00.000Z',
    });
    expect(expired).toEqual({
      active: false,
      expiresAtIso: '2026-04-19T09:59:59.999Z',
    });
  });
});
