import { describe, expect, it } from 'vitest';
import {
  planFixtureCalendarRepair,
  resolveCanonicalLeagueFixtureDate,
  resolveFixtureCalendarDriftKind,
} from './leagueFixtureCalendar.js';

const timestamp = (iso: string) => ({
  toDate: () => new Date(iso),
});

describe('leagueFixtureCalendar', () => {
  const league = {
    kickoffHourTR: 12,
    startDate: timestamp('2026-04-01T00:00:00.000Z'),
  };

  it('derives the canonical round kickoff from league start date and kickoff hour', () => {
    const canonical = resolveCanonicalLeagueFixtureDate(league, 3);
    expect(canonical?.toISOString()).toBe('2026-04-03T09:00:00.000Z');
  });

  it('detects day and time drift separately', () => {
    expect(
      resolveFixtureCalendarDriftKind(
        new Date('2026-04-03T09:00:00.000Z'),
        new Date('2026-04-03T09:00:00.000Z'),
      ),
    ).toBeNull();
    expect(
      resolveFixtureCalendarDriftKind(
        new Date('2026-04-03T16:00:00.000Z'),
        new Date('2026-04-03T09:00:00.000Z'),
      ),
    ).toBe('time_only');
    expect(
      resolveFixtureCalendarDriftKind(
        new Date('2026-04-04T09:00:00.000Z'),
        new Date('2026-04-03T09:00:00.000Z'),
      ),
    ).toBe('day_only');
  });

  it('plans a played fixture as date-only normalization', () => {
    const plan = planFixtureCalendarRepair({
      league,
      fixture: {
        round: 3,
        date: timestamp('2026-04-04T09:00:00.000Z'),
        status: 'played',
      },
      includePlayed: true,
      now: new Date('2026-04-19T10:00:00.000Z'),
    });

    expect(plan.action).toBe('played_date_only');
    expect(plan.canonicalDate?.toISOString()).toBe('2026-04-03T09:00:00.000Z');
  });

  it('skips actively running fixtures and resets stale unplayed ones', () => {
    const activePlan = planFixtureCalendarRepair({
      league,
      fixture: {
        round: 3,
        date: timestamp('2026-04-04T09:00:00.000Z'),
        status: 'running',
        live: {
          matchId: 'match-1',
          state: 'running',
          lastLifecycleAt: timestamp('2026-04-19T09:50:00.000Z'),
        },
      },
      now: new Date('2026-04-19T10:00:00.000Z'),
    });

    const stalePlan = planFixtureCalendarRepair({
      league,
      fixture: {
        round: 3,
        date: timestamp('2026-04-04T09:00:00.000Z'),
        status: 'failed',
        live: {
          state: 'failed',
        },
      },
      now: new Date('2026-04-19T10:00:00.000Z'),
    });

    expect(activePlan.action).toBe('skip_active');
    expect(stalePlan.action).toBe('unplayed_reset');
  });
});
