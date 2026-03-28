import { describe, expect, it } from 'vitest';

import type { Player } from '@/types';

import {
  LINEUP_VITAL_THRESHOLD,
  getLineupReadinessIssues,
} from './teamPlanningUtils';

const createPlayer = (overrides: Partial<Player> = {}): Player => ({
  id: 'p1',
  name: 'Readiness Test',
  position: 'CM',
  roles: ['CM'],
  overall: 0.74,
  potential: 0.86,
  attributes: {
    strength: 0.7,
    acceleration: 0.7,
    topSpeed: 0.7,
    dribbleSpeed: 0.7,
    jump: 0.7,
    tackling: 0.7,
    ballKeeping: 0.7,
    passing: 0.7,
    longBall: 0.7,
    agility: 0.7,
    shooting: 0.7,
    shootPower: 0.7,
    positioning: 0.7,
    reaction: 0.7,
    ballControl: 0.7,
  },
  age: 25,
  height: 180,
  weight: 76,
  health: 1,
  condition: 0.82,
  motivation: 0.8,
  injuryStatus: 'healthy',
  squadRole: 'starting',
  ...overrides,
});

describe('getLineupReadinessIssues', () => {
  it('returns only starting players below threshold', () => {
    const issues = getLineupReadinessIssues([
      createPlayer({
        id: 'starter-low',
        name: 'Starter Low',
        condition: LINEUP_VITAL_THRESHOLD - 0.01,
      }),
      createPlayer({
        id: 'starter-ok',
        name: 'Starter Ok',
        squadRole: 'starting',
      }),
      createPlayer({
        id: 'bench-low',
        name: 'Bench Low',
        squadRole: 'bench',
        motivation: 0.2,
      }),
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.player.id).toBe('starter-low');
    expect(issues[0]?.failingVitals.map(issue => issue.key)).toEqual(['condition']);
  });

  it('reports multiple failing vitals for the same player', () => {
    const issues = getLineupReadinessIssues([
      createPlayer({
        id: 'multi',
        health: 0.4,
        condition: 0.55,
        motivation: 0.59,
      }),
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.failingVitals.map(issue => issue.key)).toEqual([
      'health',
      'condition',
      'motivation',
    ]);
  });
});
