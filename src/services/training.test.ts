import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finishTrainingWithDiamonds } from './training';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const docMock = vi.fn();
const runTransactionMock = vi.fn();
const incrementMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...args),
  runTransaction: (...args: unknown[]) => runTransactionMock(...args),
  increment: (...args: unknown[]) => incrementMock(...args),
}));

beforeEach(() => {
  docMock.mockReset();
  runTransactionMock.mockReset();
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
