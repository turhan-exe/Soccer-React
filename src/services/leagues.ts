import {
  collection,
  collectionGroup,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
  Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
import type { League, Fixture, Standing } from '@/types';

export async function requestJoinLeague(teamId: string) {
  const fn = httpsCallable(functions, 'assignTeamToLeague');
  const res = await fn({ teamId });
  return res.data as { leagueId: string; state: string };
}

export function listenMyLeague(teamId: string, cb: (league: League | null) => void): Unsubscribe {
  const teamsQ = query(
    collectionGroup(db, 'teams'),
    where('teamId', '==', teamId),
    limit(1)
  );
  let unsubLeague: Unsubscribe | null = null;
  const unsubTeams = onSnapshot(teamsQ, (snap) => {
    if (unsubLeague) unsubLeague();
    if (snap.empty) {
      cb(null);
      return;
    }
    const leagueRef = snap.docs[0].ref.parent.parent!;
    unsubLeague = onSnapshot(leagueRef, (ls) => {
      cb({ id: ls.id, ...(ls.data() as Omit<League, 'id'>) });
    });
  });
  return () => {
    if (unsubLeague) unsubLeague();
    unsubTeams();
  };
}

export async function getFixturesForTeam(leagueId: string, teamId: string): Promise<Fixture[]> {
  const col = collection(db, 'leagues', leagueId, 'fixtures');
  const q = query(col, where('participants', 'array-contains', teamId), orderBy('date'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Fixture, 'id'>) }));
}

export function listenStandings(leagueId: string, cb: (rows: Standing[]) => void): Unsubscribe {
  const col = collection(db, 'leagues', leagueId, 'standings');
  const q = query(col, orderBy('Pts', 'desc'), orderBy('GD', 'desc'), orderBy('GF', 'desc'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Standing, 'id'>) })));
  });
}

export async function listLeagues(): Promise<League[]> {
  const snap = await getDocs(collection(db, 'leagues'));
  const leagues: League[] = [];
  for (const d of snap.docs) {
    const teams = await getDocs(collection(d.ref, 'teams'));
    leagues.push({
      id: d.id,
      teamCount: teams.size,
      ...(d.data() as Omit<League, 'id' | 'teamCount'>),
    });
  }
  return leagues;
}

export async function listLeagueStandings(leagueId: string): Promise<Standing[]> {
  const col = collection(db, 'leagues', leagueId, 'standings');
  const q = query(col, orderBy('Pts', 'desc'), orderBy('GD', 'desc'), orderBy('GF', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Standing, 'id'>) }));
}
