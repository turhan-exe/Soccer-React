import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listLeagues, ensureDefaultLeague } from './leagues';

const { httpsCallableMock, bootstrapCallableMock } = vi.hoisted(() => ({
  httpsCallableMock: vi.fn(),
  bootstrapCallableMock: vi.fn(),
}));

vi.mock('./firebase', () => ({
  db: {},
  auth: { currentUser: null },
  functions: {},
}));

const {
  collectionMock,
  getDocsMock,
  addDocMock,
  queryMock,
  limitMock,
  serverTimestampMock,
} = vi.hoisted(() => ({
  collectionMock: vi.fn(),
  getDocsMock: vi.fn(),
  addDocMock: vi.fn(),
  queryMock: vi.fn((...parts: unknown[]) => ({ parts })),
  limitMock: vi.fn((value: number) => ({ limit: value })),
  serverTimestampMock: vi.fn(() => 'ts'),
}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => collectionMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  addDoc: (...args: unknown[]) => addDocMock(...args),
  query: (...args: unknown[]) => queryMock(...args),
  limit: (...args: unknown[]) => limitMock(...args),
  serverTimestamp: serverTimestampMock,
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => httpsCallableMock(...args),
}));

describe('listLeagues', () => {
  beforeEach(() => {
    collectionMock.mockClear();
    getDocsMock.mockReset();
    addDocMock.mockReset();
    queryMock.mockClear();
    limitMock.mockClear();
    httpsCallableMock.mockReset();
    bootstrapCallableMock.mockReset();
    httpsCallableMock.mockReturnValue(bootstrapCallableMock);
  });

  it('returns empty array when no leagues exist', async () => {
    getDocsMock.mockResolvedValueOnce({ docs: [] });
    const leagues = await listLeagues();
    expect(leagues).toEqual([]);
  });

  it('returns leagues quickly from metadata by default', async () => {
    const leagueDoc = {
      id: 'l1',
      data: () => ({ name: 'League 1', capacity: 16, season: 1, state: 'forming', teamCount: 17 }),
      ref: {},
    };

    getDocsMock.mockResolvedValueOnce({ docs: [leagueDoc] });
    const leagues = await listLeagues();

    expect(leagues.length).toBe(1);
    expect(leagues[0]).toMatchObject({
      id: 'l1',
      name: 'League 1',
      capacity: 16,
      season: 1,
      state: 'forming',
      teamCount: 16,
    });
    expect(leagues[0].teams).toEqual([]);
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });

  it('returns leagues with teams when detailed mode is requested', async () => {
    const leagueDoc = {
      id: 'l1',
      data: () => ({ name: 'League 1', capacity: 22, season: 1, state: 'forming' }),
      ref: {},
    };
    const standingsDocs = [
      { id: '1', data: () => ({ slotIndex: 1, teamId: 't1', name: 'Team 1' }) },
      { id: '2', data: () => ({ slotIndex: 2, teamId: 't2', name: 'Team 2' }) },
    ];

    getDocsMock
      .mockResolvedValueOnce({ docs: [leagueDoc] })
      .mockResolvedValueOnce({ empty: false, docs: standingsDocs })
      .mockResolvedValueOnce({ empty: true, docs: [] });

    const leagues = await listLeagues({ includeTeams: true });

    expect(leagues).toHaveLength(1);
    expect(leagues[0]).toMatchObject({
      id: 'l1',
      name: 'League 1',
      capacity: 22,
      season: 1,
      state: 'forming',
      teamCount: 2,
    });
    expect(leagues[0].teams).toEqual([
      { id: 't1', name: 'Team 1' },
      { id: 't2', name: 'Team 2' },
    ]);
  });
});

describe('ensureDefaultLeague', () => {
  beforeEach(() => {
    getDocsMock.mockReset();
    addDocMock.mockReset();
    queryMock.mockClear();
    limitMock.mockClear();
    httpsCallableMock.mockReset();
    bootstrapCallableMock.mockReset();
    httpsCallableMock.mockReturnValue(bootstrapCallableMock);
  });

  it('does nothing when leagues exist', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: false });
    await ensureDefaultLeague();
    expect(addDocMock).not.toHaveBeenCalled();
    expect(limitMock).toHaveBeenCalledWith(1);
    expect(queryMock).toHaveBeenCalled();
  });

  it('creates league when none exist', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: true });
    bootstrapCallableMock.mockResolvedValueOnce({ data: { ok: true } });
    await ensureDefaultLeague();
    expect(addDocMock).not.toHaveBeenCalled();
    expect(httpsCallableMock).toHaveBeenCalled();
    expect(bootstrapCallableMock).toHaveBeenCalledWith({});
  });
});
