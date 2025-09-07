import * as functions from 'firebase-functions/v1';
import { requireAppCheck, requireAuth } from './mw/auth.js';
import { generateRoundRobinFixtures, nextDay19TR } from './utils/schedule.js';
import './_firebase.js';
import {
  getFirestore,
  FieldValue,
  Timestamp,
  DocumentReference,
  Transaction,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const db = getFirestore();
const ADMIN_SECRET = (functions.config() as any)?.admin?.secret || '';

/**
 * Core logic for assigning a team to a league. Ensures a team is only placed
 * into one league and that a new league is created when none are available.
 * When the league reaches 22 teams, it is scheduled and fixtures are created.
 */
export async function assignTeam(
  teamId: string,
  teamName: string,
  ownerUid?: string
) {
  functions.logger.info('[ASSIGN] Başladı', { teamId, teamName });
  const t0 = Date.now();
  // Capture a league we may finalize inside the TX so we can create fixtures after
  let finalizedToScheduleOuter: { leagueId: string; startDate: Date } | null = null;

  const leagueRef = await db.runTransaction(async (tx) => {
    functions.logger.info('[ASSIGN:TXX] Transaction başladı', { teamId });
    // 1) Team already in a league? If so, return that league.
    const existing = await tx.get(
      db.collectionGroup('teams').where('teamId', '==', teamId).limit(1)
    );
    if (!existing.empty) {
      const ref = existing.docs[0].ref.parent.parent!;
      functions.logger.info('[ASSIGN:TXX] Zaten ligde bulundu', { teamId, leagueId: ref.id });
      return ref;
    }

    // Helper to create new forming league data (defer write until after reads)
    const prepareNewFormingLeague = async () => {
      const newLeagueRef = db.collection('leagues').doc();
      const last = await tx.get(
        db.collection('leagues').orderBy('season', 'desc').limit(1)
      );
      const nextSeason = last.empty
        ? 1
        : ((last.docs[0].data() as any).season || 0) + 1;
      const newLeagueData = {
        name: `League ${nextSeason}`,
        season: nextSeason,
        capacity: 22,
        timezone: 'Europe/Istanbul',
        state: 'forming' as const,
        rounds: 21,
        teamCount: 0,
        createdAt: FieldValue.serverTimestamp(),
      };
      return { newLeagueRef, newLeagueData };
    };

    // 2) Find an open forming league; if the oldest forming is full, finalize it and create a new one.
    let chosenLeagueRef: DocumentReference | null = null;
    let chosenLeagueData: any | null = null;
    // Defer writes until after all reads to satisfy Firestore TX rules
    let finalizeOldForming: { ref: DocumentReference; startDate: Date } | null = null;
    let pendingNewLeague: { ref: DocumentReference; data: any } | null = null;

    // Prefer indexed query (state + createdAt). If index is missing in the
    // target project, fall back to a simpler query to avoid 500s in prod.
    let formingSnap;
    try {
      formingSnap = await tx.get(
        db
          .collection('leagues')
          .where('state', '==', 'forming')
          .orderBy('createdAt', 'asc')
          .limit(1)
      );
    } catch (e: any) {
      functions.logger.warn('[ASSIGN:TXX] Missing index for state+createdAt; using fallback without orderBy', {
        error: e?.message,
      });
      formingSnap = await tx.get(
        db
          .collection('leagues')
          .where('state', '==', 'forming')
          .limit(1)
      );
    }

    if (formingSnap.empty) {
      functions.logger.info('[ASSIGN:TXX] Uygun forming lig yok, yenisi oluşturuluyor');
      const { newLeagueRef, newLeagueData } = await prepareNewFormingLeague();
      // Do not write yet; just remember to create it later
      pendingNewLeague = { ref: newLeagueRef, data: newLeagueData };
      chosenLeagueRef = newLeagueRef;
      chosenLeagueData = { teamCount: 0, capacity: 22 };
    } else {
      const doc = formingSnap.docs[0];
      const data = doc.data() as any;
      const capacity = data.capacity ?? 22;
      const count = data.teamCount ?? 0;
      if (count >= capacity) {
        // Mark this forming league to be finalized and create a new one
        functions.logger.info('[ASSIGN:TXX] İlk forming lig dolu, finalize edilecek', {
          leagueId: doc.id,
          count,
          capacity,
        });
        const startDate = nextDay19TR();
        finalizeOldForming = { ref: doc.ref, startDate };
        const { newLeagueRef, newLeagueData } = await prepareNewFormingLeague();
        pendingNewLeague = { ref: newLeagueRef, data: newLeagueData };
        chosenLeagueRef = newLeagueRef;
        chosenLeagueData = { teamCount: 0, capacity: 22 };
      } else {
        chosenLeagueRef = doc.ref;
        chosenLeagueData = data;
      }
    }

    // 3) Assign team into chosen league (respect capacity in case of retry/concurrency).
    const capacity = chosenLeagueData!.capacity ?? 22;
    const currentCount = chosenLeagueData!.teamCount ?? 0;

    // Double-check team doc doesn't exist under this league (idempotency on retries)
    const teamDocRef = chosenLeagueRef!.collection('teams').doc(teamId);
    const teamDocSnap = await tx.get(teamDocRef);
    if (!teamDocSnap.exists) {
      if (currentCount >= capacity) {
        // Capacity reached in between reads; transaction will retry and pick another league
        functions.logger.warn('[ASSIGN:TXX] Kapasite eşik aşıldı, retry');
        throw new Error('Capacity reached, retry');
      }
      functions.logger.info('[ASSIGN:TXX] Takım lige ekleniyor', {
        teamId,
        leagueId: chosenLeagueRef!.id,
        beforeCount: currentCount,
      });
      // Perform deferred writes first (finalize old forming / create new league)
      if (finalizeOldForming) {
        tx.update(finalizeOldForming.ref, {
          state: 'scheduled',
          startDate: Timestamp.fromDate(finalizeOldForming.startDate),
          lockedAt: FieldValue.serverTimestamp(),
          rounds: 21,
        });
        finalizedToScheduleOuter = {
          leagueId: finalizeOldForming.ref.id,
          startDate: finalizeOldForming.startDate,
        };
      }
      if (pendingNewLeague) {
        tx.set(pendingNewLeague.ref, pendingNewLeague.data);
      }
      const teamDoc: any = {
        teamId,
        name: teamName,
        joinedAt: FieldValue.serverTimestamp(),
      };
      if (ownerUid) teamDoc.ownerUid = ownerUid;
      tx.set(teamDocRef, teamDoc);
      // Initialize standings row with zeros so UI can list teams immediately
      const standingsRef = chosenLeagueRef!.collection('standings').doc(teamId);
      tx.set(
        standingsRef,
        {
          teamId,
          name: teamName,
          P: 0,
          W: 0,
          D: 0,
          L: 0,
          GF: 0,
          GA: 0,
          GD: 0,
          Pts: 0,
        },
        { merge: true }
      );
      const newCount = currentCount + 1;
      // Loosen typing here to avoid dependency/type resolution issues in UI env
      const updateData: any = {
        teamCount: newCount,
        // Also mirror teams under league doc as an array for quick reads
        teams: FieldValue.arrayUnion({ id: teamId, name: teamName }),
      };
      if (newCount === capacity) {
        const startDate = nextDay19TR();
        updateData.state = 'scheduled';
        updateData.startDate = Timestamp.fromDate(startDate);
        updateData.lockedAt = FieldValue.serverTimestamp();
        updateData.rounds = 21;
        functions.logger.info('[ASSIGN:TXX] Kapasite tamamlandı, lig schedule edildi', {
          leagueId: chosenLeagueRef!.id,
          startDate: updateData.startDate,
        });
      }
      tx.update(chosenLeagueRef!, updateData);
    } else {
      functions.logger.info('[ASSIGN:TXX] Takım zaten lig altında var (idempotent)');
    }

    return chosenLeagueRef!;
  });

  const leagueSnap = await leagueRef.get();
  const leagueData = leagueSnap.data() as any;
  functions.logger.info('[ASSIGN] Transaction bitti', {
    leagueId: leagueRef.id,
    state: leagueData.state,
    ms: Date.now() - t0,
  });
  // If we finalized a full league that wasn't the one we returned, generate fixtures for it now
  if (finalizedToScheduleOuter) {
    const { leagueId: finId, startDate: finStart } = finalizedToScheduleOuter;
    const finRef = db.collection('leagues').doc(finId);
    const hasFixtures = await finRef.collection('fixtures').limit(1).get();
    if (hasFixtures.empty) {
      functions.logger.info('[ASSIGN] Finalize edilen lig için fikstür üretimi', { leagueId: finId });
      await generateFixturesForLeague(finId, finStart);
    }
  }
  if (leagueData.state === 'scheduled') {
    const startDate: Date = leagueData.startDate.toDate();
    const fixturesSnap = await leagueRef.collection('fixtures').limit(1).get();
    if (fixturesSnap.empty) {
      functions.logger.info('[ASSIGN] Fikstür üretimi başlıyor', {
        leagueId: leagueRef.id,
      });
      await generateFixturesForLeague(leagueRef.id, startDate);
      functions.logger.info('[ASSIGN] Fikstür üretimi bitti', { leagueId: leagueRef.id });
    }
  }
  functions.logger.info('[ASSIGN] Bitti', {
    leagueId: leagueRef.id,
    state: leagueData.state,
  });
  return { leagueRef, state: leagueData.state };
}

export const assignTeamToLeague = functions.region('europe-west1').https.onCall(async (request) => {
  functions.logger.info('[CALLABLE] assignTeamToLeague: Fonksiyon çağrıldı', {
    hasAuth: !!request.auth,
  });
  // Security: enforce App Check + Auth
  requireAppCheck(request as any);
  const uid = request.auth?.uid;
  if (!uid) {
    functions.logger.warn('[CALLABLE] Auth yok');
    throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  }
  const teamId: string = (request.data as any).teamId;
  if (!teamId) {
    functions.logger.warn('[CALLABLE] teamId eksik');
    throw new functions.https.HttpsError('invalid-argument', 'teamId required');
  }
  const teamSnap = await db.collection('teams').doc(teamId).get();
  if (!teamSnap.exists) {
    functions.logger.warn('[CALLABLE] Takım bulunamadı', { teamId });
    throw new functions.https.HttpsError('not-found', 'Team not found');
  }
  const teamData = teamSnap.data() as any;
  if (teamData.ownerUid && teamData.ownerUid !== uid) {
    functions.logger.warn('[CALLABLE] Sahiplik uyumsuz', { teamId, uid });
    throw new functions.https.HttpsError('permission-denied', 'Not owner');
  }
  functions.logger.info('[CALLABLE] Atama başlıyor', { teamId });
  const { leagueRef, state } = await assignTeam(
    teamId,
    teamData.name || `Team ${teamId}`,
    uid
  );
  functions.logger.info('[CALLABLE] Atama bitti', { leagueId: leagueRef.id, state });
  return { leagueId: leagueRef.id, state };
});

export const assignAllTeamsToLeagues = functions.region('europe-west1').https.onRequest(async (req, res) => {
  // Admin-only via bearer secret
  const authz = (req.headers.authorization as string) || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
    res.status(401).send('unauthorized');
    return;
  }
  functions.logger.info('[HTTP] assignAllTeamsToLeagues: Çağrıldı');
  const snap = await db.collection('teams').get();
  functions.logger.info('[HTTP] assignAllTeamsToLeagues: Takımlar çekildi', { count: snap.size });
  const results: { teamId: string; leagueId: string; state: string }[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as any;
    functions.logger.info('[HTTP] Tekil atama başlıyor', { teamId: doc.id });
    const { leagueRef, state } = await assignTeam(
      doc.id,
      data.name || `Team ${doc.id}`,
      (data as any).ownerUid
    );
    functions.logger.info('[HTTP] Tekil atama bitti', { teamId: doc.id, leagueId: leagueRef.id, state });
    results.push({ teamId: doc.id, leagueId: leagueRef.id, state });
  }
  functions.logger.info('[HTTP] assignAllTeamsToLeagues: Tamamlandı', { assigned: results.length });
  res.json({ assigned: results.length, details: results });
});

