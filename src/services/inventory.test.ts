import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/firebase', () => ({ db: {} }));

const {
  docMock,
  runTransactionMock,
  serverTimestampMock,
} = vi.hoisted(() => ({
  docMock: vi.fn(),
  runTransactionMock: vi.fn(),
  serverTimestampMock: vi.fn(() => 'server-timestamp'),
}));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...args),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
  runTransaction: (...args: unknown[]) => runTransactionMock(...args),
  serverTimestamp: () => serverTimestampMock(),
  setDoc: vi.fn(),
}));

import {
  applyKitOperationsInInventory,
  KIT_NO_EFFECT_ERROR,
} from './inventory';

const createPlayer = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Inventory Test',
  position: 'CM',
  roles: ['CM'],
  overall: 0.72,
  potential: 0.84,
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
  condition: 1,
  motivation: 1,
  injuryStatus: 'healthy',
  squadRole: 'starting',
  ...overrides,
});

const createDocRef = (...segments: unknown[]) => ({
  path: segments.map((segment) => String(segment)).join('/'),
});

const createDocSnap = (data: Record<string, unknown> | null) => ({
  exists: () => data !== null,
  data: () => data,
});

beforeEach(() => {
  docMock.mockReset();
  runTransactionMock.mockReset();
  serverTimestampMock.mockClear();
  docMock.mockImplementation((...segments: unknown[]) =>
    createDocRef(...segments.slice(1)),
  );
});

describe('applyKitOperationsInInventory', () => {
  it('throws kit_no_effect without writing when the selected kit changes nothing', async () => {
    const setMock = vi.fn();

    runTransactionMock.mockImplementationOnce(async (_db, callback) =>
      callback({
        get: async (ref: { path: string }) => {
          if (ref.path === 'users/user-1/inventory/consumables') {
            return createDocSnap({
              kits: { energy: 1, morale: 0, health: 0 },
            });
          }

          return createDocSnap({
            players: [createPlayer()],
          });
        },
        set: setMock,
      }),
    );

    await expect(
      applyKitOperationsInInventory('user-1', [
        { type: 'energy', playerId: 'p1' },
      ]),
    ).rejects.toThrow(KIT_NO_EFFECT_ERROR);

    expect(setMock).not.toHaveBeenCalled();
  });

  it('applies only effective operations and keeps skipped no-op operations in the result', async () => {
    const setMock = vi.fn();

    runTransactionMock.mockImplementationOnce(async (_db, callback) =>
      callback({
        get: async (ref: { path: string }) => {
          if (ref.path === 'users/user-1/inventory/consumables') {
            return createDocSnap({
              kits: { energy: 2, morale: 0, health: 0 },
            });
          }

          return createDocSnap({
            players: [
              createPlayer(),
              createPlayer({
                id: 'p2',
                name: 'Ready To Boost',
                condition: 0.7,
              }),
            ],
          });
        },
        set: setMock,
      }),
    );

    const result = await applyKitOperationsInInventory('user-1', [
      { type: 'energy', playerId: 'p1' },
      { type: 'energy', playerId: 'p2' },
    ]);

    expect(result.appliedOperations).toEqual([
      { type: 'energy', playerId: 'p2' },
    ]);
    expect(result.skippedOperations).toEqual([
      { type: 'energy', playerId: 'p1', reason: 'no_effect' },
    ]);
    expect(result.kits).toEqual({
      energy: 1,
      morale: 0,
      health: 0,
    });
    expect(result.updatedPlayers).toHaveLength(1);
    expect(result.updatedPlayers[0]).toMatchObject({
      id: 'p2',
      condition: 0.9,
      motivation: 1,
    });
    expect(setMock).toHaveBeenCalledTimes(2);
    expect(setMock.mock.calls[0]?.[0]).toMatchObject({ path: 'teams/user-1' });
    expect(setMock.mock.calls[0]?.[1]).toMatchObject({
      players: expect.arrayContaining([
        expect.objectContaining({ id: 'p1', condition: 1 }),
        expect.objectContaining({ id: 'p2', condition: 0.9 }),
      ]),
    });
    expect(setMock.mock.calls[1]?.[0]).toMatchObject({
      path: 'users/user-1/inventory/consumables',
    });
    expect(setMock.mock.calls[1]?.[1]).toMatchObject({
      kits: { energy: 1, morale: 0, health: 0 },
      updatedAt: 'server-timestamp',
    });
  });
});
