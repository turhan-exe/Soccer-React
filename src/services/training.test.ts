import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addTrainingRecord,
  finishTrainingWithDiamonds,
  getTrainingHistory,
  TRAINING_FINISH_COST,
  TRAINING_HISTORY_STORAGE_LIMIT,
} from './training';

vi.mock('@/services/firebase', () => ({
  auth: { currentUser: null },
  db: {},
  functions: {},
}));
vi.mock('@/services/team', () => ({
  getTeam: vi.fn(),
  saveTeamPlayers: vi.fn(),
}));
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
  queryMock,
  whereMock,
  orderByMock,
  limitMock,
  writeBatchMock,
  onSnapshotMock,
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
  queryMock: vi.fn(),
  whereMock: vi.fn(),
  orderByMock: vi.fn(),
  limitMock: vi.fn(),
  writeBatchMock: vi.fn(),
  onSnapshotMock: vi.fn(),
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
  query: (...args: unknown[]) => queryMock(...args),
  where: (...args: unknown[]) => whereMock(...args),
  orderBy: (...args: unknown[]) => orderByMock(...args),
  limit: (...args: unknown[]) => limitMock(...args),
  writeBatch: (...args: unknown[]) => writeBatchMock(...args),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
  Timestamp: TimestampMock,
}));

beforeEach(() => {
  docMock.mockReset();
  runTransactionMock.mockReset();
  incrementMock.mockReset();
  setDocMock.mockReset();
  getDocMock.mockReset();
  deleteDocMock.mockReset();
  collectionMock.mockReset();
  addDocMock.mockReset();
  getDocsMock.mockReset();
  queryMock.mockReset();
  whereMock.mockReset();
  orderByMock.mockReset();
  limitMock.mockReset();
  writeBatchMock.mockReset();
  onSnapshotMock.mockReset();
});

describe('training history retention', () => {
  it('prunes records beyond the storage limit after adding a record', async () => {
    collectionMock.mockReturnValue('historyCol');
    addDocMock.mockResolvedValue({ id: 'new-record' });
    orderByMock.mockReturnValue('completedAtDesc');
    queryMock.mockReturnValue('pruneQuery');

    const docs = Array.from({ length: TRAINING_HISTORY_STORAGE_LIMIT + 2 }, (_, index) => ({
      ref: `record-${index}`,
    }));
    getDocsMock.mockResolvedValue({
      size: docs.length,
      docs,
    });

    const deleteMock = vi.fn();
    const commitMock = vi.fn().mockResolvedValue(undefined);
    writeBatchMock.mockReturnValue({
      delete: deleteMock,
      commit: commitMock,
    });

    await expect(
      addTrainingRecord('uid', {
        playerId: 'p1',
        playerName: 'Player 1',
        trainingId: 't1',
        trainingName: 'Training 1',
        result: 'medium',
        gain: 0.1,
        completedAt: { toMillis: () => 1_000 } as never,
      }),
    ).resolves.toBe('new-record');

    expect(orderByMock).toHaveBeenCalledWith('completedAt', 'desc');
    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteMock).toHaveBeenNthCalledWith(1, 'record-10');
    expect(deleteMock).toHaveBeenNthCalledWith(2, 'record-11');
    expect(commitMock).toHaveBeenCalledTimes(1);
  });

  it('loads only the newest records in descending order', async () => {
    collectionMock.mockReturnValue('historyCol');
    orderByMock.mockReturnValue('completedAtDesc');
    limitMock.mockReturnValue(`limit-${TRAINING_HISTORY_STORAGE_LIMIT}`);
    queryMock.mockReturnValue('historyQuery');
    getDocsMock.mockResolvedValue({
      docs: [
        {
          id: 'old',
          data: () => ({
            playerId: 'p-old',
            playerName: 'Old',
            trainingId: 't-old',
            trainingName: 'Old Training',
            result: 'low',
            gain: 0.05,
            completedAt: { toMillis: () => 1_000 },
          }),
        },
        {
          id: 'new',
          data: () => ({
            playerId: 'p-new',
            playerName: 'New',
            trainingId: 't-new',
            trainingName: 'New Training',
            result: 'high',
            gain: 0.2,
            completedAt: { toMillis: () => 2_000 },
          }),
        },
      ],
    });

    const records = await getTrainingHistory('uid');

    expect(limitMock).toHaveBeenCalledWith(TRAINING_HISTORY_STORAGE_LIMIT);
    expect(records.map((record) => record.id)).toEqual(['new', 'old']);
    expect(records[0].viewed).toBe(false);
  });
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
    await expect(
      finishTrainingWithDiamonds('uid', TRAINING_FINISH_COST),
    ).rejects.toThrow('Yetersiz elmas');
  });

  it('deducts diamonds and clears session', async () => {
    docMock.mockReturnValueOnce('userRef');
    docMock.mockReturnValueOnce('trainingRef');
    const updateMock = vi.fn();
    const deleteMock = vi.fn();
    const cost = TRAINING_FINISH_COST + 30;
    runTransactionMock.mockImplementationOnce(async (_db, fn) => {
      return await fn({
        get: async (ref: unknown) => {
          if (ref === 'userRef') {
            return { data: () => ({ diamondBalance: 200 }) };
          }
          return {
            exists: () => true,
            data: () => ({
              playerIds: ['p'],
              trainingIds: ['t'],
              startAt: {},
              durationSeconds: 600,
            }),
          };
        },
        update: updateMock,
        delete: deleteMock,
      });
    });
    await finishTrainingWithDiamonds('uid', cost);
    expect(incrementMock).toHaveBeenCalledWith(-cost);
    expect(updateMock).toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalled();
  });
});
