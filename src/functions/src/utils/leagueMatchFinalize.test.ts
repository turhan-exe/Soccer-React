import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runTransactionMock,
} = vi.hoisted(() => ({
  runTransactionMock: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => ({ path }),
    collection: (path: string) => ({
      doc: (id: string) => ({ path: `${path}/${id}` }),
    }),
    runTransaction: (callback: (tx: unknown) => Promise<unknown>) =>
      runTransactionMock(callback),
  }),
  FieldValue: {
    serverTimestamp: () => ({ __type: 'serverTimestamp' }),
    delete: () => ({ __type: 'delete' }),
  },
}));

const createRosterPlayer = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'League Test',
  condition: 0.8,
  motivation: 0.8,
  injuryStatus: 'healthy',
  squadRole: 'reserve',
  ...overrides,
});

beforeEach(() => {
  runTransactionMock.mockReset();
});

describe('leagueMatchFinalize', () => {
  it('applies starter condition loss while preserving bench and squad-out motivation penalties', async () => {
    const { applyLeagueLineupEffectsToRoster } = await import('./leagueMatchFinalize');

    const result = applyLeagueLineupEffectsToRoster(
      [
        createRosterPlayer({ id: 'starter', condition: 0.8, motivation: 0.9, squadRole: 'starting' }),
        createRosterPlayer({ id: 'bench', condition: 0.75, motivation: 0.8, squadRole: 'bench' }),
        createRosterPlayer({ id: 'reserve', condition: 0.7, motivation: 0.8, squadRole: 'reserve' }),
      ],
      new Set(['starter']),
      new Set(['bench']),
    );

    expect(result.changed).toBe(true);
    expect(result.starterConditionPenalties).toBe(1);
    expect(result.benchPenalties).toBe(1);
    expect(result.squadOutPenalties).toBe(1);
    expect(result.players[0]).toMatchObject({ id: 'starter', condition: 0.72, motivation: 0.9 });
    expect(result.players[1]).toMatchObject({ id: 'bench', condition: 0.75, motivation: 0.75 });
    expect(result.players[2]).toMatchObject({ id: 'reserve', condition: 0.7, motivation: 0.72 });
  });

  it('skips already processed fixtures so the same match cannot consume condition twice', async () => {
    const { applyLeagueLineupMotivationEffects } = await import('./leagueMatchFinalize');
    const txGetMock = vi.fn(async (ref: { path: string }) => {
      if (ref.path === 'leagues/league-1/fixtures/fixture-1') {
        return {
          exists: true,
          data: () => ({
            playerEffects: {
              lineupMotivationStatus: 'applied',
              lineupMotivationVersion: 1,
            },
          }),
        };
      }

      throw new Error(`Unexpected ref: ${ref.path}`);
    });
    const txSetMock = vi.fn();

    runTransactionMock.mockImplementationOnce(async (callback) =>
      callback({
        get: txGetMock,
        set: txSetMock,
      }),
    );

    const result = await applyLeagueLineupMotivationEffects('league-1', 'fixture-1');

    expect(result).toEqual({
      status: 'applied',
      starterConditionPenalties: 0,
      benchPenalties: 0,
      squadOutPenalties: 0,
    });
    expect(txSetMock).not.toHaveBeenCalled();
    expect(txGetMock).toHaveBeenCalledTimes(1);
  });
});