// Optional HTTP version with CORS for direct fetch() callers in dev
export const assignTeamToLeagueHttp = functions.region('europe-west1').https.onRequest(async (req, res) => {
  functions.logger.info('[HTTP] assignTeamToLeagueHttp: Çağrıldı', {
    method: req.method,
    origin: req.headers.origin,
  });
  // CORS headers (adjust allowed origins as needed)
  const origin = (req.headers.origin as string | undefined) ?? '';
  const allowedOrigins = new Set<string>([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
  ]);
  if (origin && allowedOrigins.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  } else {
    // Safe fallback for dev/testing
    res.set('Access-Control-Allow-Origin', '*');
  }
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');
  res.set('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    functions.logger.info('[HTTP] assignTeamToLeagueHttp: Preflight (OPTIONS)');
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    functions.logger.warn('[HTTP] assignTeamToLeagueHttp: Method Not Allowed', { method: req.method });
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.substring('Bearer '.length)
      : undefined;
    if (!token) {
      functions.logger.warn('[HTTP] assignTeamToLeagueHttp: Token eksik');
      res.status(401).json({ error: 'Missing Authorization bearer token' });
      return;
    }
    const decoded = await getAuth().verifyIdToken(token);
    const uid = decoded.uid;

    const { teamId } = (req.body ?? {}) as { teamId?: string };
    if (!teamId) {
      functions.logger.warn('[HTTP] assignTeamToLeagueHttp: teamId eksik');
      res.status(400).json({ error: 'teamId required' });
      return;
    }
    const teamSnap = await db.collection('teams').doc(teamId).get();
    if (!teamSnap.exists) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    const teamData = teamSnap.data() as any;
    if (teamData.ownerUid && teamData.ownerUid !== uid) {
      functions.logger.warn('[HTTP] assignTeamToLeagueHttp: Sahiplik uyumsuz', { teamId, uid });
      res.status(403).json({ error: 'Not owner' });
      return;
    }
    functions.logger.info('[HTTP] assignTeamToLeagueHttp: Atama başlıyor', { teamId });
    const { leagueRef, state } = await assignTeam(
      teamId,
      teamData.name || `Team ${teamId}`,
      uid
    );
    functions.logger.info('[HTTP] assignTeamToLeagueHttp: Atama bitti', { leagueId: leagueRef.id, state });
    res.json({ leagueId: leagueRef.id, state });
  } catch (e) {
    functions.logger.error('[HTTP] assignTeamToLeagueHttp hata', e as any);
    res.status(500).json({ error: 'internal' });
  }
});

