import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { ensureBotTeamDoc } from './utils/bots.js';

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

interface CleanupSlotTarget {
  leagueId: string;
  slotIndex: number;
}

function extractSlotIndex(
  doc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>
): number {
  const data = doc.data() as any;
  const rawIndex = data?.slotIndex;
  const slotIndex =
    typeof rawIndex === 'number'
      ? rawIndex
      : Number(doc.id) || 0;
  return slotIndex;
}

function pickCanonicalSlot(
  docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[],
  preferredLeagueId: string | null
) {
  if (preferredLeagueId) {
    const match = docs.find(
      (d) => d.ref.parent.parent && d.ref.parent.parent.id === preferredLeagueId
    );
    if (match) return match;
  }
  const withScore = docs.map((doc) => {
    const data = doc.data() as any;
    const lockedAt = data?.lockedAt;
    const updatedAt = data?.updatedAt;
    const scoreCandidates = [lockedAt, updatedAt].filter(
      (ts: any) => ts && typeof ts.toMillis === 'function'
    );
    const score = scoreCandidates.length > 0 ? Math.max(...scoreCandidates.map((ts: any) => ts.toMillis())) : 0;
    return { doc, score };
  });
  withScore.sort((a, b) => b.score - a.score);
  return withScore[0]?.doc ?? docs[0];
}

