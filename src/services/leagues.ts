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
import { formatInTimeZone } from 'date-fns-tz';

/** Uygulama ilk açıldığında en az bir lig olduğundan emin ol */
export async function ensureDefaultLeague(): Promise<void> {
  const snap = await getDocs(collection(db, 'leagues'));
  if (!snap.empty) return;
  // Yeni akış: boşsa 25×15 slot’lu aylık ligleri kurmayı dener
  try {
    const fn = httpsCallable(functions, 'bootstrapMonthlyLeaguesOneTime');
    await fn({});
  } catch (e) {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const region = import.meta.env.VITE_FUNCTIONS_REGION || 'europe-west1';
      const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
      const url = `https://${region}-${projectId}.cloudfunctions.net/bootstrapMonthlyLeaguesOneTimeHttp`;
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({}) });
    } catch {}
  }
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

// One-time bootstrap for monthly slot-based leagues
export async function requestBootstrap(): Promise<void> {
  try {
    const fn = httpsCallable(functions, 'bootstrapMonthlyLeaguesOneTime');
    await fn({});
    return;
  } catch (err: any) {
    const code: string | undefined = err?.code;
    // If it's an auth error, try HTTP with ID token explicitly
    const user = auth.currentUser;
    if (!user) throw err;
    const token = await user.getIdToken();
    const region = import.meta.env.VITE_FUNCTIONS_REGION || 'europe-west1';
    const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
    const url = `https://${region}-${projectId}.cloudfunctions.net/bootstrapMonthlyLeaguesOneTimeHttp`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: {} }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${text || '<no body>'}`);
    }
  }
}

// Assign current user's team to first available bot slot
export async function requestAssign(teamId: string): Promise<void> {
  if (!teamId) throw new Error('teamId required');
  try {
    const fn = httpsCallable(functions, 'assignRealTeamToFirstAvailableBotSlot');
    await fn({ teamId });
  } catch (err: any) {
    const user = auth.currentUser;
    if (!user) throw err;
    const token = await user.getIdToken();
    const region = import.meta.env.VITE_FUNCTIONS_REGION || 'europe-west1';
    const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
    const url = `https://${region}-${projectId}.cloudfunctions.net/assignRealTeamToFirstAvailableBotSlotHttp`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ teamId }),
    });
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

/** Test utility: Seçilen TR günündeki tüm maçları başlat (tüm ligler) */
export async function playAllForDay(
  dayKey?: string,
  opts?: { instant?: boolean }
): Promise<{ ok: boolean; started?: number; total?: number; dayKey?: string }> {
  const targetDay = dayKey || formatInTimeZone(new Date(), 'Europe/Istanbul', 'yyyy-MM-dd');
  const httpFirst = (import.meta as any).env?.VITE_USE_HTTP_FUNCTIONS === '1' || import.meta.env.DEV;
  const region = import.meta.env.VITE_FUNCTIONS_REGION || 'europe-west1';
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const httpUrl = `https://${region}-${projectId}.cloudfunctions.net/playAllForDayHttp`;
  const callFn = async () => {
    const fn = httpsCallable(functions, 'playAllForDayFn');
    const res: any = await fn({ dayKey: targetDay, force: true, instant: !!opts?.instant });
    return (res?.data as any) || { ok: true, dayKey: targetDay };
  };
  const callHttp = async () => {
    const user = auth.currentUser;
    const resp = await fetch(httpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${await user.getIdToken()}` } : {}) },
      body: JSON.stringify({ dayKey: targetDay, force: true, instant: !!opts?.instant }),
      mode: 'cors',
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${text || '<no body>'}`);
    }
    return await resp.json();
  };

  if (httpFirst) {
    try { return await callHttp(); } catch { /* fallback to callable */ }
    return await callFn();
  } else {
    try { return await callFn(); } catch { /* fallback to HTTP */ }
    return await callHttp();
  }
}

