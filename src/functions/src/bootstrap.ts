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

async function runBootstrap() {
  const LEAGUE_COUNT = Number(process.env.LEAGUE_COUNT || DEFAULTS.LEAGUE_COUNT);
  const requestedCapacity = Number(
    process.env.LEAGUE_CAPACITY || DEFAULTS.CAPACITY,
  );
  const capacity = normalizeCapacity(requestedCapacity);
  const ROUNDS = Number(process.env.ROUNDS_PER_SEASON || DEFAULTS.ROUNDS);
  const TIMEZONE = DEFAULTS.TIMEZONE;

  const startDate = nextMonthOrThisMonthFirstAt19();
  const mKey = monthKeyTR(startDate);

  // Check if already bootstrapped for this month
  const exists = await db
    .collection('leagues')
    .where('monthKey', '==', mKey)
    .limit(1)
    .get();
  if (!exists.empty) {
    return { ok: true, skipped: true, monthKey: mKey } as const;
  }

  // Ensure bot pool
  await ensureBots(LEAGUE_COUNT * capacity);
  const botSnap = await db.collection('bots').get();
  const botIds = botSnap.docs.map((d) => d.id);
  const botNames = new Map(botSnap.docs.map((d) => [d.id, (d.data() as any).name || d.id]));
  const usedBotIds = new Set<string>();

  const fixturesTemplate = generateDoubleRoundRobinSlots(capacity);

  // Create leagues + slots + fixtures + standings
  for (let i = 1; i <= LEAGUE_COUNT; i++) {
    const ref = db.collection('leagues').doc();
    const leagueData = {
      name: `Lig ${i}`,
      season: 1,
      capacity,
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
      slotMap.set(s.slotIndex, { teamId: s.teamId, botId: s.botId, name });
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
  .region(REGION)
  .https.onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    return await runBootstrap();
  });

export const bootstrapMonthlyLeaguesOneTimeHttp = functions
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
      const result = await runBootstrap();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'error' });
    }
  });
