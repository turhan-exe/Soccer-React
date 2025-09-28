import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { requireAppCheck } from './mw/auth.js';


const db = getFirestore();

// Secret for server-initiated lock calls (Scheduler/Tasks/Operators)
// Set with: firebase functions:config:set lock.secret="YOUR_LOCK_SECRET"
const LOCK_SECRET = (functions.config() as any)?.lock?.secret || '';

type Player = {
  id: string;
  name?: string;
  position?: string;
  overall?: number;
  // Optional extra attributes if present in team docs
  attributes?: Record<string, number>;
};

type TeamDocShape = {
  id?: string;
  name?: string;
  players?: (Player & { squadRole?: string })[];
};

function pickXI(players: (Player & { squadRole?: string })[] | undefined) {
  if (!players || !Array.isArray(players)) return [] as Player[];
  const starters = players.filter((p) => p.squadRole === 'starting').slice(0, 11);
  return starters.map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    overall: p.overall,
    attributes: p.attributes,
  }));
}

function pickBench(players: (Player & { squadRole?: string })[] | undefined) {
  if (!players || !Array.isArray(players)) return [] as Player[];
  const bench = players.filter((p) => p.squadRole === 'bench').slice(0, 12);
  return bench.map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    overall: p.overall,
    attributes: p.attributes,
  }));
}

function rngFromIds(leagueId: string, matchId: string): number {
  // Simple deterministic seed from ids (32-bit)
  const s = `${leagueId}#${matchId}`;
  let hash = 2166136261 >>> 0; // FNV-1a 32-bit
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * HTTP: lockLineup
 * POST body: { leagueId: string, matchId: string }
 * Header: Authorization: Bearer <LOCK_SECRET>
 *
 * Creates matchPlans/{matchId} with home/away snapshots (XI + bench + basic meta).
 * Idempotent: if plan exists, returns without modifying.
 */
export const lockLineup = functions.region('europe-west1').https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('POST only');
    return;
  }
  try {
    // Bearer token check (server-only)
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!LOCK_SECRET || token !== LOCK_SECRET) {
      res.status(401).send('Unauthorized');
      return;
    }

    const { leagueId, matchId } = (req.body || {}) as { leagueId?: string; matchId?: string };
    if (!leagueId || !matchId) {
      res.status(400).send('missing fields: leagueId, matchId');
      return;
    }

    const fixtureRef = db.doc(`leagues/${leagueId}/fixtures/${matchId}`);
    const planRef = db.doc(`matchPlans/${matchId}`);

    const [fixtureSnap, planSnap] = await Promise.all([fixtureRef.get(), planRef.get()]);
    if (!fixtureSnap.exists) {
      res.status(404).send('fixture not found');
      return;
    }
    if (planSnap.exists) {
      res.json({ ok: true, idempotent: true });
      return;
    }

    const fx = fixtureSnap.data() as any;
    const homeId: string = fx.homeTeamId;
    const awayId: string = fx.awayTeamId;
    const kickoff: Timestamp | null = fx.date || null;

    const [homeSnap, awaySnap] = await Promise.all([
      db.doc(`teams/${homeId}`).get(),
      db.doc(`teams/${awayId}`).get(),
    ]);

    if (!homeSnap.exists || !awaySnap.exists) {
      res.status(404).send('team docs missing');
      return;
    }

    const home = homeSnap.data() as TeamDocShape;
    const away = awaySnap.data() as TeamDocShape;

    const homeXI = pickXI(home.players);
    const awayXI = pickXI(away.players);
    if (homeXI.length !== 11 || awayXI.length !== 11) {
      res.status(412).json({ ok: false, error: 'both teams must have 11 starters' });
      return;
    }

    // Standardized matchPlans schema: starters/subs arrays
    const payload = {
      schemaVersion: 1,
      matchId,
      leagueId,
      kickoffUtc: kickoff ? kickoff.toDate().toISOString() : null,
      rngSeed: rngFromIds(leagueId, matchId),
      home: {
        teamId: homeId,
        clubName: home.name || home.id || homeId,
        formation: 'auto',
        tactics: {},
        starters: homeXI.map((p) => p.id),
        subs: pickBench(home.players).map((p) => p.id),
      },
      away: {
        teamId: awayId,
        clubName: away.name || away.id || awayId,
        formation: 'auto',
        tactics: {},
        starters: awayXI.map((p) => p.id),
        subs: pickBench(away.players).map((p) => p.id),
      },
      createdAt: FieldValue.serverTimestamp(),
      lockedBy: 'scheduler',
    } as any;

    await planRef.create(payload);

    // Optionally mark fixture as locked (non-breaking; client can ignore)
    try {
      await fixtureRef.set({ locked: true }, { merge: true });
    } catch {}

    functions.logger.info('[LOCK] match plan created', { leagueId, matchId });
    res.json({ ok: true });
    return;
  } catch (e: any) {
    functions.logger.error('[LOCK] Failed to create match plan', { error: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'unknown' });
    return;
  }
});

/**
 * Callable: setLineup
 * Saves formation/tactics and starting XI/bench under teams/{teamId}.lineup with validation.
 * Input: { teamId, formation, tactics, starters: string[], subs?: string[] }
 */
export const setLineup = functions.region('europe-west1').https.onCall(async (request) => {
  requireAppCheck(request as any);
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Auth required');

  const { teamId, formation, tactics, starters, subs, reserves } = (request.data || {}) as any;
  if (!teamId || !Array.isArray(starters)) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId and starters[] required');
  }
  if (starters.length !== 11) {
    throw new functions.https.HttpsError('failed-precondition', 'Exactly 11 starters required');
  }

  const teamRef = db.collection('teams').doc(teamId);
  const snap = await teamRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
  const team = snap.data() as any;
  if (team.ownerUid && team.ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not owner');
  }

  // Validate that all players exist in team roster
  const roster: any[] = Array.isArray(team.players) ? team.players : [];
  const haveIds = new Set(roster.map((p) => String(p.id)));

  const startersList = Array.from(new Set((Array.isArray(starters) ? starters : []).map(String)));
  const benchList = Array.from(new Set((Array.isArray(subs) ? subs : []).map(String))).filter(
    (id) => !startersList.includes(id)
  );
  const reserveList = Array.from(new Set((Array.isArray(reserves) ? reserves : []).map(String))).filter(
    (id) => !startersList.includes(id) && !benchList.includes(id)
  );

  const unknown = [...startersList, ...benchList, ...reserveList].filter((id) => !haveIds.has(id));
  if (unknown.length) {
    throw new functions.https.HttpsError('invalid-argument', 'Unknown player ids: ' + unknown.join(','));
  }

  const lineup = {
    formation: typeof formation === 'string' ? formation : 'auto',
    tactics: (tactics && typeof tactics === 'object') ? tactics : {},
    starters: startersList,
    subs: benchList,
    reserves: reserveList,
    updatedAt: FieldValue.serverTimestamp(),
  };

  await teamRef.set({ lineup }, { merge: true });
  return { ok: true };
});