/** Test utility: En erken planlı fikstür gününü bul ve o günün tüm maçlarını başlat */
export async function playNextScheduledDay(): Promise<{ ok: boolean; dayKey?: string; started?: number; total?: number } | null> {
  // Find earliest fixture by date across leagues
  let snap;
  try {
    // Önce 'scheduled' filtreleyelim; index gerekirse aşağıdaki catch zaten fallback yapar
    const q = query(
      collectionGroup(db, 'fixtures'),
      where('status', '==', 'scheduled'),
      orderBy('date', 'asc'),
      limit(1)
    );
    snap = await getDocs(q);
  } catch {
    // Fallback: iterate leagues and take earliest
    const leagues = await getDocs(collection(db, 'leagues'));
    let earliest: { date: Date } | null = null;
    for (const lg of leagues.docs) {
      try {
        const s = await getDocs(
          query(
            collection(lg.ref, 'fixtures'),
            where('status', '==', 'scheduled'),
            orderBy('date', 'asc'),
            limit(1)
          )
        );
        if (!s.empty) {
          const d = (s.docs[0].data() as any)?.date?.toDate?.() as Date | undefined;
          if (d && (!earliest || d < earliest.date)) earliest = { date: d };
        }
      } catch {}
    }
    if (!earliest) return null;
    const dayKey = formatInTimeZone(earliest.date, 'Europe/Istanbul', 'yyyy-MM-dd');
    // İsteğe bağlı: bir sonraki gün hemen oynatılsın
    return await playAllForDay(dayKey, { instant: true });
  }
  if (snap.empty) return null;
  const d = (snap.docs[0].data() as any)?.date?.toDate?.() as Date | undefined;
  if (!d) return null;
  const dayKey = formatInTimeZone(d, 'Europe/Istanbul', 'yyyy-MM-dd');
  return await playAllForDay(dayKey, { instant: true });
}

/** Kullanıcının takımının hangi ligde olduğunu dinle */
export function listenMyLeague(teamId: string, cb: (league: League | null) => void): Unsubscribe {
  let unsubLeague: Unsubscribe | null = null;
  const tRef = doc(db, 'teams', teamId);
  const unsubTop = onSnapshot(tRef, (tSnap) => {
    const tData = tSnap.exists() ? (tSnap.data() as any) : null;
    const leagueId: string | undefined = tData?.leagueId;
    if (unsubLeague) { unsubLeague(); unsubLeague = null; }
    if (leagueId) {
      const lRef = doc(db, 'leagues', leagueId);
      unsubLeague = onSnapshot(lRef, (ls) => {
        if (!ls.exists()) { cb(null); return; }
        cb({ id: ls.id, ...(ls.data() as Omit<League, 'id'>) });
      });
      return;
    }
    // Fallback: eski şema (leagues/{id}/teams)
    const qLegacy = query(collectionGroup(db, 'teams'), where('teamId', '==', teamId), limit(1));
    const unsubLegacy = onSnapshot(qLegacy, (snap) => {
      if (unsubLeague) { unsubLeague(); unsubLeague = null; }
      if (snap.empty) { cb(null); return; }
      const leagueRef = snap.docs[0].ref.parent.parent!;
      unsubLeague = onSnapshot(leagueRef, (ls) => {
        if (!ls.exists()) { cb(null); return; }
        cb({ id: ls.id, ...(ls.data() as Omit<League, 'id'>) });
      });
    });
    // unsubLeague’ı legacy unsub ile kapatılabilir hale getir
    unsubLeague = () => { unsubLegacy(); };
  });
  return () => { if (unsubLeague) unsubLeague(); unsubTop(); };
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
        goalTimeline: raw.goalTimeline ?? [],
      } satisfies Fixture;
    });

  // İstemci tarafı tarih sıralaması: her zaman artan
  (list as { date: Date }[]).sort((a, b) => a.date.getTime() - b.date.getTime());

  return list;
}

