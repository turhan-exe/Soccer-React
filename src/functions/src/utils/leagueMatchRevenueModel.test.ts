import { describe, expect, it } from 'vitest';
import type { Player } from '@/types';
import { getMatchRevenueEstimate } from '@/services/finance';
import {
  buildMatchRevenuePlan,
  getServerMatchRevenueEstimate,
  resolveFixtureRevenueTeamIdsFromLookups,
} from './leagueMatchRevenueModel';

const createPlayer = (
  id: number,
  overall: number,
  squadRole: Player['squadRole'] = 'starting',
): Player => ({
  id: `p-${id}`,
  name: `Player ${id}`,
  position: id === 0 ? 'GK' : 'CM',
  roles: id === 0 ? ['GK'] : ['CM'],
  overall,
  potential: overall,
  attributes: {
    strength: overall,
    acceleration: overall,
    topSpeed: overall,
    dribbleSpeed: overall,
    jump: overall,
    tackling: overall,
    ballKeeping: overall,
    passing: overall,
    longBall: overall,
    agility: overall,
    shooting: overall,
    shootPower: overall,
    positioning: overall,
    reaction: overall,
    ballControl: overall,
  },
  age: 24,
  height: 180,
  weight: 75,
  health: 1,
  condition: 1,
  motivation: 1,
  squadRole,
  contract: {
    expiresAt: '2099-01-01T00:00:00.000Z',
    status: 'active',
    salary: 5000,
  },
});

describe('leagueMatchRevenueModel', () => {
  it('matches the client-side match revenue formula', () => {
    const team = Array.from({ length: 11 }, (_, index) => createPlayer(index, 67));

    const serverEstimate = getServerMatchRevenueEstimate(3, team);
    const clientEstimate = getMatchRevenueEstimate(3, team);

    expect(serverEstimate).toEqual(clientEstimate);
  });

  it('keeps already applied sides idempotent and repairs missing markers from entries', () => {
    const appliedAt = new Date('2026-03-26T12:00:00.000Z');
    const weakerTeam = Array.from({ length: 11 }, (_, index) => createPlayer(index, 58));
    const strongerTeam = Array.from({ length: 11 }, (_, index) => createPlayer(index + 20, 74));

    const plan = buildMatchRevenuePlan(
      {
        existingAppliedSides: [],
        existingEntries: [
          {
            side: 'home',
            teamId: 'team-home',
            amount: 12345,
            appliedAt: new Date('2026-03-25T12:00:00.000Z'),
          },
        ],
        sides: [
          { side: 'home', teamId: 'team-home', players: weakerTeam, stadiumLevel: 1 },
          { side: 'away', teamId: 'team-away', players: strongerTeam, stadiumLevel: 4 },
        ],
      },
      { appliedAt },
    );

    expect(plan.pendingSides).toHaveLength(1);
    expect(plan.pendingSides[0]).toMatchObject({
      side: 'away',
      teamId: 'team-away',
    });
    expect(plan.skippedSides).toContainEqual({ side: 'home', reason: 'already_applied' });
    expect(plan.nextAppliedSides).toEqual(['home', 'away']);
    expect(plan.nextEntries).toHaveLength(2);
    expect(plan.nextEntries[1]).toMatchObject({
      side: 'away',
      teamId: 'team-away',
      amount: plan.pendingSides[0].amount,
      appliedAt,
    });
  });

  it('resolves slot-based fixture teams from lookup values, including bot team ids', () => {
    const resolved = resolveFixtureRevenueTeamIdsFromLookups(
      {
        homeTeamId: 'slot-1',
        awayTeamId: '',
      },
      {
        homeSlotTeamId: 'botteam-repair-bot-1',
        awaySlotTeamId: 'team-away',
      },
    );

    expect(resolved).toEqual({
      home: 'botteam-repair-bot-1',
      away: 'team-away',
    });
  });
});
