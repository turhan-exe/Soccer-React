import { describe, expect, it } from 'vitest';

import {
  buildChampionsLeagueKnockoutPlan,
  resolveDeterministicPenaltyShootout,
} from './championsLeague';

function makeParticipant(index: number) {
  return {
    teamId: `team-${index}`,
    teamName: `Team ${index}`,
    leagueId: `league-${index}`,
    leagueName: `League ${index}`,
    leaguePosition: 1,
    points: 100 - index,
    goalDifference: 50 - index,
    scored: 80 - index,
  };
}

describe('buildChampionsLeagueKnockoutPlan', () => {
  it('builds a 32-team bracket with 7 byes for 25 entrants', () => {
    const participants = Array.from({ length: 25 }, (_, index) => makeParticipant(index + 1));

    const plan = buildChampionsLeagueKnockoutPlan(participants, {
      slug: 'champions-league-2026-04',
      startDate: new Date('2026-04-01T08:00:00.000Z'),
      kickoffHour: 11,
      roundSpacingDays: 2,
      timezone: 'Europe/Istanbul',
    });

    expect(plan.bracketSize).toBe(32);
    expect(plan.rounds[0]).toHaveLength(16);
    expect(plan.rounds[0].filter((match) => match.isBye)).toHaveLength(7);
    expect(plan.rounds[0].filter((match) => !match.isBye)).toHaveLength(9);
  });
});

describe('resolveDeterministicPenaltyShootout', () => {
  it('returns a stable penalty result for the same match id and strengths', () => {
    const first = resolveDeterministicPenaltyShootout({
      matchId: 'fixture-1',
      homeOverall: 77.4,
      awayOverall: 74.2,
    });
    const second = resolveDeterministicPenaltyShootout({
      matchId: 'fixture-1',
      homeOverall: 77.4,
      awayOverall: 74.2,
    });

    expect(first).toEqual(second);
    expect(first.penalties.home).not.toBe(first.penalties.away);
  });
});