async function generateFixturesForLeague(leagueId: string, startDate: Date) {
  functions.logger.info('[FIXTURE] Üretim başladı', { leagueId, startDate: startDate.toISOString() });
  const leagueRef = db.collection('leagues').doc(leagueId);
  const teamsSnap = await leagueRef.collection('teams').get();
  const teamIds = teamsSnap.docs.map((d) => d.id);
  const fixtures = generateRoundRobinFixtures(teamIds);
  const batch = db.batch();
  fixtures.forEach((m) => {
    const date = new Date(startDate.getTime());
    date.setUTCDate(date.getUTCDate() + (m.round - 1));
    const ref = leagueRef.collection('fixtures').doc();
    batch.set(ref, {
      round: m.round,
      date: Timestamp.fromDate(date),
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      participants: [m.homeTeamId, m.awayTeamId],
      status: 'scheduled',
      score: null,
    });
  });
  await batch.commit();
  functions.logger.info('[FIXTURE] Üretim bitti', { leagueId, total: fixtures.length });
}

export const generateRoundRobinFixturesFn = functions.region('europe-west1').https.onCall(async (request) => {
  requireAppCheck(request as any);
  requireAuth(request as any);
  const leagueId = (request.data as any)?.leagueId as string | undefined;
  const force = Boolean((request.data as any)?.force);
  functions.logger.info('[CALLABLE] generateRoundRobinFixturesFn çağrıldı', { leagueId, force });
  if (!leagueId) {
    throw new functions.https.HttpsError('invalid-argument', 'leagueId required');
  }
  const leagueRef = db.collection('leagues').doc(leagueId);
  const leagueSnap = await leagueRef.get();
  if (!leagueSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'League not found');
  }
  const league = leagueSnap.data() as any;
  const existing = await leagueRef.collection('fixtures').limit(1).get();
  if (!existing.empty && !force) {
    functions.logger.info('[CALLABLE] generateRoundRobinFixturesFn: Zaten mevcut, atlandı', { leagueId });
    return { ok: true, skipped: true };
  }
  // If forcing, delete all existing fixtures first
  if (force && !existing.empty) {
    const all = await leagueRef.collection('fixtures').get();
    let deleted = 0;
    let batch = db.batch();
    let ops = 0;
    for (const d of all.docs) {
      batch.delete(d.ref);
      ops++;
      deleted++;
      if (ops >= 450) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    if (ops > 0) {
      await batch.commit();
    }
    functions.logger.info('[CALLABLE] generateRoundRobinFixturesFn: Eski fikstürler silindi', { leagueId, deleted });
  }
  // Force modunda başlangıç gününü güvenli şekilde bugün+1 19:00 TR al
  // Aksi halde ligdeki mevcut startDate değerini kullan
  const startDateSafe = force
    ? nextDay19TR()
    : ((league.startDate as any)?.toDate?.() || nextDay19TR());
  await generateFixturesForLeague(leagueId, startDateSafe);
  functions.logger.info('[CALLABLE] generateRoundRobinFixturesFn bitti', { leagueId, forced: force });
  return { ok: true, forced: force };
});

