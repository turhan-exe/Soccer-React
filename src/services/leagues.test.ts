import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listLeagues } from './leagues';

vi.mock('./firebase', () => ({ db: {} }));

const collectionMock = vi.fn();
const getDocsMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => collectionMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
}));

describe('listLeagues', () => {
  beforeEach(() => {
    collectionMock.mockClear();
    getDocsMock.mockReset();
  });

  it('returns empty array when no leagues exist', async () => {
    getDocsMock.mockResolvedValueOnce({ docs: [] });
    const leagues = await listLeagues();
    expect(leagues).toEqual([]);
  });

  it('returns leagues with teams', async () => {
    const leagueDoc = {
      id: 'l1',
      data: () => ({ name: 'League 1', capacity: 22, season: 1, state: 'forming' }),
      ref: {},
    };
    const teamDocs = [
      { id: 't1', data: () => ({ name: 'Team 1' }) },
      { id: 't2', data: () => ({}) },
    ];
    getDocsMock
      .mockResolvedValueOnce({ docs: [leagueDoc] })
      .mockResolvedValueOnce({ docs: teamDocs, size: teamDocs.length });
    const leagues = await listLeagues();
    expect(leagues.length).toBe(1);
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
      { id: 't2', name: 't2' },
    ]);
  });
});
