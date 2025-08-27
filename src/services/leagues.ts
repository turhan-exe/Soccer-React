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

export async function requestJoinLeague(teamId: string): Promise<void> {
  const fn = httpsCallable(functions, 'assignTeamToLeague');
  await fn({ teamId });
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
  return snap.docs.map((d) => {
    const data = d.data() as any;
    return { id: d.id, ...data, date: data.date.toDate() } as Fixture;
  });
}

export async function getMyLeagueId(teamId: string): Promise<string | null> {
  const q = query(
    collectionGroup(db, 'teams'),
    where('teamId', '==', teamId),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].ref.parent.parent!.id;
}

export async function getLeagueTeams(
  leagueId: string,
): Promise<{ id: string; name: string }[]> {
  const snap = await getDocs(collection(db, 'leagues', leagueId, 'teams'));
  return snap.docs.map((d) => {
    const data = d.data() as { name?: string };
    return { id: d.id, name: data.name ?? d.id };
  });
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
    const teamsSnap = await getDocs(collection(d.ref, 'teams'));
    const teams = teamsSnap.docs.map((t) => {
      const data = t.data() as { name?: string };
      return { id: t.id, name: data.name ?? t.id };
    });
    const leagueData = d.data() as Omit<
      League,
      'id' | 'teamCount' | 'teams'
    > & { teamCount?: number };
    leagues.push({
      id: d.id,
      teamCount: leagueData.teamCount ?? teamsSnap.size,
      teams,
      ...leagueData,
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
