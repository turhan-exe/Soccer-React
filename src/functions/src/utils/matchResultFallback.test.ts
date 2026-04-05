import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: () => ({
      get: async () => ({ exists: false }),
    }),
    runTransaction: async () => undefined,
  }),
  FieldValue: {
    serverTimestamp: () => ({ __type: 'serverTimestamp' }),
    delete: () => ({ __type: 'delete' }),
    increment: (value: number) => ({ __type: 'increment', value }),
  },
}));

function makePlayers(prefix: string, overall: number, count = 11) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    overall,
    squadRole: 'reserve',
    contract: {
      status: 'active',
    },
  }));
}

describe('matchResultFallback', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns the same fallback score for the same fixture seed and strengths', async () => {
    const { resolveDeterministicFallbackScore } = await import('./matchResultFallback');

    const first = resolveDeterministicFallbackScore({
      leagueId: 'league-1',
      fixtureId: 'fixture-1',
      homeStrength: 71,
      awayStrength: 68,
    });
    const second = resolveDeterministicFallbackScore({
      leagueId: 'league-1',
      fixtureId: 'fixture-1',
      homeStrength: 71,
      awayStrength: 68,
    });

    expect(first).toEqual(second);
  });

  it('can produce a draw for close-strength fixtures', async () => {
    const { resolveDeterministicFallbackScore } = await import('./matchResultFallback');

    let drawResult:
      | ReturnType<typeof resolveDeterministicFallbackScore>
      | null = null;

    for (let index = 1; index <= 300; index += 1) {
      const candidate = resolveDeterministicFallbackScore({
        leagueId: 'league-tight',
        fixtureId: `fixture-${index}`,
        homeStrength: 70,
        awayStrength: 69,
      });
      if (candidate.outcome === 'draw') {
        drawResult = candidate;
        break;
      }
    }

    expect(drawResult).not.toBeNull();
    expect(drawResult?.score.home).toBe(drawResult?.score.away);
  });

  it('uses stronger win pools for large quality gaps', async () => {
    const { resolveDeterministicFallbackScore } = await import('./matchResultFallback');

    let decisiveResult:
      | ReturnType<typeof resolveDeterministicFallbackScore>
      | null = null;

    for (let index = 1; index <= 300; index += 1) {
      const candidate = resolveDeterministicFallbackScore({
        leagueId: 'league-gap',
        fixtureId: `fixture-${index}`,
        homeStrength: 88,
        awayStrength: 54,
      });
      if (candidate.outcome === 'home') {
        decisiveResult = candidate;
        break;
      }
    }

    expect(decisiveResult).not.toBeNull();
    expect([
      '2-0',
      '3-0',
      '3-1',
      '4-0',
      '4-1',
      '5-1',
    ]).toContain(`${decisiveResult?.score.home}-${decisiveResult?.score.away}`);
  });

  it('prefers match-plan starters before falling back to the strongest available XI', async () => {
    const { estimateFallbackTeamStrength } = await import('./matchResultFallback');

    const weakerStarterIds = Array.from({ length: 11 }, (_, index) => `starter-${index + 1}`);
    const weakStarters = weakerStarterIds.map((id) => ({
      id,
      overall: 60,
      squadRole: 'reserve',
      contract: { status: 'active' },
    }));
    const strongBench = makePlayers('bench', 86);

    const withPlanStarters = estimateFallbackTeamStrength({
      players: [...weakStarters, ...strongBench],
      starters: weakerStarterIds,
    });
    const withoutPlan = estimateFallbackTeamStrength({
      players: [...weakStarters, ...strongBench],
    });
    const defaultStrength = estimateFallbackTeamStrength({
      players: [],
    });

    expect(withPlanStarters).toBeLessThan(withoutPlan);
    expect(withPlanStarters).toBe(60);
    expect(withoutPlan).toBe(86);
    expect(defaultStrength).toBe(58);
  });
});