// New callable alias matching plan: requestJoinLeague
export const requestJoinLeague = functions.region('europe-west1').https.onCall(async (request) => {
  requireAppCheck(request as any);
  functions.logger.info('[CALLABLE] requestJoinLeague çağrıldı', { hasAuth: !!request.auth });
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  const teamId: string | undefined = (request.data as any)?.teamId;
  if (!teamId) throw new functions.https.HttpsError('invalid-argument', 'teamId required');
  const teamSnap = await db.collection('teams').doc(teamId).get();
  if (!teamSnap.exists)
    throw new functions.https.HttpsError('not-found', 'Team not found');
  const teamData = teamSnap.data() as any;
  if (teamData.ownerUid && teamData.ownerUid !== uid)
    throw new functions.https.HttpsError('permission-denied', 'Not owner');
  const { leagueRef, state } = await assignTeam(teamId, teamData.name || `Team ${teamId}`, uid);
  return { leagueId: leagueRef.id, state };
});

// Finalize a forming league when full (22 teams). Optionally provide leagueId; if omitted, finds a full forming league.
export const finalizeIfFull = functions.region('europe-west1').https.onCall(async (request) => {
  requireAppCheck(request as any);
  requireAuth(request as any);
  const leagueId: string | undefined = (request.data as any)?.leagueId;
  functions.logger.info('[CALLABLE] finalizeIfFull çağrıldı', { leagueId });
  let targetRef: DocumentReference | null = null;
  if (leagueId) {
    targetRef = db.collection('leagues').doc(leagueId);
  } else {
    const snap = await db
      .collection('leagues')
      .where('state', '==', 'forming')
      .where('teamCount', '>=', 22)
      .limit(1)
      .get();
    if (!snap.empty) targetRef = snap.docs[0].ref;
  }
  if (!targetRef) return { ok: true, finalized: false };

  const result = await db.runTransaction(async (tx) => {
    const doc = await tx.get(targetRef!);
    if (!doc.exists) throw new functions.https.HttpsError('not-found', 'League not found');
    const data = doc.data() as any;
    const capacity = data.capacity ?? 22;
    const count = data.teamCount ?? 0;
    if (data.state !== 'forming' || count < capacity) {
      return { finalized: false, leagueId: doc.id };
    }
    const startDate = nextDay19TR();
    tx.update(doc.ref, {
      state: 'scheduled',
      startDate: Timestamp.fromDate(startDate),
      lockedAt: FieldValue.serverTimestamp(),
      rounds: 21,
    });
    return { finalized: true, leagueId: doc.id, startDate };
  });

  if ((result as any).finalized) {
    const { leagueId: lid, startDate } = result as any;
    const fixturesSnap = await db.collection('leagues').doc(lid).collection('fixtures').limit(1).get();
    if (fixturesSnap.empty) {
      await generateFixturesForLeague(lid, startDate as Date);
    }
  }
  return { ok: true, ...(result as any) };
});
