import { describe, expect, it } from 'vitest';
import { buildMonthlyLeagueResetPlan } from './monthlyLeagueResetPlan';

describe('buildMonthlyLeagueResetPlan', () => {
  it('keeps a league with 12 humans in place and does not open a new league', () => {
    const plan = buildMonthlyLeagueResetPlan({
      capacity: 14,
      leagues: [
        {
          leagueId: 'league-1',
          slots: Array.from({ length: 12 }, (_, index) => ({
            slotIndex: index + 1,
            teamId: `t${index + 1}`,
            kind: 'human' as const,
          })),
        },
      ],
    });

    expect(plan.existingLeagues).toEqual([
      { leagueId: 'league-1', humanTeamIds: Array.from({ length: 12 }, (_, index) => `t${index + 1}`) },
    ]);
    expect(plan.newLeagues).toEqual([]);
  });

  it('moves overflow humans into existing leagues before opening a new one', () => {
    const plan = buildMonthlyLeagueResetPlan({
      capacity: 14,
      leagues: [
        {
          leagueId: 'league-1',
          slots: Array.from({ length: 16 }, (_, index) => ({
            slotIndex: index + 1,
            teamId: `a${index + 1}`,
            kind: 'human' as const,
          })),
        },
        {
          leagueId: 'league-2',
          slots: Array.from({ length: 12 }, (_, index) => ({
            slotIndex: index + 1,
            teamId: `b${index + 1}`,
            kind: 'human' as const,
          })),
        },
      ],
    });

    expect(plan.existingLeagues).toEqual([
      { leagueId: 'league-1', humanTeamIds: Array.from({ length: 14 }, (_, index) => `a${index + 1}`) },
      {
        leagueId: 'league-2',
        humanTeamIds: [
          ...Array.from({ length: 12 }, (_, index) => `b${index + 1}`),
          'a15',
          'a16',
        ],
      },
    ]);
    expect(plan.newLeagues).toEqual([]);
  });

  it('opens only the required number of new leagues when all existing leagues are full', () => {
    const plan = buildMonthlyLeagueResetPlan({
      capacity: 14,
      leagues: [
        {
          leagueId: 'league-1',
          slots: Array.from({ length: 16 }, (_, index) => ({
            slotIndex: index + 1,
            teamId: `a${index + 1}`,
            kind: 'human' as const,
          })),
        },
        {
          leagueId: 'league-2',
          slots: Array.from({ length: 14 }, (_, index) => ({
            slotIndex: index + 1,
            teamId: `b${index + 1}`,
            kind: 'human' as const,
          })),
        },
      ],
    });

    expect(plan.existingLeagues).toEqual([
      { leagueId: 'league-1', humanTeamIds: Array.from({ length: 14 }, (_, index) => `a${index + 1}`) },
      { leagueId: 'league-2', humanTeamIds: Array.from({ length: 14 }, (_, index) => `b${index + 1}`) },
    ]);
    expect(plan.newLeagues).toEqual([{ humanTeamIds: ['a15', 'a16'] }]);
  });

  it('drops bots before humans and keeps slot 15-16 humans inside the same league when capacity allows', () => {
    const plan = buildMonthlyLeagueResetPlan({
      capacity: 14,
      leagues: [
        {
          leagueId: 'league-1',
          slots: [
            ...Array.from({ length: 12 }, (_, index) => ({
              slotIndex: index + 1,
              teamId: `h${index + 1}`,
              kind: 'human' as const,
            })),
            { slotIndex: 13, teamId: null, kind: 'bot' as const },
            { slotIndex: 14, teamId: null, kind: 'bot' as const },
            { slotIndex: 15, teamId: 'h13', kind: 'human' as const },
            { slotIndex: 16, teamId: 'h14', kind: 'human' as const },
          ],
        },
      ],
    });

    expect(plan.existingLeagues).toEqual([
      {
        leagueId: 'league-1',
        humanTeamIds: [
          ...Array.from({ length: 12 }, (_, index) => `h${index + 1}`),
          'h13',
          'h14',
        ],
      },
    ]);
    expect(plan.newLeagues).toEqual([]);
  });
});
