import { describe, it, expect } from 'vitest';
import { generateRoundRobinFixtures } from './schedule';

describe('generateRoundRobinFixtures', () => {
  it('produces 21 rounds with 11 matches each (231 total) for 22 teams', () => {
    const teams = Array.from({ length: 22 }, (_, i) => `t${i + 1}`);
    const fixtures = generateRoundRobinFixtures(teams);
    const rounds = new Map<number, number>();
    fixtures.forEach(f => rounds.set(f.round, (rounds.get(f.round) || 0) + 1));
    expect(rounds.size).toBe(21);
    rounds.forEach(count => expect(count).toBe(11));
    expect(fixtures.length).toBe(231);
    // Each team plays once per round
    for (let r = 1; r <= 21; r++) {
      const teamsInRound = new Set<string>();
      fixtures.filter(f => f.round === r).forEach(f => {
        teamsInRound.add(f.homeTeamId);
        teamsInRound.add(f.awayTeamId);
      });
      expect(teamsInRound.size).toBe(22);
    }
  });
});
