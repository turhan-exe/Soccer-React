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

type StandingDoc = Standing & { slotIndex?: number | null };
type SlotDoc = {
  slotIndex?: number | null;
  botId?: string | null;
  teamId?: string | null;
  type?: 'human' | 'bot' | string | null;
};

const BOT_NAME_CACHE = new Map<string, string>();

function extractSlotIndex(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function fallbackBotName(slotIndex?: number, botId?: string | null): string {
  if (typeof slotIndex === 'number' && Number.isFinite(slotIndex)) {
    return `Bot ${slotIndex}`;
  }
  if (botId && botId.length > 0) {
    const trimmed = botId.replace(/^bot[-_]?/i, '').split(/[|_]/).filter(Boolean).pop();
    return trimmed ? `Bot ${trimmed}` : `Bot ${botId}`;
  }
  return 'Bot';
}

function getCachedBotName(botId?: string | null): string | undefined {
  if (!botId) return undefined;
  return BOT_NAME_CACHE.get(botId) ?? undefined;
}

async function ensureBotNames(botIds: string[]): Promise<void> {
  const missing = Array.from(
    new Set(botIds.filter((id): id is string => !!id && !BOT_NAME_CACHE.has(id)))
  );
  if (missing.length === 0) return;

  const chunkSize = 10;
  for (let i = 0; i < missing.length; i += chunkSize) {
    const chunk = missing.slice(i, i + chunkSize);
    const q = query(collection(db, 'bots'), where(documentId(), 'in', chunk));
    const snap = await getDocs(q);
    snap.docs.forEach((docSnap) => {
      const data = docSnap.data() as { name?: string | null };
      const friendly = data?.name?.trim();
      BOT_NAME_CACHE.set(
        docSnap.id,
        friendly && friendly.length > 0 ? friendly : fallbackBotName(undefined, docSnap.id)
      );
    });
    chunk.forEach((id) => {
      if (!BOT_NAME_CACHE.has(id)) {
        BOT_NAME_CACHE.set(id, fallbackBotName(undefined, id));
      }
    });
  }
}

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
    if (base.length > 0) return base;
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
      } as Fixture;
    })
    .filter((m) => m.homeTeamId === teamId || m.awayTeamId === teamId)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return list;
}

