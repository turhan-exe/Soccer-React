import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

const db = getFirestore();
const REGION = 'europe-west1';

async function updateFixturesForSlot(leagueId: string, slotIndex: number, teamId: string) {
  const ref = db.collection('leagues').doc(leagueId);
  const fixSnap = await ref.collection('fixtures').get();
  let batch = db.batch();
  let ops = 0;
  for (const d of fixSnap.docs) {
    const f = d.data() as any;
    let patch: any = null;
    if (f.homeSlot === slotIndex) {
      patch = { homeTeamId: teamId };
    } else if (f.awaySlot === slotIndex) {
      patch = { awayTeamId: teamId };
    }
    if (patch) {
      const home = patch.homeTeamId ?? f.homeTeamId ?? null;
      const away = patch.awayTeamId ?? f.awayTeamId ?? null;
      batch.update(d.ref, { ...patch, participants: [home, away].filter(Boolean) });
      ops++;
      if (ops >= 450) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
  }
  if (ops > 0) await batch.commit();
}

async function chooseRandomBotSlotInNextLeague(): Promise<{ leagueId: string; slotIndex: number } | null> {
  let leaguesSnap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
  try {
    leaguesSnap = await db
      .collection('leagues')
      .where('state', 'in', ['forming', 'scheduled'])
      .orderBy('createdAt', 'asc')
      .get();
  } catch (e: any) {
    // Missing index: fall back to query without orderBy
    leaguesSnap = await db
      .collection('leagues')
      .where('state', 'in', ['forming', 'scheduled'])
      .limit(50)
      .get();
  }
  for (const lg of leaguesSnap.docs) {
    const slotsSnap = await lg.ref
      .collection('slots')
      .orderBy('slotIndex', 'asc')
      .get();
    const free = slotsSnap.docs
      .map((d) => d.data() as any)
      .filter((s) => s.type === 'bot' && !s.teamId)
      .map((s) => s.slotIndex as number);
    if (free.length === 0) continue;
    const pick = free[Math.floor(Math.random() * free.length)];
    return { leagueId: lg.id, slotIndex: pick };
  }
  return null;
}

export async function assignIntoRandomBotSlot(teamId: string, teamName: string) {
  // First try to assign within a transaction, but bail out early if team already has a league.
  const result = await db.runTransaction(async (tx) => {
    const teamRef = db.collection('teams').doc(teamId);
    const teamSnap = await tx.get(teamRef);
    const existingLeagueId: string | undefined = teamSnap.exists ? (teamSnap.data() as any)?.leagueId : undefined;
    if (existingLeagueId) {
      // Already assigned: return info to caller; do not modify anything.
      return { status: 'already' as const, leagueId: existingLeagueId };
    }

    // Pick a free bot slot (non-transactional helper); later we will validate the slot in TX
    const chosen = await chooseRandomBotSlotInNextLeague();
    if (!chosen) throw new functions.https.HttpsError('resource-exhausted', 'No available slot');

    const leagueRef = db.collection('leagues').doc(chosen.leagueId);
    const slotRef = leagueRef.collection('slots').doc(String(chosen.slotIndex));
    const stRef = leagueRef.collection('standings').doc(String(chosen.slotIndex));

    // READS (TX rule: before writes)
    const [slotSnap, stSnap] = await Promise.all([tx.get(slotRef), tx.get(stRef)]);
    if (!slotSnap.exists) throw new functions.https.HttpsError('not-found', 'Slot not found');
    const s = slotSnap.data() as any;
    if (s.type !== 'bot' || s.teamId) throw new functions.https.HttpsError('failed-precondition', 'Slot already taken');

    // WRITES
    tx.update(slotRef, { type: 'human', teamId, botId: null, lockedAt: FieldValue.serverTimestamp() });
    if (stSnap.exists) {
      tx.update(stRef, { teamId, name: teamName });
    } else {
      tx.set(stRef, {
        slotIndex: chosen.slotIndex,
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
      });
    }
    tx.update(teamRef, { leagueId: chosen.leagueId });

    return { status: 'assigned' as const, leagueId: chosen.leagueId, slotIndex: chosen.slotIndex };
  });

  if (result.status === 'assigned') {
    await updateFixturesForSlot(result.leagueId, result.slotIndex!, teamId);
    return { leagueId: result.leagueId, slotIndex: result.slotIndex };
  }

  // status === 'already': try to resolve slotIndex for the team in that league for a friendly idempotent response.
  const slotsSnap = await db.collection('leagues').doc(result.leagueId).collection('slots').get();
  const found = slotsSnap.docs.find((d) => {
    const s = d.data() as any;
    return s?.teamId === teamId;
  });
  const slotIndex = found ? Number(found.id) || (found.data() as any).slotIndex : undefined;
  return { leagueId: result.leagueId, slotIndex: slotIndex ?? null } as any;
}

export const assignRealTeamToFirstAvailableBotSlot = functions
  .region(REGION)
  .https.onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    const teamId: string | undefined = (request.data as any)?.teamId;
    if (!teamId) throw new functions.https.HttpsError('invalid-argument', 'teamId required');

    const teamSnap = await db.collection('teams').doc(teamId).get();
    if (!teamSnap.exists) throw new functions.https.HttpsError('not-found', 'team not found');
    const team = teamSnap.data() as any;
    if (team.ownerUid && team.ownerUid !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'Not owner');
    }

    const teamName = team.name || `Team ${teamId}`;
    const chosen = await assignIntoRandomBotSlot(teamId, teamName);
    return { ok: true, leagueId: chosen.leagueId, slotIndex: chosen.slotIndex };
  });

// HTTP variant for manual fallback (Bearer ID token required)
export const assignRealTeamToFirstAvailableBotSlotHttp = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!token) { res.status(401).json({ error: 'Auth required' }); return; }
    let uid: string;
    try {
      const decoded = await (await import('firebase-admin/auth')).getAuth().verifyIdToken(token);
      uid = decoded.uid;
    } catch { res.status(401).json({ error: 'Invalid token' }); return; }
    const teamId = (req.body?.teamId as string) || uid;
    const teamSnap = await db.collection('teams').doc(teamId).get();
    if (!teamSnap.exists) { res.status(404).json({ error: 'team not found' }); return; }
    const team = teamSnap.data() as any;
    if (team.ownerUid && team.ownerUid !== uid) { res.status(403).json({ error: 'not owner' }); return; }
    const teamName = team.name || `Team ${teamId}`;
    try {
      const chosen = await assignIntoRandomBotSlot(teamId, teamName);
      res.json({ ok: true, leagueId: chosen.leagueId, slotIndex: chosen.slotIndex });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'error' });
    }
  });
