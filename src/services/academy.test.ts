import { describe, it, expect, vi } from 'vitest';
import {
  resetCooldownWithDiamonds,
  pullNewCandidate,
  ACADEMY_COOLDOWN_MS,
  acceptCandidate,
  releaseCandidate,
} from './academy';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const docMock = vi.fn(() => ({}));
const collectionMock = vi.fn(() => ({}));
const runTransactionMock = vi.fn();
const fromDateMock = vi.fn();
const getDocMock = vi.fn();
const updateDocMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...args),
  collection: (...args: unknown[]) => collectionMock(...args),
  runTransaction: (...args: unknown[]) => runTransactionMock(...args),
  serverTimestamp: vi.fn(),
  Timestamp: { fromDate: (...args: unknown[]) => fromDateMock(...args) },
  increment: vi.fn(),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  updateDoc: (...args: unknown[]) => updateDocMock(...args),
}));

vi.mock('./team', () => ({ addPlayerToTeam: vi.fn() }));

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

describe('pullNewCandidate', () => {
  it('throws if cooldown active', async () => {
    const future = new Date(Date.now() + 1000);
    runTransactionMock.mockImplementation(async (_db, fn) => {
      await fn({
        get: async () => ({ data: () => ({ academy: { nextPullAt: { toDate: () => future } } }) }),
        set: vi.fn(),
      });
    });
    await expect(pullNewCandidate('uid')).rejects.toThrow('2 saat beklemelisin');
  });

  it('sets next pull time 2 hours ahead', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    const setMock = vi.fn();
    runTransactionMock.mockImplementation(async (_db, fn) => {
      await fn({
        get: async () => ({ data: () => ({}) }),
        set: setMock,
      });
  });
  await pullNewCandidate('uid');
  expect(fromDateMock).toHaveBeenCalled();
  // Use the last call which reflects the cooldown timestamp
  const calls = fromDateMock.mock.calls;
  const calledDate = calls[calls.length - 1][0] as Date;
  expect(calledDate.getTime()).toBe(Date.now() + ACADEMY_COOLDOWN_MS);
  vi.useRealTimers();
  });
});

describe('candidate status updates', () => {
  it('marks candidate as accepted', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ player: { name: 'a', position: 'MID', overall: 0.5, age: 17, potential: 0.9, traits: [], attributes: { topSpeed: 0.5, shooting: 0.5 } } }),
    });
    await acceptCandidate('uid', 'cid');
    expect(updateDocMock).toHaveBeenCalledWith({}, { status: 'accepted' });
  });

  it('marks candidate as released', async () => {
    updateDocMock.mockClear();
    await releaseCandidate('uid', 'cid2');
    expect(updateDocMock).toHaveBeenCalledWith({}, { status: 'released' });
  });
});
