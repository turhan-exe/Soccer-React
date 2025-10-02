import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createYouthCandidate,
  resetCooldownWithDiamonds,
  reduceCooldownWithAd,
  YOUTH_COOLDOWN_MS,
  YOUTH_AD_REDUCTION_MS,
  YOUTH_RESET_DIAMOND_COST,
} from './youth';
import type { Player } from '@/types';

vi.mock('./firebase', () => ({ db: {} }));

const docMock = vi.fn(() => ({ id: 'id' }));
const collectionMock = vi.fn(() => ({}));
const runTransactionMock = vi.fn();
const fromDateMock = vi.fn();
const addDocMock = vi.fn(() => ({ id: 'id' }));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...args),
  collection: (...args: unknown[]) => collectionMock(...args),
  runTransaction: (...args: unknown[]) => runTransactionMock(...args),
  addDoc: (...args: unknown[]) => addDocMock(...args),
  serverTimestamp: vi.fn(),
  Timestamp: { fromDate: (...args: unknown[]) => fromDateMock(...args) },
  increment: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: vi.fn(),
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
  condition: 0.7,
  motivation: 0.7,
  injuryStatus: 'healthy',
};

beforeEach(() => {
  docMock.mockReset();
  collectionMock.mockReset();
  runTransactionMock.mockReset();
  fromDateMock.mockReset();
  addDocMock.mockReset();
});

describe('resetCooldownWithDiamonds', () => {
  it('throws when not enough diamonds', async () => {
    runTransactionMock.mockImplementation(async (_db, fn) => {
      await fn({
        get: async () => ({ data: () => ({ diamondBalance: YOUTH_RESET_DIAMOND_COST - 1 }) }),
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
    await expect(createYouthCandidate('uid', player)).rejects.toThrow('1 hafta beklemelisin');
  });

  it('sets next generate time one cooldown ahead', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    const setMock = vi.fn();
    runTransactionMock.mockImplementation(async (_db, fn) => {
      await fn({
        get: async () => ({ data: () => ({}) }),
        set: setMock,
      });
    });
    addDocMock.mockResolvedValue({ id: 'id' });
    await createYouthCandidate('uid', player);
    expect(fromDateMock).toHaveBeenCalled();
    const calledDate = fromDateMock.mock.calls[0][0] as Date;
    expect(calledDate.getTime()).toBe(Date.now() + YOUTH_COOLDOWN_MS);
    expect(addDocMock).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('reduceCooldownWithAd', () => {
  it('reduces cooldown by ad duration but not past now', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    const setMock = vi.fn();
    runTransactionMock.mockImplementationOnce(async (_db, fn) => {
      await fn({
        get: async () => ({
          data: () => ({
            youth: {
              nextGenerateAt: { toDate: () => new Date('2020-01-02T00:00:00Z') },
            },
          }),
        }),
        set: setMock,
      });
    });
    await reduceCooldownWithAd('uid');
    expect(setMock).toHaveBeenCalled();
    const updatedDate = fromDateMock.mock.calls.at(-1)?.[0] as Date;
    const expected = new Date(
      new Date('2020-01-02T00:00:00Z').getTime() - YOUTH_AD_REDUCTION_MS,
    );
    expect(updatedDate.toISOString()).toBe(expected.toISOString());

    const secondSetMock = vi.fn();
    runTransactionMock.mockImplementationOnce(async (_db, fn) => {
      await fn({
        get: async () => ({
          data: () => ({
            youth: {
              nextGenerateAt: { toDate: () => new Date('2020-01-01T06:00:00Z') },
            },
          }),
        }),
        set: secondSetMock,
      });
    });
    await reduceCooldownWithAd('uid');
    const updatedDate2 = fromDateMock.mock.calls.at(-1)?.[0] as Date;
    expect(updatedDate2.getTime()).toBe(Date.now());
    vi.useRealTimers();
  });
});

