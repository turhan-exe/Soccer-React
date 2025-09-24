import { describe, it, expect } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';

import { buildKnockoutBracket, buildConferenceLeagueTournament } from './tournaments';
import type { KnockoutResult, TournamentParticipant } from '@/types';

function makeParticipant(id: string, leaguePosition: number, points: number, goalDifference: number, scored: number, leagueId: string): TournamentParticipant {
  return {
    teamId: `team-${id}`,
    teamName: `Team ${id}`,
    leagueId,
    leagueName: `League ${leagueId}`,
    leaguePosition,
    points,
    goalDifference,
    scored,
  };
}

describe('buildKnockoutBracket', () => {
  it('assigns seeds, handles byes, and schedules at requested hour', () => {
    const participants: TournamentParticipant[] = [
      makeParticipant('A1', 1, 60, 25, 55, 'L1'),
      makeParticipant('A2', 1, 58, 20, 50, 'L2'),
      makeParticipant('A3', 1, 56, 18, 48, 'L3'),
      makeParticipant('B1', 2, 52, 15, 40, 'L1'),
      makeParticipant('B2', 2, 50, 12, 38, 'L2'),
      makeParticipant('B3', 2, 49, 10, 36, 'L3'),
    ];

    const startDate = new Date('2025-01-01T00:00:00.000Z');
    const bracket = buildKnockoutBracket(participants, {
      name: 'Test Champions',
      slug: 'test-champions',
      kickoffHour: 15,
      timezone: 'Europe/Istanbul',
      startDate,
      roundSpacingDays: 2,
    });

    expect(bracket.participants.map((p) => p.seed)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(bracket.rounds[0].matches.length).toBe(4);
    const byeMatch = bracket.rounds[0].matches.find((m) => m.isBye);
    expect(byeMatch).toBeDefined();
    expect(byeMatch?.autoAdvanceSeed).toBeTruthy();

    const kickoffStr = formatInTimeZone(bracket.rounds[0].matches[0].scheduledAt, 'Europe/Istanbul', 'HH:mm');
    expect(kickoffStr).toBe('15:00');
  });
});

describe('buildConferenceLeagueTournament', () => {
  it('uses losers from round one and sets 12:00 kickoffs', () => {
    const participants: TournamentParticipant[] = [
      makeParticipant('A1', 1, 60, 25, 55, 'L1'),
      makeParticipant('A2', 1, 58, 20, 50, 'L2'),
      makeParticipant('A3', 1, 56, 18, 48, 'L3'),
      makeParticipant('B1', 2, 52, 15, 40, 'L1'),
      makeParticipant('B2', 2, 50, 12, 38, 'L2'),
      makeParticipant('B3', 2, 49, 10, 36, 'L3'),
    ];

    const champions = buildKnockoutBracket(participants, {
      name: '�ampiyonlar',
      slug: 'champions',
      kickoffHour: 15,
      timezone: 'Europe/Istanbul',
      startDate: new Date('2025-02-01T00:00:00Z'),
      roundSpacingDays: 2,
    });

    const roundOneResults: KnockoutResult[] = champions.rounds[0].matches
      .filter((match) => !match.isBye && match.homeParticipant && match.awayParticipant)
      .map((match) => ({
        matchId: match.id,
        winnerTeamId: match.homeParticipant!.teamId,
        loserTeamId: match.awayParticipant!.teamId,
      }));

    const conference = buildConferenceLeagueTournament(champions, roundOneResults, {
      startDate: new Date('2025-03-01T00:00:00Z'),
      timezone: 'Europe/Istanbul',
    });

    expect(conference.participants.length).toBe(roundOneResults.length);
    expect(conference.kickoffHour).toBe(12);
    const kickoffStr = formatInTimeZone(conference.rounds[0].matches[0].scheduledAt, 'Europe/Istanbul', 'HH:mm');
    expect(kickoffStr).toBe('12:00');
  });
});
