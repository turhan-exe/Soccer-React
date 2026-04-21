import { describe, expect, it } from 'vitest';

import {
  getLeagueActionableFixture,
  isFixtureLiveJoinable,
  resolveFixtureLivePresentationState,
  resolveFixtureWatchAvailability,
} from './fixtureLive';

const baseDate = new Date('2026-04-19T16:00:00.000Z');

describe('fixtureLive helpers', () => {
  it('marks a kickoff-reached fixture without a live match as queued', () => {
    const state = resolveFixtureLivePresentationState(
      {
        status: 'scheduled',
        date: baseDate,
        live: null,
      },
      baseDate.getTime() + 60_000,
    );

    expect(state).toBe('queued');
    expect(
      resolveFixtureWatchAvailability(
        {
          status: 'scheduled',
          date: baseDate,
          live: null,
        },
        baseDate.getTime() + 60_000,
      ),
    ).toBe('queued');
  });

  it('maps no_free_slot failures to the visible queue state', () => {
    const fixture = {
      status: 'scheduled',
      date: baseDate,
      live: {
        state: 'prepare_failed',
        reason: 'match-control /v1/league/prepare-slot failed (500): {"error":"no_free_slot"}',
      },
    };

    expect(resolveFixtureLivePresentationState(fixture, baseDate.getTime() + 120_000)).toBe('queued');
  });

  it('marks delayed prepared fixtures as preparing_delayed', () => {
    const fixture = {
      status: 'scheduled',
      date: baseDate,
      live: {
        matchId: 'fx-1',
        state: 'warm',
      },
    };

    expect(resolveFixtureLivePresentationState(fixture, baseDate.getTime() + 120_000)).toBe(
      'preparing_delayed',
    );
    expect(resolveFixtureWatchAvailability(fixture, baseDate.getTime() + 120_000)).toBe(
      'preparing_delayed',
    );
  });

  it('keeps real server_started/running fixtures joinable', () => {
    const fixture = {
      status: 'running',
      date: baseDate,
      live: {
        matchId: 'fx-1',
        state: 'server_started',
        startedAt: new Date('2026-04-19T16:02:00.000Z'),
        lastLifecycleAt: new Date('2026-04-19T16:02:00.000Z'),
      },
    };

    expect(isFixtureLiveJoinable(fixture, Date.parse('2026-04-19T16:03:00.000Z'))).toBe(true);
    expect(resolveFixtureLivePresentationState(fixture, Date.parse('2026-04-19T16:03:00.000Z'))).toBe(
      'live',
    );
  });

  it('shows result_pending instead of finished when score is missing', () => {
    const fixture = {
      status: 'played',
      date: baseDate,
      score: null,
      live: {
        state: 'result_pending',
        resultMissing: true,
        endedAt: new Date('2026-04-19T16:10:00.000Z'),
      },
    };

    expect(resolveFixtureLivePresentationState(fixture, Date.parse('2026-04-19T16:20:00.000Z'))).toBe(
      'result_pending',
    );
    expect(resolveFixtureWatchAvailability(fixture, Date.parse('2026-04-19T16:20:00.000Z'))).toBe(
      'unavailable',
    );
  });

  it('uses the same prioritized league fixture selection across screens', () => {
    const selected = getLeagueActionableFixture(
      [
        {
          id: 'queued',
          status: 'scheduled',
          date: baseDate,
          live: null,
        },
        {
          id: 'live',
          status: 'running',
          date: new Date('2026-04-19T16:05:00.000Z'),
          live: {
            matchId: 'fx-live',
            state: 'running',
            startedAt: new Date('2026-04-19T16:05:00.000Z'),
            lastLifecycleAt: new Date('2026-04-19T16:05:00.000Z'),
          },
        },
      ],
      Date.parse('2026-04-19T16:06:00.000Z'),
    );

    expect(selected).toEqual({
      fixture: expect.objectContaining({ id: 'live' }),
      state: 'live',
    });
  });
});
