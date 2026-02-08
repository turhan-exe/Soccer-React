import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { formatInTimeZone } from 'date-fns-tz';
import {
  generateDoubleRoundRobinSlots,
  normalizeCapacity,
} from './utils/roundrobin.js';
import { nextMonthOrThisMonthFirstAt19, monthKeyTR, dateForRound } from './utils/time.js';
import { ensureBotTeamDoc } from './utils/bots.js';

const db = getFirestore();
const REGION = 'europe-west1';

const DEFAULTS = {
  LEAGUE_COUNT: 25,
  CAPACITY: 15,
  ROUNDS: 28,
  TIMEZONE: 'Europe/Istanbul',
};

async function ensureBots(minCount: number) {
  const snap = await db.collection('bots').get();
  let have = snap.size;
  if (have >= minCount) return;
  const batchSize = 400;
  let batch = db.batch();
  let ops = 0;
  for (let i = have + 1; i <= minCount; i++) {
    const ref = db.collection('bots').doc();
    const rating = 50 + (i % 40);
    batch.set(ref, { name: `Bot ${i}`, rating, createdAt: FieldValue.serverTimestamp() });
    ops++;
    if (ops >= batchSize) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
}

function pickBotsForLeague(allBotIds: string[], used: Set<string>, count: number): string[] {
  const ids: string[] = [];
  for (const id of allBotIds) {
    if (used.has(id)) continue;
    ids.push(id);
    used.add(id);
    if (ids.length >= count) break;
  }
  if (ids.length < count) {
    // Wrap if needed (unlikely)
    used.clear();
    const extra: string[] = [];
    for (const id of allBotIds) {
      if (extra.length >= count - ids.length) break;
      if (ids.includes(id)) continue;
      extra.push(id);
    }
    return [...ids, ...extra];
  }
  return ids;
}


// Helper for recursive delete
async function deleteQueryBatch(db: FirebaseFirestore.Firestore, query: FirebaseFirestore.Query, resolve: (val?: any) => void) {
  const snapshot = await query.get();

  const batchSize = snapshot.size;
  if (batchSize === 0) {
    // When there are no documents left, we are done
    resolve();
    return;
  }

  // Delete documents in a batch
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  // Recurse on the next process tick, to avoid escaping the stack
  process.nextTick(() => {
    deleteQueryBatch(db, query, resolve);
  });
}

// Function to delete a collection and its subcollections
async function deleteCollection(db: FirebaseFirestore.Firestore, collectionPath: string, batchSize: number) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy('__name__').limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(db, query, resolve);
  });
}

// Custom specialized delete for leagues that also cleans subcollections
async function wipeLeagues(db: FirebaseFirestore.Firestore) {
  console.log('[wipeLeagues] Starting full wipe...');
  const leaguesSnap = await db.collection('leagues').get();
  for (const lg of leaguesSnap.docs) {
    // manually wipe known subcollections
    await deleteCollection(db, `leagues/${lg.id}/slots`, 500);
    await deleteCollection(db, `leagues/${lg.id}/fixtures`, 500);
    await deleteCollection(db, `leagues/${lg.id}/standings`, 500);
    await deleteCollection(db, `leagues/${lg.id}/teams`, 500);
    await lg.ref.delete();
  }
  console.log('[wipeLeagues] Wipe complete.');
}


