import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { generateDoubleRoundRobinSlots } from './utils/roundrobin.js';
import { nextMonthOrThisMonthFirstAt19, monthKeyTR, dateForRound } from './utils/time.js';
import { ensureBotTeamDoc } from './utils/bots.js';

const db = getFirestore();
const REGION = 'europe-west1';
const ADMIN_SECRET = (functions.config() as any)?.admin?.secret
  || (functions.config() as any)?.scheduler?.secret
  || (functions.config() as any)?.orchestrate?.secret
  || '';

async function loadLeagues(targetLeagueId?: string) {
  if (targetLeagueId) {
    const doc = await db.collection('leagues').doc(targetLeagueId).get();
    if (!doc.exists) {
      throw new functions.https.HttpsError('not-found', 'League not found');
    }
    return [doc];
  }
  const snap = await db.collection('leagues').get();
  return snap.docs;
}

async function resetSeasonMonthlyInternal(targetLeagueId?: string) {
  const leagues = await loadLeagues(targetLeagueId);
  const startDate = nextMonthOrThisMonthFirstAt19();
  const mKey = monthKeyTR(startDate);

  for (const lg of leagues) {
    const leagueRef = lg.ref;
    const league = lg.data() as any;
    const capacity = league.capacity ?? 15;
    const rounds = Math.max(28, league.rounds ?? 28);
    const template = generateDoubleRoundRobinSlots(capacity);

    // Mark completed previous season and schedule new one
    await leagueRef.set({
      state: 'scheduled',
      startDate: Timestamp.fromDate(startDate),
      rounds,
      monthKey: mKey,
      lockedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Ensure slots: keep human, fill missing with bots
    const slotsSnap = await leagueRef.collection('slots').get();
    // naive bot refill: any with type bot but missing botId => assign random placeholder
    for (const sDoc of slotsSnap.docs) {
      const s = sDoc.data() as any;
      if (s.type === 'bot' && !s.teamId && !s.botId) {
        await sDoc.ref.set({ botId: `bot-${sDoc.id}` }, { merge: true });
      }
    }

    // Reset standings using current names
    const standingsBatch = db.batch();
    const standingsSnap = await leagueRef.collection('standings').get();
    const nameBySlot = new Map<number, string>();
    for (const s of slotsSnap.docs) {
      const sd = s.data() as any;
      const slotIndex = sd.slotIndex;
      const name = sd.teamId ? (sd.teamId as string) : `Bot ${sd.botId || slotIndex}`;
      nameBySlot.set(slotIndex, name);
    }
    // Clear standings and write new
    for (const st of standingsSnap.docs) standingsBatch.delete(st.ref);
    for (const [slotIndex, name] of nameBySlot) {
      const ref = leagueRef.collection('standings').doc(String(slotIndex));
      standingsBatch.set(ref, {
        slotIndex,
        teamId: slotsSnap.docs.find((d) => (d.data() as any).slotIndex === slotIndex)?.data()?.teamId || null,
        name,
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
    await standingsBatch.commit();

    // Regenerate fixtures
    const existingFix = await leagueRef.collection('fixtures').get();
    let batch = db.batch();
    let ops = 0;
    for (const d of existingFix.docs) {
      batch.delete(d.ref); ops++; if (ops >= 450) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; }

    // Build slot map for teamIds
    const slotMap = new Map<number, string | null>();
    for (const s of slotsSnap.docs) {
      const sd = s.data() as any;
      const slotIndex = sd.slotIndex as number;
      let teamId = sd.teamId || null;
      if (!teamId && sd.botId) {
        teamId = await ensureBotTeamDoc({ botId: sd.botId, slotIndex });
      }
      slotMap.set(slotIndex, teamId);
    }

    for (const f of template) {
      const fRef = leagueRef.collection('fixtures').doc();
      const date = dateForRound(startDate, f.round);
      const homeTeamId = slotMap.get(f.homeSlot) || null;
      const awayTeamId = slotMap.get(f.awaySlot) || null;
      batch.set(fRef, {
        round: f.round,
        date: Timestamp.fromDate(date),
        homeSlot: f.homeSlot,
        awaySlot: f.awaySlot,
        status: 'scheduled',
        score: null,
        homeTeamId,
        awayTeamId,
        participants: [homeTeamId, awayTeamId].filter(Boolean),
      });
      ops++; if (ops >= 450) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if (ops > 0) await batch.commit();
  }

  return { processed: leagues.length, startDate: startDate.toISOString(), monthKey: mKey };
}

export const resetSeasonMonthly = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .pubsub.schedule('5 0 1 * *')
  .timeZone('Europe/Istanbul')
  .onRun(async () => {
    return resetSeasonMonthlyInternal();
  });

export const resetSeasonMonthlyHttp = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const leagueId = (req.body?.leagueId as string) || (req.query?.leagueId as string);
    try {
      const result = await resetSeasonMonthlyInternal(leagueId);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'internal' });
    }
  });