async function clearSlotFixtures(leagueId: string, slotIndex: number) {
  const leagueRef = db.collection('leagues').doc(leagueId);
  const fixturesRef = leagueRef.collection('fixtures');
  const slotSnap = await leagueRef.collection('slots').doc(String(slotIndex)).get();
  const slotData = slotSnap.exists ? (slotSnap.data() as any) : null;
  const botTeamId = slotData?.botId
    ? await ensureBotTeamDoc({ botId: slotData.botId, slotIndex })
    : null;
  const [homeSnap, awaySnap] = await Promise.all([
    fixturesRef.where('homeSlot', '==', slotIndex).get(),
    fixturesRef.where('awaySlot', '==', slotIndex).get(),
  ]);

  let batch = db.batch();
  let ops = 0;

  const apply = async (
    snap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>,
    field: 'homeTeamId' | 'awayTeamId'
  ) => {
    for (const doc of snap.docs) {
      const data = doc.data() as any;
      let home = (data['homeTeamId'] as string | null) ?? null;
      let away = (data['awayTeamId'] as string | null) ?? null;
      if (field === 'homeTeamId') {
        home = botTeamId;
      } else {
        away = botTeamId;
      }
      batch.update(doc.ref, {
        [field]: null,
        participants: [home, away].filter(Boolean),
      });
      ops++;
      if (ops >= 450) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
  };

  await apply(homeSnap, 'homeTeamId');
  await apply(awaySnap, 'awayTeamId');

  if (ops > 0) {
    await batch.commit();
  }
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
    const cleanupSlots: CleanupSlotTarget[] = [];
    const teamRef = db.collection('teams').doc(teamId);

    // READ 1: Team Data
    const teamSnap = await tx.get(teamRef);
    const teamData = teamSnap.exists ? (teamSnap.data() as any) : {};
    let existingLeagueId: string | null = (teamData?.leagueId as string | null) ?? null;

    // READ 2: Check League Validity
    let leagueIsValid = false;
    if (existingLeagueId) {
      const lgSnap = await tx.get(db.collection('leagues').doc(existingLeagueId));
      leagueIsValid = lgSnap.exists;
    }

    // READ 3: Check Existing Slots
    let slotQuerySnap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData> | null = null;
    try {
      slotQuerySnap = await tx.get(
        db.collectionGroup('slots').where('teamId', '==', teamId)
      );
    } catch (err) {
      functions.logger.warn('[assignIntoRandomBotSlot] slots query failed', { teamId, error: (err as any)?.message });
    }

    // LOGIC & WRITES

    // Handle Stale League ID
    if (existingLeagueId && !leagueIsValid) {
      // League deleted but team still points to it.
      // We will overwrite this with new leagueId later, or explicit delete if assignment fails (unlikely).
      // effectively strictly we treat as not assigned.
      existingLeagueId = null;
    }

    if (slotQuerySnap && !slotQuerySnap.empty) {
      const docs = slotQuerySnap.docs;
      const canonical = pickCanonicalSlot(docs, existingLeagueId);
      const canonicalLeagueId = canonical.ref.parent.parent!.id;
      const canonicalSlotIndex = extractSlotIndex(canonical);

      // Verify canonical league still exists if we haven't checked it
      // (If existingLeagueId matched canonical, we checked it. If not, we might not have)
      // Complexity: logic implies fairness. simpler: just trust slot or re-read? 
      // Re-reading violates "all reads before writes" if we wrote something already? 
      // We haven't written yet.
      // But we need to ensure we don't return a deleted league.
      // However, usually slots are deleted recursively. If slot exists, league likely exists.

      // Update Team
      tx.set(teamRef, { leagueId: canonicalLeagueId }, { merge: true });

      // Update Canonical Slot
      tx.update(canonical.ref, {
        type: 'human',
        teamId,
        lockedAt: FieldValue.serverTimestamp(),
      });

      // Update Standings & Teams in League
      const canonicalLeagueRef = db.collection('leagues').doc(canonicalLeagueId);
      const canonicalStandingsRef = canonicalLeagueRef.collection('standings').doc(String(canonicalSlotIndex));
      tx.set(
        canonicalStandingsRef,
        {
          teamId,
          name: teamName,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      const canonicalTeamsRef = canonicalLeagueRef.collection('teams').doc(teamId);
      tx.set(
        canonicalTeamsRef,
        {
          teamId,
          name: teamName,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Cleanup duplicates
      for (const doc of docs) {
        if (doc.ref.isEqual(canonical.ref)) continue;
        const slotIndex = extractSlotIndex(doc);
        const leagueRef = db.collection('leagues').doc(doc.ref.parent.parent!.id);
        const data = doc.data() as any;
        const fallbackBotId =
          typeof data?.botId === 'string' && data.botId.trim().length > 0
            ? data.botId
            : `cleanup-bot-${slotIndex}`;
        tx.update(doc.ref, {
          type: 'bot',
          teamId: null,
          botId: fallbackBotId,
          lockedAt: FieldValue.serverTimestamp(),
        });
        const standingsRef = leagueRef.collection('standings').doc(String(slotIndex));
        const fallbackName =
          typeof data?.botId === 'string' && data.botId.trim().length > 0
            ? data.botId
            : `Bot ${slotIndex}`;
        tx.set(
          standingsRef,
          {
            teamId: null,
            name: fallbackName,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        // Remove team link from league
        const leagueTeamsRef = leagueRef.collection('teams').doc(teamId);
        tx.delete(leagueTeamsRef);
        cleanupSlots.push({ leagueId: leagueRef.id, slotIndex });
      }

      return {
        status: 'already' as const,
        leagueId: canonicalLeagueId,
        slotIndex: canonicalSlotIndex,
        cleanupSlots,
      };
    }

    if (existingLeagueId && leagueIsValid) {
      return {
        status: 'already' as const,
        leagueId: existingLeagueId,
        slotIndex: null,
        cleanupSlots,
      };
    }

    // If we are here, we need to assign.
    // We cannot do 'await chooseRandomBotSlotInNextLeague()' here because it does queries!
    // And we are inside a transaction where we might have done writes?
    // No, we haven't done writes yet if we reached here.
    // BUT 'chooseRandomBotSlotInNextLeague' does queries that are NOT part of the transaction (unless passed tx).
    // And mixing tx reads and non-tx reads is fine, but mixing tx reads and tx writes...
    // The issue is: we need to find a slot, then LOCK it in the transaction.
    // 'chooseRandomBotSlotInNextLeague' returns a leagueId and slotIndex.
    // We then need to 'tx.get' that slot.
    // So valid order:
    // 1. Reads (Team, League, Slots)
    // 2. Logic determines we need new slot.
    // 3. Perform non-tx query to find slot? 
    //    -> If we do await inside runTransaction, the transaction might expire or conflict?
    //    -> Firestore runTransaction allows async.
    //    -> But we must not assume state matches.
    //    -> 'chooseRandomBotSlotInNextLeague' is just a heuristic.
    // 4. Then tx.get(slot) to confirm.
    // 5. Then Writes.

    // HOWEVER, we already did reads (Team, League, Slots).
    // So as long as we don't write before step 4, we are good.
    // We checked existingLeagueId/Slots. If we found nothing, we proceed.
    // We have NOT written anything yet in this path.

    const chosen = await chooseRandomBotSlotInNextLeague();
    if (!chosen) throw new functions.https.HttpsError('resource-exhausted', 'No available slot');

    const leagueRef = db.collection('leagues').doc(chosen.leagueId);
    const slotRef = leagueRef.collection('slots').doc(String(chosen.slotIndex));
    const stRef = leagueRef.collection('standings').doc(String(chosen.slotIndex));

    // READS (Valid, as we haven't written yet)
    const [slotDocSnap, stSnap] = await Promise.all([tx.get(slotRef), tx.get(stRef)]);

    if (!slotDocSnap.exists) throw new functions.https.HttpsError('not-found', 'Slot not found');
    const s = slotDocSnap.data() as any;
    if (s.type !== 'bot' || s.teamId) throw new functions.https.HttpsError('failed-precondition', 'Slot already taken');

    // WRITES (All happen now)

    // If stale league existed, we must clear it from team? 
    // Actually we are overwriting team.leagueId below, so implicit clear.

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
    tx.set(teamRef, { leagueId: chosen.leagueId }, { merge: true });

    return {
      status: 'assigned' as const,
      leagueId: chosen.leagueId,
      slotIndex: chosen.slotIndex,
      cleanupSlots,
    };
  });

  if (result.cleanupSlots && result.cleanupSlots.length > 0) {
    for (const target of result.cleanupSlots) {
      await clearSlotFixtures(target.leagueId, target.slotIndex);
    }
  }

  if (result.status === 'assigned') {
    await updateFixturesForSlot(result.leagueId, result.slotIndex!, teamId);
    return { leagueId: result.leagueId, slotIndex: result.slotIndex };
  }

  if (result.slotIndex != null) {
    await updateFixturesForSlot(result.leagueId, result.slotIndex, teamId);
    return { leagueId: result.leagueId, slotIndex: result.slotIndex };
  }

  // status === 'already' but slotIndex unknown: resolve slotIndex by querying the league.
  const slotsSnap = await db.collection('leagues').doc(result.leagueId).collection('slots').get();
  const found = slotsSnap.docs.find((d) => {
    const s = d.data() as any;
    return s?.teamId === teamId;
  });
  const slotIndex = found ? Number(found.id) || (found.data() as any).slotIndex : undefined;
  if (slotIndex != null) {
    await updateFixturesForSlot(result.leagueId, slotIndex, teamId);
  }
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

export const assignAllTeamsToLeagues = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    // Admin-only via bearer secret or just open for now (dev)
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const authz = (req.headers.authorization as string) || '';

    // Authorization check omitted for dev/one-time, or you can add it back

    functions.logger.info('[HTTP] assignAllTeamsToLeagues: Started');

    const teamsSnap = await db.collection('teams').get();
    functions.logger.info(`[HTTP] Found ${teamsSnap.size} teams to process.`);

    const results: any[] = [];

    // Process using simple loop to avoid complex concurrency issues
    let assigned = 0;
    let errors = 0;

    for (const doc of teamsSnap.docs) {
      const tData = doc.data();
      // Skip bots or teams without owner
      if (!tData.ownerUid) continue;

      const name = tData.name || `Team ${doc.id}`;
      try {
        const res = await assignIntoRandomBotSlot(doc.id, name);
        results.push({ id: doc.id, ...res });
        if (res.status === 'assigned') assigned++;
      } catch (e: any) {
        errors++;
        functions.logger.error(`[HTTP] Failed for ${doc.id}`, e);
        results.push({ id: doc.id, error: e.message });
      }
    }

    functions.logger.info('[HTTP] assignAllTeamsToLeagues: Finished', { assigned, errors });
    res.json({ assigned, errors, details: results });
  });
