import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generatedCandidate: {
    name: 'Test Aday',
    age: 18,
    position: 'MID',
    overall: 0.6,
    potential: 0.85,
    traits: [],
    attributes: {
      topSpeed: 0.7,
      shooting: 0.65,
    },
  },
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  docMock: vi.fn(),
  collectionMock: vi.fn(),
  queryMock: vi.fn(),
  whereMock: vi.fn(),
  orderByMock: vi.fn(),
  onSnapshotMock: vi.fn(),
  runTransactionMock: vi.fn(),
  fromDateMock: vi.fn(),
  incrementMock: vi.fn(),
  updateDocMock: vi.fn(),
  serverTimestampMock: vi.fn(),
  generateMockCandidateMock: vi.fn(),
  normalizeTeamPlayersMock: vi.fn(),
}));

vi.mock('./firebase', () => ({ db: {} }));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccessMock,
    error: mocks.toastErrorMock,
  },
}));

vi.mock('@/features/academy/generateMockCandidate', () => ({
  generateMockCandidate: mocks.generateMockCandidateMock,
}));

vi.mock('@/lib/playerVitals', () => ({
  normalizeTeamPlayers: mocks.normalizeTeamPlayersMock,
}));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mocks.docMock(...args),
  collection: (...args: unknown[]) => mocks.collectionMock(...args),
  query: (...args: unknown[]) => mocks.queryMock(...args),
  where: (...args: unknown[]) => mocks.whereMock(...args),
  orderBy: (...args: unknown[]) => mocks.orderByMock(...args),
  onSnapshot: (...args: unknown[]) => mocks.onSnapshotMock(...args),
  runTransaction: (...args: unknown[]) => mocks.runTransactionMock(...args),
  serverTimestamp: () => mocks.serverTimestampMock(),
  Timestamp: { fromDate: (...args: unknown[]) => mocks.fromDateMock(...args) },
  increment: (...args: unknown[]) => mocks.incrementMock(...args),
  updateDoc: (...args: unknown[]) => mocks.updateDocMock(...args),
}));

import {
  ACADEMY_COOLDOWN_MS,
  ACADEMY_RESET_DIAMOND_COST,
  acceptCandidate,
  listenPendingCandidates,
  pullNewCandidate,
  releaseCandidate,
  resetCooldownWithDiamonds,
} from './academy';

const buildRef = (path: string) => ({
  id: path.split('/').at(-1) ?? 'id',
  path,
});

const buildSnapshot = <T>(data: T | null) => ({
  exists: () => data !== null,
  data: () => data,
});

beforeEach(() => {
  vi.clearAllMocks();

  mocks.docMock.mockImplementation((...args: unknown[]) => {
    if (args.length === 1) {
      return buildRef('generated/candidate-generated');
    }
    const segments = args.slice(1).map(String);
    return buildRef(segments.join('/'));
  });

  mocks.collectionMock.mockImplementation((parent: unknown, ...segments: unknown[]) => {
    if (segments.length === 0 && parent && typeof parent === 'object' && 'path' in (parent as Record<string, unknown>)) {
      return { path: `${String((parent as { path: string }).path)}/subcollection` };
    }
    return { path: segments.map(String).join('/') };
  });

  mocks.queryMock.mockImplementation((source: unknown, ...constraints: unknown[]) => ({
    source,
    constraints,
  }));
  mocks.whereMock.mockImplementation((...args: unknown[]) => ({ type: 'where', args }));
  mocks.orderByMock.mockImplementation((...args: unknown[]) => ({ type: 'orderBy', args }));
  mocks.onSnapshotMock.mockImplementation((_query: unknown, _next: unknown, _error: unknown) => vi.fn());
  mocks.fromDateMock.mockImplementation((date: Date) => ({
    toDate: () => date,
    __date: date,
  }));
  mocks.incrementMock.mockImplementation((value: number) => ({ __increment: value }));
  mocks.serverTimestampMock.mockReturnValue({ __serverTimestamp: true });
  mocks.generateMockCandidateMock.mockReturnValue(mocks.generatedCandidate);
  mocks.normalizeTeamPlayersMock.mockImplementation((players: unknown) => players);
});

describe('listenPendingCandidates', () => {
  it('forwards permission errors to the async error callback', async () => {
    const listCallback = vi.fn();
    const errorCallback = vi.fn().mockResolvedValue(undefined);

    mocks.onSnapshotMock.mockImplementation(
      (_query: unknown, _next: unknown, onError?: (error: unknown) => void) => {
        onError?.({
          code: 'permission-denied',
          message: 'Missing or insufficient permissions.',
        });
        return vi.fn();
      },
    );

    listenPendingCandidates('uid', listCallback, errorCallback);
    await Promise.resolve();

    expect(listCallback).toHaveBeenCalledWith([]);
    expect(errorCallback).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'permission-denied' }),
    );
  });
});