async function runBootstrap(forceReset?: boolean) {
  const LEAGUE_COUNT = Number(process.env.LEAGUE_COUNT || DEFAULTS.LEAGUE_COUNT);
  const requestedCapacity = Number(
    process.env.LEAGUE_CAPACITY || 15 // Force 15 capacity
  );
  const capacity = 15; // Hardcode strict 15
  const ROUNDS = Number(process.env.ROUNDS_PER_SEASON || DEFAULTS.ROUNDS);
  const TIMEZONE = DEFAULTS.TIMEZONE;

  // Force Start Date: Feb 1, 2026, 19:00:00 TRT
  // 2026-02-01T16:00:00.000Z (UTC) for 19:00 TRT
  // Or just create a Date object
  const startDate = new Date('2026-02-01T19:00:00+03:00');
  const mKey = '2026-02'; // Hardcode month key for Feb 2026

  if (forceReset) {
    await wipeLeagues(db);
  } else {
    // Check if already bootstrapped for this month (only if not forcing reset)
    const exists = await db
      .collection('leagues')
      .where('monthKey', '==', mKey)
      .limit(1)
      .get();
    if (!exists.empty) {
      return { ok: true, skipped: true, monthKey: mKey } as const;
    }
  }

  // Ensure bot pool
  await ensureBots(LEAGUE_COUNT * capacity);
  const botSnap = await db.collection('bots').get();
  const botIds = botSnap.docs.map((d) => d.id);
  const botNames = new Map(botSnap.docs.map((d) => [d.id, (d.data() as any).name || d.id]));
  const botRatings = new Map(botSnap.docs.map((d) => [d.id, (d.data() as any).rating]));
  const usedBotIds = new Set<string>();

  const fixturesTemplate = generateDoubleRoundRobinSlots(capacity);

  // Create leagues + slots + fixtures + standings
  for (let i = 1; i <= LEAGUE_COUNT; i++) {
    const ref = db.collection('leagues').doc();
    const leagueData = {
      name: `Lig ${i}`,
      season: 1,
      capacity, // 15
      timezone: TIMEZONE,
      state: 'scheduled' as const,
      createdAt: FieldValue.serverTimestamp(),
      startDate: Timestamp.fromDate(startDate),
      rounds: ROUNDS,
      monthKey: mKey,
    };
    await ref.set(leagueData);

    // Slots
    const leagueBots = pickBotsForLeague(botIds, usedBotIds, capacity);
    const slotBatch = db.batch();
    leagueBots.forEach((botId, idx) => {
      const slotIndex = idx + 1;
      const slotRef = ref.collection('slots').doc(String(slotIndex));
      slotBatch.set(slotRef, {
        slotIndex,
        type: 'bot',
        teamId: null,
        botId,
        lockedAt: null,
      });
    });
    await slotBatch.commit();

    const botTeamIds = new Map<string, string>();
    await Promise.all(
      leagueBots.map(async (botId, idx) => {
        const teamId = await ensureBotTeamDoc({
          botId,
          name: botNames.get(botId),
          rating: botRatings.get(botId),
          slotIndex: idx + 1,
        });
        botTeamIds.set(botId, teamId);
      })
    );

    // Standings (initial, by slot)
    const standingsBatch = db.batch();
    leagueBots.forEach((botId, idx) => {
      const slotIndex = idx + 1;
      const stRef = ref.collection('standings').doc(String(slotIndex));
      standingsBatch.set(stRef, {
        slotIndex,
        teamId: null,
        name: botNames.get(botId) || `Bot ${botId}`,
        P: 0,
        W: 0,
        D: 0,
        L: 0,
        GF: 0,
        GA: 0,
        GD: 0,
        Pts: 0,
      });
    });
    await standingsBatch.commit();

    // Fixtures (slot-based, but also embed teamIds at creation)
    const slotsSnap = await ref.collection('slots').get();
    const slotMap = new Map<number, { teamId: string | null; botId: string | null; name: string }>();
    slotsSnap.docs.forEach((d) => {
      const s = d.data() as any;
      const name = s.teamId ? s.teamId : (botNames.get(s.botId) || `Bot ${s.botId}`);
      const botTeamId = s.botId ? botTeamIds.get(s.botId) || null : null;
      const teamId = s.teamId || botTeamId || null;
      slotMap.set(s.slotIndex, { teamId, botId: s.botId, name });
    });

    let batch = db.batch();
    let ops = 0;
    for (const f of fixturesTemplate) {
      const date = dateForRound(startDate, f.round);
      const docRef = ref.collection('fixtures').doc();
      const homeTeamId = slotMap.get(f.homeSlot)?.teamId || null;
      const awayTeamId = slotMap.get(f.awaySlot)?.teamId || null;
      batch.set(docRef, {
        round: f.round,
        date: Timestamp.fromDate(date),
        homeSlot: f.homeSlot,
        awaySlot: f.awaySlot,
        status: 'scheduled',
        score: null,
        // convenience fields for current slot owners
        homeTeamId,
        awayTeamId,
        participants: [homeTeamId, awayTeamId].filter(Boolean),
      });
      ops++;
      if (ops >= 450) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();
  }

  return { ok: true, monthKey: mKey, startDate: startDate.toISOString(), leagues: LEAGUE_COUNT };
}

export const bootstrapMonthlyLeaguesOneTime = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .https.onCall(async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    const forceReset = (data as any)?.forceReset === true;
    return await runBootstrap(forceReset);
  });

export const bootstrapMonthlyLeaguesOneTimeHttp = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    // Allow CORS for manual calls
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!token) {
      res.status(401).json({ error: 'Auth required: missing Bearer token' });
      return;
    }
    try {
      await getAuth().verifyIdToken(token);
    } catch (e: any) {
      res.status(401).json({ error: 'Auth required: invalid token' });
      return;
    }
    try {
      const forceReset = req.body?.data?.forceReset === true || req.body?.forceReset === true;
      const result = await runBootstrap(forceReset);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'error' });
    }
  });
