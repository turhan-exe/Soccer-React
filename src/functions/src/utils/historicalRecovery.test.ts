import { describe, expect, it } from 'vitest';
import {
  compareHistoricalFixtureDates,
  getHistoricalRecoveryAttemptCount,
  hasHistoricalRecoveryLock,
  isHistoricalRecoveryRetryDue,
  resolveHistoricalRecoveryCandidateKind,
  resolveHistoricalRetryAt,
  shouldCleanupHistoricalPlayedFixtureState,
  shouldFallbackAfterHistoricalAttempts,
} from './historicalRecovery.js';

const timestamp = (iso: string) => ({
  toDate: () => new Date(iso),
});

describe('historicalRecovery helpers', () => {
  const now = new Date('2026-04-19T05:00:00.000Z');

  it('selects scheduled and failed past fixtures', () => {
    expect(
      resolveHistoricalRecoveryCandidateKind(
        {
          status: 'scheduled',
          date: timestamp('2026-04-18T18:00:00.000Z'),
        },
        now,
      ),
    ).toBe('scheduled');

    expect(
      resolveHistoricalRecoveryCandidateKind(
        {
          status: 'failed',
          date: timestamp('2026-04-18T18:00:00.000Z'),
        },
        now,
      ),
    ).toBe('failed');
  });

  it('ignores future and settled fixtures', () => {
    expect(
      resolveHistoricalRecoveryCandidateKind(
        {
          status: 'scheduled',
          date: timestamp('2026-04-20T18:00:00.000Z'),
        },
        now,
      ),
    ).toBeNull();

    expect(
      resolveHistoricalRecoveryCandidateKind(
        {
          status: 'failed',
          date: timestamp('2026-04-18T18:00:00.000Z'),
          recovery: {
            state: 'settled',
          },
        },
        now,
      ),
    ).toBeNull();
  });

  it('detects stale running fixtures and missing results', () => {
    expect(
      resolveHistoricalRecoveryCandidateKind(
        {
          status: 'running',
          date: timestamp('2026-04-18T18:00:00.000Z'),
          live: {
            matchId: 'match-1',
            state: 'running',
            lastLifecycleAt: timestamp('2026-04-19T01:00:00.000Z'),
          },
        },
        now,
        120,
      ),
    ).toBe('running_stale');

    expect(
      resolveHistoricalRecoveryCandidateKind(
        {
          status: 'running',
          date: timestamp('2026-04-18T18:00:00.000Z'),
          live: {
            matchId: 'match-2',
            state: 'ended',
            resultMissing: true,
          },
        },
        now,
      ),
    ).toBe('result_missing');

    expect(
      resolveHistoricalRecoveryCandidateKind(
        {
          status: 'played',
          date: timestamp('2026-04-18T18:00:00.000Z'),
          score: null,
        },
        now,
      ),
    ).toBe('played_result_missing');

    expect(
      resolveHistoricalRecoveryCandidateKind(
        {
          status: 'played',
          date: timestamp('2026-04-18T18:00:00.000Z'),
          score: {
            home: 2,
            away: 1,
          },
          live: {
            state: 'kickoff_failed',
            resultMissing: true,
          },
        },
        now,
      ),
    ).toBeNull();

    expect(
      resolveHistoricalRecoveryCandidateKind(
        {
          status: 'played',
          date: timestamp('2026-04-18T18:00:00.000Z'),
          score: null,
          recovery: {
            state: 'settled',
          },
        },
        now,
      ),
    ).toBe('played_result_missing');
  });

  it('detects stale played fixtures that need silent cleanup', () => {
    expect(
      shouldCleanupHistoricalPlayedFixtureState({
        status: 'played',
        date: timestamp('2026-04-18T18:00:00.000Z'),
        score: {
          home: 1,
          away: 0,
        },
        live: {
          state: 'kickoff_failed',
          resultMissing: true,
          reason: 'allocation_not_found',
        },
      }),
    ).toBe(true);

    expect(
      shouldCleanupHistoricalPlayedFixtureState({
        status: 'played',
        date: timestamp('2026-04-18T18:00:00.000Z'),
        score: {
          home: 1,
          away: 0,
        },
        live: {
          state: 'ended',
          resultMissing: false,
        },
      }),
    ).toBe(false);
  });

  it('respects recovery lock and retry timestamps', () => {
    const lockedFixture = {
      status: 'failed',
      date: timestamp('2026-04-18T18:00:00.000Z'),
      recovery: {
        lockExpiresAt: timestamp('2026-04-19T06:00:00.000Z'),
        nextRetryAt: timestamp('2026-04-19T06:00:00.000Z'),
      },
    };

    expect(hasHistoricalRecoveryLock(lockedFixture, now)).toBe(true);
    expect(isHistoricalRecoveryRetryDue(lockedFixture, now)).toBe(false);
    expect(resolveHistoricalRecoveryCandidateKind(lockedFixture, now)).toBeNull();
  });

  it('sorts by fixture date and handles attempt helpers', () => {
    const fixtures = [
      { date: timestamp('2026-04-19T02:00:00.000Z') },
      { date: timestamp('2026-04-18T22:00:00.000Z') },
    ];
    fixtures.sort(compareHistoricalFixtureDates);

    expect(fixtures[0]?.date?.toDate().toISOString()).toBe('2026-04-18T22:00:00.000Z');
    expect(getHistoricalRecoveryAttemptCount({ recovery: { attemptCount: 2 } })).toBe(2);
    expect(shouldFallbackAfterHistoricalAttempts(1)).toBe(false);
    expect(shouldFallbackAfterHistoricalAttempts(2)).toBe(true);
    expect(resolveHistoricalRetryAt(now, 30).toISOString()).toBe('2026-04-19T05:30:00.000Z');
  });
});
