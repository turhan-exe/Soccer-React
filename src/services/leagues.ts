// src/services/leagues.ts
import {
  collection,
  doc,
  getDoc,
  collectionGroup,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Unsubscribe,
  documentId,
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
    const region = import.meta.env.VITE_FUNCTIONS_REGION || 'europe-west1';
    const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
    const httpUrl = `https://${region}-${projectId}.cloudfunctions.net/assignTeamToLeagueHttp`;
    const resp = await fetch(
      httpUrl,
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

/** Eğer lig 'scheduled' ve fikstürleri yoksa, functions ile üretmeyi dener */
export async function ensureFixturesForLeague(leagueId: string): Promise<void> {
  const leagueSnap = await getDoc(doc(db, 'leagues', leagueId));
  if (!leagueSnap.exists()) return;
  const league = leagueSnap.data() as League;
  if (league.state !== 'scheduled' && league.state !== 'active') return;

  const fixturesRef = collection(db, 'leagues', leagueId, 'fixtures');
  const existing = await getDocs(query(fixturesRef, limit(1)));
  if (!existing.empty) return;

  try {
    const fn = httpsCallable(functions, 'generateRoundRobinFixturesFn');
    await fn({ leagueId });
  } catch (e) {
    // swallow; page will still render empty if it fails
    console.warn('[ensureFixturesForLeague] failed', e);
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
 * Index hazır değilse de sonuçlar her zaman istemcide tarihe göre sıralanır.
 */
export async function getFixturesForTeam(
  arg1: string,
  arg2?: string
): Promise<Fixture[]> {
  // Overload-like behavior
  // - If called as (leagueId, teamId), query the league's fixtures subcollection
  // - If called as (teamId), query collectionGroup('fixtures') across leagues
  let snap;
  if (arg2) {
    const leagueId = arg1;
    const teamId = arg2;
    const col = collection(db, 'leagues', leagueId, 'fixtures');
    try {
      const q = query(
        col,
        where('participants', 'array-contains', teamId),
        orderBy('date', 'asc')
      );
      snap = await getDocs(q);
    } catch {
      // Fallback if composite index not deployed yet
      const q = query(col, where('participants', 'array-contains', teamId));
      snap = await getDocs(q);
    }
  } else {
    const teamId = arg1;
    try {
      const q = query(
        collectionGroup(db, 'fixtures'),
        where('participants', 'array-contains', teamId),
        orderBy('date', 'asc')
      );
      snap = await getDocs(q);
    } catch {
      const q = query(
        collectionGroup(db, 'fixtures'),
        where('participants', 'array-contains', teamId)
      );
      snap = await getDocs(q);
    }
  }

  // Firestore Timestamp → Date dönüştür ve tarihe göre sırala (artan)
  const list: Fixture[] = snap.docs.map((d) => {
    const raw = d.data() as any;
    const ts = raw.date as { toDate: () => Date };
    return {
      id: d.id,
      round: raw.round,
      date: ts.toDate(),
      homeTeamId: raw.homeTeamId,
      awayTeamId: raw.awayTeamId,
      participants: raw.participants ?? [raw.homeTeamId, raw.awayTeamId],
      status: raw.status,
      score: raw.score ?? null,
      replayPath: raw.replayPath,
    } satisfies Fixture;
  });

  // İstemci tarafı tarih sıralaması: her zaman artan
  (list as { date: Date }[]).sort((a, b) => a.date.getTime() - b.date.getTime());

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

/**
 * Tek bir maç (fixture) dokümanını id'siyle bulur.
 * CollectionGroup('fixtures') üzerinde documentId() == matchId sorgusu yapar.
 * Dönüş: { fixture, leagueId } veya null
 */
export async function getFixtureByIdAcrossLeagues(
  matchId: string
): Promise<{ fixture: Fixture; leagueId: string } | null> {
  const q = query(collectionGroup(db, 'fixtures'), where(documentId(), '==', matchId), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  const raw: any = d.data();
  const ts = raw.date as { toDate: () => Date };
  const fixture: Fixture = {
    id: d.id,
    round: raw.round,
    date: ts.toDate(),
    homeTeamId: raw.homeTeamId,
    awayTeamId: raw.awayTeamId,
    participants: raw.participants ?? [raw.homeTeamId, raw.awayTeamId],
    status: raw.status,
    score: raw.score ?? null,
    replayPath: raw.replayPath,
  };
  // leagues/{leagueId}/fixtures/{matchId}
  const leagueId = d.ref.parent.parent!.id;
  return { fixture, leagueId };
}

/** Plan 2.5: Kullanıcının ligini getir (leagueId + teamId) */
export async function getMyLeague(
  teamId: string
): Promise<{ leagueId: string; teamId: string } | null> {
  const q = query(
    collectionGroup(db, 'teams'),
    where('teamId', '==', teamId),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const ref = snap.docs[0].ref.parent.parent!;
  return { leagueId: ref.id, teamId };
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
