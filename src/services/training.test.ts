import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finishTrainingWithDiamonds } from './training';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const {
  docMock,
  runTransactionMock,
  incrementMock,
  setDocMock,
  getDocMock,
  deleteDocMock,
  collectionMock,
  addDocMock,
  getDocsMock,
  TimestampMock,
} = vi.hoisted(() => ({
  docMock: vi.fn(),
  runTransactionMock: vi.fn(),
  incrementMock: vi.fn(),
  setDocMock: vi.fn(),
  getDocMock: vi.fn(),
  deleteDocMock: vi.fn(),
  collectionMock: vi.fn(),
  addDocMock: vi.fn(),
  getDocsMock: vi.fn(),
  TimestampMock: { now: vi.fn(), fromMillis: vi.fn() },
}));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...args),
  runTransaction: (...args: unknown[]) => runTransactionMock(...args),
  increment: (...args: unknown[]) => incrementMock(...args),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  deleteDoc: (...args: unknown[]) => deleteDocMock(...args),
  collection: (...args: unknown[]) => collectionMock(...args),
  addDoc: (...args: unknown[]) => addDocMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  Timestamp: TimestampMock,
}));

beforeEach(() => {
  docMock.mockReset();
  runTransactionMock.mockReset();
  setDocMock.mockReset();
  getDocMock.mockReset();
  deleteDocMock.mockReset();
  collectionMock.mockReset();
  addDocMock.mockReset();
  getDocsMock.mockReset();
});

describe('finishTrainingWithDiamonds', () => {
  it('throws when not enough diamonds', async () => {
    docMock.mockReturnValueOnce('userRef');
    docMock.mockReturnValueOnce('trainingRef');
    runTransactionMock.mockImplementation(async (_db, fn) => {
      await fn({
        get: async (ref: unknown) => {
          if (ref === 'userRef') {
            return { data: () => ({ diamondBalance: 10 }) };
          }
          return { exists: () => true, data: () => ({}) };
        },
        update: vi.fn(),
        delete: vi.fn(),
      });
    });
    await expect(finishTrainingWithDiamonds('uid')).rejects.toThrow('Yetersiz elmas');
  });

  it('deducts diamonds and clears session', async () => {
    docMock.mockReturnValueOnce('userRef');
    docMock.mockReturnValueOnce('trainingRef');
    const updateMock = vi.fn();
    const deleteMock = vi.fn();
    runTransactionMock.mockImplementationOnce(async (_db, fn) => {
      return await fn({
        get: async (ref: unknown) => {
          if (ref === 'userRef') {
            return { data: () => ({ diamondBalance: 200 }) };
          }
          return {
            exists: () => true,
            data: () => ({ playerId: 'p', trainingId: 't', startAt: {}, endAt: {} }),
          };
        },
        update: updateMock,
        delete: deleteMock,
      });
    });
    await finishTrainingWithDiamonds('uid');
    expect(updateMock).toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalled();
  });
});