/** Ligdeki takımları getir */
export async function getLeagueTeams(
  leagueId: string
): Promise<{ id: string; name: string }[]> {
  const [standingsSnap, slotsSnap] = await Promise.all([
    getDocs(collection(db, 'leagues', leagueId, 'standings')),
    getDocs(collection(db, 'leagues', leagueId, 'slots')),
  ]);

  const slotMap = new Map<number, SlotDoc>();
  slotsSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() as SlotDoc;
    const slotIndex = extractSlotIndex(data.slotIndex ?? docSnap.id);
    if (slotIndex != null) {
      slotMap.set(slotIndex, { ...data, slotIndex });
    }
  });

  if (!standingsSnap.empty) {
    const docs = standingsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as StandingDoc) }));
    const botIds = new Set<string>();
    docs.forEach((row) => {
      if (row.teamId) return;
      const slotIndex = extractSlotIndex(row.slotIndex ?? row.id);
      if (slotIndex == null) return;
      const slot = slotMap.get(slotIndex);
      if (slot?.botId) botIds.add(slot.botId);
    });
    if (botIds.size > 0) {
      await ensureBotNames(Array.from(botIds));
    }

    const rows: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    docs.forEach((row) => {
      const slotIndex = extractSlotIndex(row.slotIndex ?? row.id);
      const slot = slotIndex != null ? slotMap.get(slotIndex) : undefined;
      const botId = slot?.botId ?? null;
      const baseName = row.teamId ? row.name || row.teamId : row.name;
      const displayName = row.teamId
        ? row.name || row.teamId
        : getCachedBotName(botId) ?? (baseName && !/bot[_-]/i.test(baseName) ? baseName : fallbackBotName(slotIndex, botId));
      const slotKey = slotIndex != null ? `slot-${slotIndex}` : row.id;
      const entries = [{ id: slotKey, name: displayName }];
      if (row.teamId) entries.push({ id: row.teamId, name: displayName });
      entries.forEach((entry) => {
        if (seen.has(entry.id)) return;
        seen.add(entry.id);
        rows.push(entry);
      });
    });
    return rows;
  }

  if (!slotsSnap.empty) {
    const slotDocs = slotsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as SlotDoc) }));
    const botIds = new Set<string>();
    slotDocs.forEach((slot) => {
      if (slot.botId) botIds.add(slot.botId);
    });
    if (botIds.size > 0) {
      await ensureBotNames(Array.from(botIds));
    }
    return slotDocs.map((slot) => {
      const slotIndex = extractSlotIndex(slot.slotIndex ?? slot.id);
      const botId = slot.botId ?? null;
      const name = slot.teamId
        ? slot.teamId
        : getCachedBotName(botId) ?? fallbackBotName(slotIndex, botId);
      const id = slot.teamId || `slot-${slotIndex ?? slot.id}`;
      return { id, name };
    });
  }

  const teamsSnap = await getDocs(collection(db, 'leagues', leagueId, 'teams'));
  if (!teamsSnap.empty) {
    return teamsSnap.docs.map((d) => {
      const data = d.data() as { name?: string };
      return { id: d.id, name: data.name ?? d.id };
    });
  }

  return [];
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

  return onSnapshot(col, async (snap) => {
    const rows: StandingDoc[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as StandingDoc),
    }));

    try {
      const slotsSnap = await getDocs(collection(db, 'leagues', leagueId, 'slots'));
      const slotMap = new Map<number, SlotDoc>();
      slotsSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as SlotDoc;
        const slotIndex = extractSlotIndex(data.slotIndex ?? docSnap.id);
        if (slotIndex != null) {
          slotMap.set(slotIndex, { ...data, slotIndex });
        }
      });

      const botIds = new Set<string>();
      rows.forEach((row) => {
        if (row.teamId) return;
        const slotIndex = extractSlotIndex(row.slotIndex ?? row.id);
        if (slotIndex == null) return;
        const slot = slotMap.get(slotIndex);
        if (slot?.botId) botIds.add(slot.botId);
      });
      if (botIds.size > 0) {
        await ensureBotNames(Array.from(botIds));
      }

      rows.forEach((row) => {
        if (row.teamId) {
          row.name = row.name || row.teamId;
          return;
        }
        const slotIndex = extractSlotIndex(row.slotIndex ?? row.id);
        const slot = slotIndex != null ? slotMap.get(slotIndex) : undefined;
        const botId = slot?.botId ?? null;
        const baseName = row.name;
        row.name = getCachedBotName(botId) ?? (baseName && !/bot[_-]/i.test(baseName) ? baseName : fallbackBotName(slotIndex, botId));
      });
    } catch (err) {
      console.warn('[leagues.listenStandings] Failed to enrich bot names', err);
    }

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
    const [standingsSnap, slotsSnap] = await Promise.all([
      getDocs(collection(d.ref, 'standings')),
      getDocs(collection(d.ref, 'slots')),
    ]);
    const slotMap = new Map<number, SlotDoc>();
    slotsSnap.docs.forEach((docSnap) => {
      const data = docSnap.data() as SlotDoc;
      const slotIndex = extractSlotIndex(data.slotIndex ?? docSnap.id);
      if (slotIndex != null) {
        slotMap.set(slotIndex, { ...data, slotIndex });
      }
    });

    let teams: { id: string; name: string }[] = [];
    let teamCount = 0;
    if (!standingsSnap.empty) {
      const rows = standingsSnap.docs.map((s) => ({ id: s.id, ...(s.data() as StandingDoc) }));
      const botIds = new Set<string>();
      rows.forEach((row) => {
        if (row.teamId) return;
        const slotIndex = extractSlotIndex(row.slotIndex ?? row.id);
        if (slotIndex == null) return;
        const slot = slotMap.get(slotIndex);
        if (slot?.botId) botIds.add(slot.botId);
      });
      if (botIds.size > 0) {
        await ensureBotNames(Array.from(botIds));
      }
      teams = rows.map((row) => {
        const slotIndex = extractSlotIndex(row.slotIndex ?? row.id);
        const slot = slotIndex != null ? slotMap.get(slotIndex) : undefined;
        const botId = slot?.botId ?? null;
        const baseName = row.teamId ? row.name || row.teamId : row.name;
        const name = row.teamId
          ? row.name || row.teamId
          : getCachedBotName(botId) ?? (baseName && !/bot[_-]/i.test(baseName) ? baseName : fallbackBotName(slotIndex, botId));
        const id = row.teamId || `slot-${slotIndex ?? row.id}`;
        return { id, name };
      });
      teamCount = rows.filter((r) => !!r.teamId).length;
    } else if (!slotsSnap.empty) {
      const slotDocs = slotsSnap.docs.map((s) => ({ id: s.id, ...(s.data() as SlotDoc) }));
      const botIds = new Set<string>();
      slotDocs.forEach((slot) => {
        if (slot.botId) botIds.add(slot.botId);
      });
      if (botIds.size > 0) {
        await ensureBotNames(Array.from(botIds));
      }
      teams = slotDocs.map((slot) => {
        const slotIndex = extractSlotIndex(slot.slotIndex ?? slot.id);
        const botId = slot.botId ?? null;
        if (slot.type === 'human' && slot.teamId) teamCount++;
        const name = slot.teamId
          ? slot.teamId
          : getCachedBotName(botId) ?? fallbackBotName(slotIndex, botId);
        const id = slot.teamId || `slot-${slotIndex ?? slot.id}`;
        return { id, name };
      });
    } else {
      const teamsSnap = await getDocs(collection(d.ref, 'teams'));
      teamCount = teamsSnap.size;
      teams = teamsSnap.docs.map((t) => {
        const td = t.data() as any;
        return { id: t.id, name: td.name || t.id };
      });
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
  const [snap, slotsSnap] = await Promise.all([
    getDocs(col),
    getDocs(collection(db, 'leagues', leagueId, 'slots')),
  ]);

  const rows: StandingDoc[] = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as StandingDoc),
  }));

  const slotMap = new Map<number, SlotDoc>();
  slotsSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() as SlotDoc;
    const slotIndex = extractSlotIndex(data.slotIndex ?? docSnap.id);
    if (slotIndex != null) {
      slotMap.set(slotIndex, { ...data, slotIndex });
    }
  });

  const botIds = new Set<string>();
  rows.forEach((row) => {
    if (row.teamId) return;
    const slotIndex = extractSlotIndex(row.slotIndex ?? row.id);
    if (slotIndex == null) return;
    const slot = slotMap.get(slotIndex);
    if (slot?.botId) botIds.add(slot.botId);
  });
  if (botIds.size > 0) {
    await ensureBotNames(Array.from(botIds));
  }

  rows.forEach((row) => {
    if (row.teamId) {
      row.name = row.name || row.teamId;
      return;
    }
    const slotIndex = extractSlotIndex(row.slotIndex ?? row.id);
    const slot = slotIndex != null ? slotMap.get(slotIndex) : undefined;
    const botId = slot?.botId ?? null;
    const baseName = row.name;
    row.name = getCachedBotName(botId) ?? (baseName && !/bot[_-]/i.test(baseName) ? baseName : fallbackBotName(slotIndex, botId));
  });

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