/** Takımın bağlı olduğu ligin id'sini tek seferlik getir */
export async function getMyLeagueId(teamId: string): Promise<string | null> {
  // Prefer top-level teams/{teamId}.leagueId (slot-based flow)
  const teamDoc = await getDoc(doc(db, 'teams', teamId));
  const leagueIdTop: string | undefined = teamDoc.exists() ? (teamDoc.data() as any)?.leagueId : undefined;
  if (leagueIdTop) return leagueIdTop;
  // Fallback to legacy subcollection lookup
  const q = query(collectionGroup(db, 'teams'), where('teamId', '==', teamId), limit(1));
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
    goalTimeline: raw.goalTimeline ?? [],
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

// Slot-aware variant that falls back to slot mapping if participants query yields nothing
export async function getFixturesForTeamSlotAware(
  leagueId: string,
  teamId: string
): Promise<Fixture[]> {
  try {
    const base = await getFixturesForTeam(leagueId, teamId);
    if (base.length > 0) {
      const hasMissingTeamIds = base.some((fixture) => {
        const hasHome = typeof fixture.homeTeamId === 'string' && fixture.homeTeamId.trim().length > 0;
        const hasAway = typeof fixture.awayTeamId === 'string' && fixture.awayTeamId.trim().length > 0;
        return !hasHome || !hasAway;
      });
      if (!hasMissingTeamIds) {
        return base;
      }
    }
  } catch {}

  // Fallback: build via slots
  const slotsSnap = await getDocs(collection(db, 'leagues', leagueId, 'slots'));
  if (slotsSnap.empty) return [];
  const teamIdBySlot = new Map<number, string | null>();
  slotsSnap.docs.forEach((d) => {
    const s = d.data() as any;
    teamIdBySlot.set(s.slotIndex, s.teamId || null);
  });
  const fx = await getDocs(collection(db, 'leagues', leagueId, 'fixtures'));
  const list: Fixture[] = fx.docs
    .map((d) => {
      const raw = d.data() as any;
      const ts = raw.date as { toDate: () => Date };
      const homeTid = raw.homeTeamId || teamIdBySlot.get(raw.homeSlot) || `slot-${raw.homeSlot}`;
      const awayTid = raw.awayTeamId || teamIdBySlot.get(raw.awaySlot) || `slot-${raw.awaySlot}`;
      return {
        id: d.id,
        round: raw.round,
        date: ts.toDate(),
        homeTeamId: homeTid,
        awayTeamId: awayTid,
        participants: [homeTid, awayTid],
        status: raw.status,
        score: raw.score ?? null,
        replayPath: raw.replayPath,
        goalTimeline: raw.goalTimeline ?? [],
      } as Fixture;
    })
    .filter((m) => m.homeTeamId === teamId || m.awayTeamId === teamId)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return list;
}

/** Ligdeki takımları getir */
function needsHumanNameLookup(id: string, name?: string | null): boolean {
  if (!id || id.startsWith('slot-')) return false;
  const label = (name ?? '').trim();
  if (!label) return true;
  if (/^bot\b/i.test(label)) return false;
  if (/^slot\b/i.test(label)) return true;
  return label === id;
}

async function hydrateTeamNames(
  teams: { id: string; name: string }[]
): Promise<{ id: string; name: string }[]> {
  const lookupIds = Array.from(
    new Set(
      teams.filter((team) => needsHumanNameLookup(team.id, team.name)).map((team) => team.id)
    )
  );
  if (lookupIds.length === 0) return teams;

  const resolved = new Map<string, string>();
  await Promise.all(
    lookupIds.map(async (teamId) => {
      try {
        const snap = await getDoc(doc(db, 'teams', teamId));
        if (!snap.exists()) return;
        const data = snap.data() as { name?: string };
        const friendly = (data?.name ?? '').trim();
        if (friendly) {
          resolved.set(teamId, friendly);
        }
      } catch {
        // Silent: network/cache errors should not break fixtures view.
      }
    })
  );

  if (resolved.size === 0) return teams;
  return teams.map((team) => (resolved.has(team.id) ? { ...team, name: resolved.get(team.id)! } : team));
}

export async function getLeagueTeams(
  leagueId: string
): Promise<{ id: string; name: string }[]> {
  // Prefer standings for human-friendly names (works for slot-based)
  const standingsSnap = await getDocs(collection(db, 'leagues', leagueId, 'standings'));
  if (!standingsSnap.empty) {
    const rows: { id: string; name: string }[] = [];
    // Build both teamId -> name and slot-{i} -> name for lookups
    standingsSnap.docs.forEach((d) => {
      const s = d.data() as any;
      const name = s.name || s.teamId || `Slot ${s.slotIndex}`;
      const slotKey = `slot-${s.slotIndex}`;
      rows.push({ id: slotKey, name });
      if (s.teamId) rows.push({ id: s.teamId, name });
    });
    // De-duplicate by id preserving first occurrence
    const seen = new Set<string>();
    const deduped = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    return hydrateTeamNames(deduped);
  }

  // Legacy teams subcollection
  const teamsSnap = await getDocs(collection(db, 'leagues', leagueId, 'teams'));
  if (!teamsSnap.empty) {
    const legacy = teamsSnap.docs.map((d) => {
      const data = d.data() as { name?: string };
      return { id: d.id, name: data.name ?? d.id };
    });
    return hydrateTeamNames(legacy);
  }

  // Fallback to slots if standings/teams absent
  const slots = await getDocs(collection(db, 'leagues', leagueId, 'slots'));
  const slotList = slots.docs.map((d) => {
    const s = d.data() as any;
    return { id: s.teamId || `slot-${s.slotIndex}`, name: s.name || s.teamId || `Bot ${s.botId || s.slotIndex}` };
  });
  return hydrateTeamNames(slotList);
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
    const data = d.data() as any;
    const standingsSnap = await getDocs(collection(d.ref, 'standings'));
    let teams: { id: string; name: string }[] = [];
    let teamCount = 0;
    if (!standingsSnap.empty) {
      // Prefer standings for friendly names (works for human + bots)
      const rows = standingsSnap.docs.map((s) => s.data() as any);
      teams = rows.map((r) => ({ id: r.teamId || `slot-${r.slotIndex}`, name: r.name || r.teamId || `Slot ${r.slotIndex}` }));
      teamCount = rows.filter((r) => !!r.teamId).length;
    } else {
      const slotsSnap = await getDocs(collection(d.ref, 'slots'));
      if (!slotsSnap.empty) {
        teams = slotsSnap.docs.map((s) => {
          const sd = s.data() as any;
          if (sd.type === 'human' && sd.teamId) teamCount++;
          return { id: sd.teamId || `slot-${sd.slotIndex}`, name: sd.teamId || `Bot ${sd.botId || sd.slotIndex}` };
        });
      } else {
      const teamsSnap = await getDocs(collection(d.ref, 'teams'));
      teamCount = teamsSnap.size;
      teams = teamsSnap.docs.map((t) => {
        const td = t.data() as any;
        return { id: t.id, name: td.name || t.id };
      });
      }
    }
    leagues.push({
      id: d.id,
      name: data.name,
      season: data.season,
      capacity: data.capacity,
      timezone: data.timezone,
      state: data.state,
      startDate: data.startDate,
      rounds: data.rounds,
      teamCount,
      teams,
    } as League);
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

// Get league via top-level teams/{teamId}.leagueId (slot-based flow)
export async function getLeagueForTeam(teamId: string): Promise<{ leagueId: string | null }> {
  const d = await getDoc(doc(db, 'teams', teamId));
  if (!d.exists()) return { leagueId: null };
  const leagueId: string | undefined = (d.data() as any)?.leagueId;
  return { leagueId: leagueId || null };
}

export async function getLeagueSeasonId(leagueId: string): Promise<string | null> {
  if (!leagueId) return null;
  const snap = await getDoc(doc(db, 'leagues', leagueId));
  if (!snap.exists()) return null;
  const data = snap.data() as any;
  const season = data?.seasonId ?? data?.season;
  if (season === undefined || season === null) return null;
  return String(season);
}

// Resolve fixtures using slot map for a given slot index
export async function getFixturesByLeagueAndSlotMap(
  leagueId: string,
  mySlotIndex: number
): Promise<Array<Fixture & { opponentName: string; home: boolean }>> {
  const slotsSnap = await getDocs(collection(db, 'leagues', leagueId, 'slots'));
  const nameBySlot = new Map<number, string>();
  const teamIdBySlot = new Map<number, string | null>();
  slotsSnap.docs.forEach((d) => {
    const s = d.data() as any;
    const name = s.teamId || `Bot ${s.botId || s.slotIndex}`;
    nameBySlot.set(s.slotIndex, name);
    teamIdBySlot.set(s.slotIndex, s.teamId || null);
  });
  const fxSnap = await getDocs(collection(db, 'leagues', leagueId, 'fixtures'));
  const rows = fxSnap.docs
    .map((d) => {
      const raw = d.data() as any;
      const ts = raw.date as { toDate: () => Date };
      const home = raw.homeSlot === mySlotIndex;
      const oppSlot = home ? raw.awaySlot : raw.homeSlot;
      const homeTeamId = raw.homeTeamId || teamIdBySlot.get(raw.homeSlot) || null;
      const awayTeamId = raw.awayTeamId || teamIdBySlot.get(raw.awaySlot) || null;
      const result: Fixture & { opponentName: string; home: boolean } = {
        id: d.id,
        round: raw.round,
        date: ts.toDate(),
        homeTeamId: homeTeamId || `slot-${raw.homeSlot}`,
        awayTeamId: awayTeamId || `slot-${raw.awaySlot}`,
        participants: [homeTeamId, awayTeamId].filter(Boolean) as string[],
        status: raw.status,
        score: raw.score ?? null,
        replayPath: raw.replayPath,
        opponentName: nameBySlot.get(oppSlot) || `Slot ${oppSlot}`,
        home,
      };
      return result;
    })
    .filter((r) => r.home || r.awayTeamId === `slot-${mySlotIndex}` || r.homeTeamId === `slot-${mySlotIndex}` || r.participants.length === 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return rows;
}
export { buildChampionsLeagueTournament, buildConferenceLeagueTournament, fetchChampionsLeagueParticipants, buildKnockoutBracket } from './tournaments';
