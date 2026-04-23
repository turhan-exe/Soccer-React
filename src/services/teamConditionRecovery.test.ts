import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimTeamConditionRecoveryToast } from './teamConditionRecovery';

vi.mock('@/services/firebase', () => ({ db: {} }));

const {
  docMock,
  runTransactionMock,
} = vi.hoisted(() => ({
  docMock: vi.fn(),
  runTransactionMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...args),
  runTransaction: (...args: unknown[]) => runTransactionMock(...args),
}));

const createPlayer = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Recovery Test',
  position: 'CM',
  roles: ['CM'],
  overall: 0.72,
  potential: 0.88,
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
  age: 24,
  height: 180,
  weight: 75,
  health: 1,
  condition: 0.8,
  motivation: 0.8,
  injuryStatus: 'healthy',
  squadRole: 'starting',
  ...overrides,
});

beforeEach(() => {
  docMock.mockReset();
  runTransactionMock.mockReset();
});

describe('claimTeamConditionRecoveryToast', () => {
  it('returns no_pending and clears invalid pending toast payloads', async () => {
    const teamRef = { path: 'teams/user-1' };
    const setMock = vi.fn();

    docMock.mockReturnValue(teamRef);
    runTransactionMock.mockImplementationOnce(async (_db, callback) =>
      callback({
        get: async () => ({
          exists: () => true,
          data: () => ({
            conditionRecoveryPendingToast: {
              totalGain: 0,
              totalPlayers: 25,
              affectedPlayers: 0,
              appliedTicks: 0,
              updatedAt: '2026-04-18T12:00:00.000Z',
            },
          }),
        }),
        set: setMock,
      }),
    );

    const result = await claimTeamConditionRecoveryToast('user-1');

    expect(result.status).toBe('no_pending');
    expect(result.averageConditionGainPct).toBe(0);
    expect(result.averageMotivationGainPct).toBe(0);
    expect(result.averageHealthGainPct).toBe(0);
    expect(setMock).toHaveBeenCalledOnce();
    expect(setMock.mock.calls[0]?.[1]).toMatchObject({
      conditionRecoveryPendingToast: null,
    });
  });

  it('claims and clears the accumulated toast summary without mutating players', async () => {
    const teamRef = { path: 'teams/user-1' };
    const setMock = vi.fn();

    docMock.mockReturnValue(teamRef);
    runTransactionMock.mockImplementationOnce(async (_db, callback) =>
      callback({
        get: async () => ({
          exists: () => true,
          data: () => ({
            players: [
              createPlayer({ id: 'p1', condition: 0.99 }),
              createPlayer({ id: 'p2', condition: 0.5 }),
            ],
            conditionRecoveryPendingToast: {
              conditionGain: 0.1,
              motivationGain: 0.06,
              healthGain: 0.04,
              totalPlayers: 2,
              affectedPlayers: 2,
              appliedTicks: 1,
              updatedAt: '2026-04-18T16:00:00.000Z',
            },
          }),
        }),
        set: setMock,
      }),
    );

    const result = await claimTeamConditionRecoveryToast('user-1');

    expect(result.status).toBe('ok');
    expect(result.averageConditionGainPct).toBe(5);
    expect(result.averageMotivationGainPct).toBe(3);
    expect(result.averageHealthGainPct).toBe(2);
    expect(setMock).toHaveBeenCalledOnce();
    expect(setMock.mock.calls[0]?.[1]).toMatchObject({
      conditionRecoveryPendingToast: null,
    });
    expect(setMock.mock.calls[0]?.[1]).not.toHaveProperty('players');
  });

  it('claims legacy totalGain payloads as condition-only recovery', async () => {
    const teamRef = { path: 'teams/user-1' };
    const setMock = vi.fn();

    docMock.mockReturnValue(teamRef);
    runTransactionMock.mockImplementationOnce(async (_db, callback) =>
      callback({
        get: async () => ({
          exists: () => true,
          data: () => ({
            conditionRecoveryPendingToast: {
              totalGain: 0.03,
              totalPlayers: 2,
              affectedPlayers: 2,
              appliedTicks: 2,
              updatedAt: '2026-04-18T16:00:00.000Z',
            },
          }),
        }),
        set: setMock,
      }),
    );

    const result = await claimTeamConditionRecoveryToast('user-1');

    expect(result.status).toBe('ok');
    expect(result.averageConditionGainPct).toBe(1.5);
    expect(result.averageMotivationGainPct).toBe(0);
    expect(result.averageHealthGainPct).toBe(0);
    expect(setMock).toHaveBeenCalledOnce();
  });
});
