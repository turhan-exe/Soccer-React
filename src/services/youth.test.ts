import { describe, it, expect, vi } from 'vitest';
import {
  createYouthCandidate,
  resetCooldownWithDiamonds,
  YOUTH_COOLDOWN_MS,
} from './youth';
import type { Player } from '@/types';

vi.mock('./firebase', () => ({ db: {} }));

const docMock = vi.fn(() => ({ id: 'id' }));
const collectionMock = vi.fn(() => ({}));
const runTransactionMock = vi.fn();
const fromDateMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...args),
  collection: (...args: unknown[]) => collectionMock(...args),
  runTransaction: (...args: unknown[]) => runTransactionMock(...args),
  serverTimestamp: vi.fn(),
  Timestamp: { fromDate: (...args: unknown[]) => fromDateMock(...args) },
  increment: vi.fn(),
}));

const player: Player = {
  id: 'p1',
  name: 'Test',
  position: 'GK',
  roles: ['GK'],
  overall: 0.5,
  potential: 0.9,
  attributes: {
    strength: 0,
    acceleration: 0,
    topSpeed: 0,
    dribbleSpeed: 0,
    jump: 0,
    tackling: 0,
    ballKeeping: 0,
    passing: 0,
    longBall: 0,
    agility: 0,
    shooting: 0,
    shootPower: 0,
    positioning: 0,
    reaction: 0,
    ballControl: 0,
  },
  age: 16,
  height: 180,
  weight: 70,
  squadRole: 'youth',
};

describe('resetCooldownWithDiamonds', () => {
  it('throws when not enough diamonds', async () => {
    runTransactionMock.mockImplementation(async (_db, fn) => {
      await fn({
        get: async () => ({ data: () => ({ diamondBalance: 50 }) }),
        update: vi.fn(),
      });
    });
    await expect(resetCooldownWithDiamonds('uid')).rejects.toThrow('Yetersiz elmas');
  });
});

describe('createYouthCandidate', () => {
  it('throws if cooldown active', async () => {
    const future = new Date(Date.now() + 1000);
    runTransactionMock.mockImplementation(async (_db, fn) => {
      await fn({
        get: async () => ({ data: () => ({ youth: { nextGenerateAt: { toDate: () => future } } }) }),
        set: vi.fn(),
      });
    });
    await expect(createYouthCandidate('uid', player)).rejects.toThrow('2 saat beklemelisin');
  });

  it('sets next generate time 2 hours ahead', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    const setMock = vi.fn();
    runTransactionMock.mockImplementation(async (_db, fn) => {
      await fn({
        get: async () => ({ data: () => ({}) }),
        set: setMock,
      });
    });
    await createYouthCandidate('uid', player);
    expect(fromDateMock).toHaveBeenCalled();
    const calls = fromDateMock.mock.calls;
    const calledDate = calls[0][0] as Date;
    expect(calledDate.getTime()).toBe(Date.now() + YOUTH_COOLDOWN_MS);
    vi.useRealTimers();
  });
});