describe('resetCooldownWithDiamonds', () => {
  it('uses the shared academy reset cost constant', async () => {
    mocks.runTransactionMock.mockImplementation(async (_db: unknown, fn: (tx: {
      get: (ref: unknown) => Promise<ReturnType<typeof buildSnapshot>>;
      update: ReturnType<typeof vi.fn>;
    }) => Promise<void>) => {
      await fn({
        get: async () => buildSnapshot({ diamondBalance: ACADEMY_RESET_DIAMOND_COST - 1 }),
        update: vi.fn(),
      });
    });

    await expect(resetCooldownWithDiamonds('uid')).rejects.toThrow('Yetersiz elmas');
    expect(mocks.incrementMock).not.toHaveBeenCalled();
  });
});

describe('pullNewCandidate', () => {
  it('throws if cooldown is still active', async () => {
    const future = new Date(Date.now() + 1000);

    mocks.runTransactionMock.mockImplementation(async (_db: unknown, fn: (tx: {
      get: (ref: unknown) => Promise<ReturnType<typeof buildSnapshot>>;
      set: ReturnType<typeof vi.fn>;
    }) => Promise<void>) => {
      await fn({
        get: async () => buildSnapshot({ academy: { nextPullAt: { toDate: () => future } } }),
        set: vi.fn(),
      });
    });

    await expect(pullNewCandidate('uid')).rejects.toThrow('2 saat beklemelisin');
  });

  it('sets next pull time two hours ahead', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    const setMock = vi.fn();

    mocks.runTransactionMock.mockImplementation(async (_db: unknown, fn: (tx: {
      get: (ref: unknown) => Promise<ReturnType<typeof buildSnapshot>>;
      set: typeof setMock;
    }) => Promise<void>) => {
      await fn({
        get: async () => buildSnapshot({}),
        set: setMock,
      });
    });

    await pullNewCandidate('uid');

    expect(mocks.fromDateMock).toHaveBeenCalled();
    const calls = mocks.fromDateMock.mock.calls;
    const calledDate = calls[calls.length - 1][0] as Date;
    expect(calledDate.getTime()).toBe(Date.now() + ACADEMY_COOLDOWN_MS);
    vi.useRealTimers();
  });
});

describe('acceptCandidate', () => {
  it('rejects candidates that are no longer pending', async () => {
    mocks.runTransactionMock.mockImplementation(async (_db: unknown, fn: (tx: {
      get: (ref: { path: string }) => Promise<ReturnType<typeof buildSnapshot>>;
      update: ReturnType<typeof vi.fn>;
    }) => Promise<void>) => {
      await fn({
        get: async (ref) => {
          if (ref.path.includes('academyCandidates')) {
            return buildSnapshot({
              status: 'accepted',
              player: mocks.generatedCandidate,
            });
          }
          return buildSnapshot({ players: [] });
        },
        update: vi.fn(),
      });
    });

    await expect(acceptCandidate('uid', 'cid')).rejects.toThrow('Bu aday zaten isleme alinmis.');
  });

  it('rejects duplicate players that are already in the team', async () => {
    mocks.runTransactionMock.mockImplementation(async (_db: unknown, fn: (tx: {
      get: (ref: { path: string }) => Promise<ReturnType<typeof buildSnapshot>>;
      update: ReturnType<typeof vi.fn>;
    }) => Promise<void>) => {
      await fn({
        get: async (ref) => {
          if (ref.path.includes('academyCandidates')) {
            return buildSnapshot({
              status: 'pending',
              player: mocks.generatedCandidate,
            });
          }
          return buildSnapshot({ players: [{ id: 'cid' }] });
        },
        update: vi.fn(),
      });
    });

    await expect(acceptCandidate('uid', 'cid')).rejects.toThrow('Oyuncu zaten takimda.');
  });

  it('writes the agreed salary once inside the transaction', async () => {
    const updateMock = vi.fn();

    mocks.runTransactionMock.mockImplementation(async (_db: unknown, fn: (tx: {
      get: (ref: { path: string }) => Promise<ReturnType<typeof buildSnapshot>>;
      update: typeof updateMock;
    }) => Promise<void>) => {
      await fn({
        get: async (ref) => {
          if (ref.path.includes('academyCandidates')) {
            return buildSnapshot({
              status: 'pending',
              player: mocks.generatedCandidate,
            });
          }
          return buildSnapshot({ players: [] });
        },
        update: updateMock,
      });
    });

    const player = await acceptCandidate('uid', 'cid-salary', { salary: 12345 });

    expect(player.contract?.salary).toBe(12345);
    expect(mocks.normalizeTeamPlayersMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ path: 'teams/uid' }),
      expect.objectContaining({
        players: [
          expect.objectContaining({
            id: 'cid-salary',
            contract: expect.objectContaining({ salary: 12345 }),
          }),
        ],
      }),
    );
    expect(updateMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ path: 'users/uid/academyCandidates/cid-salary' }),
      expect.objectContaining({ status: 'accepted' }),
    );
    expect(mocks.updateDocMock).not.toHaveBeenCalled();
  });
});

describe('releaseCandidate', () => {
  it('marks the candidate as released', async () => {
    await releaseCandidate('uid', 'cid2');
    expect(mocks.updateDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/uid/academyCandidates/cid2' }),
      { status: 'released' },
    );
  });
});
