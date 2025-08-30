// src/services/leagues.ts
import {
  collection,
  collectionGroup,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  limit,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from './firebase';
import type { League, Fixture, Standing } from '@/types';

/** Uygulama ilk açıldığında en az bir lig olduğundan emin ol */
export async function ensureDefaultLeague(): Promise<void> {
  const snap = await getDocs(collection(db, 'leagues'));
  if (!snap.empty) return;
  await addDoc(collection(db, 'leagues'), {
    name: 'League 1',
    season: 1,
    capacity: 22,
    timezone: 'Europe/Istanbul',
    state: 'forming',
    rounds: 0,
    teamCount: 0,
    createdAt: serverTimestamp(),
  });
}

/** Takımı bir lige yerleştirmek için callable'ı kullan; gerekirse HTTP fallback */
export async function requestJoinLeague(teamId: string): Promise<void> {
  if (!teamId) throw new Error('teamId required');

  try {
    const fn = httpsCallable(functions, 'assignTeamToLeague');
    await fn({ teamId });
    return;
  } catch (err: any) {
    // Callable failed. Decide whether to fall back to HTTP based on error code.
    const code: string | undefined = err?.code;
    const message: string = err?.message || 'Callable error';

    // Do NOT fallback for client/input/permission errors — surface them.
    const nonRetryable = new Set([
      'functions/invalid-argument',
      'functions/unauthenticated',
      'functions/permission-denied',
      'functions/not-found',
    ]);
    const shouldSurface = code && nonRetryable.has(code);

    if (shouldSurface) {
      throw new Error(message);
    }

    // Fallback for INTERNAL/UNAVAILABLE/UNKNOWN or non-functions failures
    console.warn(
      '[leagues.requestJoinLeague] Callable failed, trying HTTP fallback:',
      { code, message }
    );

    const user = auth.currentUser;
    if (!user) throw err;

    const token = await user.getIdToken();
    const resp = await fetch(
      'https://us-central1-osm-react.cloudfunctions.net/assignTeamToLeagueHttp',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ teamId }),
      }
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${text || '<no body>'}`);
    }
  }
}

/** Kullanıcının takımının hangi ligde olduğunu dinle */
export function listenMyLeague(
  teamId: string,
  cb: (league: League | null) => void
): Unsubscribe {
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

/**
 * Bir takımın fikstürlerini getir.
 * NOT: array-contains + orderBy('date') kompozit index ister.
 * Index zorunluluğunu kaldırmak için tarih sıralamasını istemcide yapıyoruz.
 */
export async function getFixturesForTeam(
  leagueId: string,
  teamId: string
): Promise<Fixture[]> {
  const col = collection(db, 'leagues', leagueId, 'fixtures');
  const q = query(col, where('participants', 'array-contains', teamId));
  const snap = await getDocs(q);

  const list: Fixture[] = snap.docs.map((d) => {
    const data = d.data() as { date: { toDate: () => Date } } & Omit<
      Fixture,
      'id' | 'date'
    >;
    return { id: d.id, ...data, date: data.date.toDate() } as Fixture;
  });

  // Tarihe göre artan sırada
  list.sort((a, b) => (a.date as Date).getTime() - (b.date as Date).getTime());
  return list;
}

/** Takımın bağlı olduğu ligin id'sini tek seferlik getir */
export async function getMyLeagueId(teamId: string): Promise<string | null> {
  const q = query(
    collectionGroup(db, 'teams'),
    where('teamId', '==', teamId),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].ref.parent.parent!.id;
}

/** Ligdeki takımları getir */
export async function getLeagueTeams(
  leagueId: string
): Promise<{ id: string; name: string }[]> {
  const snap = await getDocs(collection(db, 'leagues', leagueId, 'teams'));
  return snap.docs.map((d) => {
    const data = d.data() as { name?: string };
    return { id: d.id, name: data.name ?? d.id };
  });
}

/**
 * Puan durumu dinleyicisi.
 * NOT: Birden çok orderBy kompozit index ister; bu yüzden
 * Firestore’dan düz çekip (opsiyonel tek bir orderBy yerine)
 * istemcide Pts → GD → GF sıralıyoruz.
 */
export function listenStandings(
  leagueId: string,
  cb: (rows: Standing[]) => void
): Unsubscribe {
  const col = collection(db, 'leagues', leagueId, 'standings');

  return onSnapshot(col, (snap) => {
    const rows: Standing[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Standing, 'id'>),
    }));

    rows.sort((a, b) => {
      // Pts desc, sonra GD desc, sonra GF desc
      if (b.Pts !== a.Pts) return b.Pts - a.Pts;
      if (b.GD !== a.GD) return b.GD - a.GD;
      return b.GF - a.GF;
    });

    cb(rows);
  });
}

/** Lig listesini (takımlarla birlikte) getir */
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

/** Puan durumunu tek seferlik getir (istemcide sıralama) */
export async function listLeagueStandings(
  leagueId: string
): Promise<Standing[]> {
  const col = collection(db, 'leagues', leagueId, 'standings');
  const snap = await getDocs(col);

  const rows: Standing[] = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Standing, 'id'>),
  }));

  rows.sort((a, b) => {
    if (b.Pts !== a.Pts) return b.Pts - a.Pts;
    if (b.GD !== a.GD) return b.GD - a.GD;
    return b.GF - a.GF;
  });

  return rows;
}
