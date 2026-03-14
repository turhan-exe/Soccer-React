import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { generateDoubleRoundRobinSlots } from './utils/roundrobin.js';
import { nextMonthOrThisMonthFirstAt19, monthKeyTR, dateForRound, monthStartAt19TR } from './utils/time.js';
import { ensureBotTeamDoc } from './utils/bots.js';
import { DEFAULT_MONTHLY_CAPACITY, resolveLeagueCapacity, roundsForCapacity } from './utils/leagueConfig.js';

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

type ResetSeasonInput = {
  leagueId?: string;
  targetMonth?: string;
  startDate?: string;
  capacity?: number;
};

type RepairLeagueInput = {
  leagueId?: string;
  capacity?: number;
};

type SlotState = {
  slotIndex: number;
  type: 'human' | 'bot';
  teamId: string | null;
  botId: string | null;
  fixtureTeamId: string | null;
  displayName: string;
};

function syntheticBotId(leagueId: string, slotIndex: number) {
  return `repair-bot-${leagueId}-${slotIndex}`;
}

function readSlotIndex(doc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>) {
  const data = doc.data() as any;
  return typeof data?.slotIndex === 'number' ? data.slotIndex : Number(doc.id) || 0;
}

async function loadTeamName(teamId: string, fallback: string) {
  try {
    const snap = await db.collection('teams').doc(teamId).get();
    if (!snap.exists) return fallback;
    const data = snap.data() as any;
    return data?.name || data?.clubName || fallback;
  } catch {
    return fallback;
  }
}

async function ensureLeagueSlotsIntegrity(
  leagueRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  capacity: number
) {
  const slotsCol = leagueRef.collection('slots');
  const slotsSnap = await slotsCol.get();
  const existingByIndex = new Map<number, FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>>();
  slotsSnap.docs.forEach((doc) => {
    const slotIndex = readSlotIndex(doc);
    if (slotIndex > 0) existingByIndex.set(slotIndex, doc);
  });

  let batch = db.batch();
  let ops = 0;
  let created = 0;
  let patched = 0;

  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (let slotIndex = 1; slotIndex <= capacity; slotIndex += 1) {
    const existing = existingByIndex.get(slotIndex);
    if (!existing) {
      batch.set(slotsCol.doc(String(slotIndex)), {
        slotIndex,
        type: 'bot',
        teamId: null,
        botId: syntheticBotId(leagueRef.id, slotIndex),
        lockedAt: null,
      });
      created += 1;
      ops += 1;
      if (ops >= 450) await flush();
      continue;
    }

    const data = existing.data() as any;
    const teamId = typeof data?.teamId === 'string' && data.teamId.trim().length > 0 ? data.teamId : null;
    const botId = typeof data?.botId === 'string' && data.botId.trim().length > 0 ? data.botId : null;
    const expectedType = teamId ? 'human' : 'bot';
    const nextBotId = teamId ? null : (botId || syntheticBotId(leagueRef.id, slotIndex));
    const needsPatch =
      data?.slotIndex !== slotIndex ||
      data?.type !== expectedType ||
      teamId !== (data?.teamId ?? null) ||
      nextBotId !== (data?.botId ?? null);

    if (!needsPatch) continue;
    batch.set(existing.ref, {
      slotIndex,
      type: expectedType,
      teamId,
      botId: nextBotId,
    }, { merge: true });
    patched += 1;
    ops += 1;
    if (ops >= 450) await flush();
  }

  await flush();

  const repairedSnap = await slotsCol.orderBy('slotIndex', 'asc').get();
  const slots: SlotState[] = [];
  for (const doc of repairedSnap.docs) {
    const data = doc.data() as any;
    const slotIndex = readSlotIndex(doc);
    if (slotIndex < 1 || slotIndex > capacity) continue;

    const teamId = typeof data?.teamId === 'string' && data.teamId.trim().length > 0 ? data.teamId : null;
    const botId = typeof data?.botId === 'string' && data.botId.trim().length > 0
      ? data.botId
      : syntheticBotId(leagueRef.id, slotIndex);

    if (teamId) {
      const displayName = await loadTeamName(teamId, `Team ${teamId}`);
      slots.push({
        slotIndex,
        type: 'human',
        teamId,
        botId: null,
        fixtureTeamId: teamId,
        displayName,
      });
      continue;
    }

    const fixtureTeamId = await ensureBotTeamDoc({ botId, slotIndex, name: `Bot ${slotIndex}` });
    slots.push({
      slotIndex,
      type: 'bot',
      teamId: null,
      botId,
      fixtureTeamId: fixtureTeamId || null,
      displayName: `Bot ${slotIndex}`,
    });
  }

  slots.sort((a, b) => a.slotIndex - b.slotIndex);
  return { created, patched, slots };
}

async function rebuildStandingsFromSlots(
  leagueRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  slots: SlotState[]
) {
  const standingsCol = leagueRef.collection('standings');
  const standingsSnap = await standingsCol.get();
  let batch = db.batch();
  let ops = 0;

  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const doc of standingsSnap.docs) {
    batch.delete(doc.ref);
    ops += 1;
    if (ops >= 450) await flush();
  }

  for (const slot of slots) {
    batch.set(standingsCol.doc(String(slot.slotIndex)), {
      slotIndex: slot.slotIndex,
      teamId: slot.teamId,
      name: slot.displayName,
      P: 0,
      W: 0,
      D: 0,
      L: 0,
      GF: 0,
      GA: 0,
      GD: 0,
      Pts: 0,
      updatedAt: FieldValue.serverTimestamp(),
    });
    ops += 1;
    if (ops >= 450) await flush();
  }

  await flush();
}

async function refreshFixtureParticipants(
  leagueRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  slots: SlotState[]
) {
  const teamIdBySlot = new Map<number, string | null>();
  slots.forEach((slot) => {
    teamIdBySlot.set(slot.slotIndex, slot.fixtureTeamId);
  });

  const fixturesSnap = await leagueRef.collection('fixtures').get();
  let batch = db.batch();
  let ops = 0;

  for (const doc of fixturesSnap.docs) {
    const data = doc.data() as any;
    const homeSlot = typeof data?.homeSlot === 'number' ? data.homeSlot : Number(data?.homeSlot) || 0;
    const awaySlot = typeof data?.awaySlot === 'number' ? data.awaySlot : Number(data?.awaySlot) || 0;
    const homeTeamId = teamIdBySlot.get(homeSlot) || null;
    const awayTeamId = teamIdBySlot.get(awaySlot) || null;
    batch.set(doc.ref, {
      homeTeamId,
      awayTeamId,
      participants: [homeTeamId, awayTeamId].filter(Boolean),
    }, { merge: true });
    ops += 1;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();
}

async function repairLeagueBotSlotsInternal(input: RepairLeagueInput = {}) {
  const leagues = await loadLeagues(input.leagueId);
  let repairedLeagues = 0;
  let createdSlots = 0;
  let patchedSlots = 0;

  for (const lg of leagues) {
    const league = lg.data() as any;
    const capacity = resolveLeagueCapacity(input.capacity ?? league.capacity ?? DEFAULT_MONTHLY_CAPACITY);
    await lg.ref.set({ capacity }, { merge: true });
    const repair = await ensureLeagueSlotsIntegrity(lg.ref, capacity);
    await rebuildStandingsFromSlots(lg.ref, repair.slots);
    await refreshFixtureParticipants(lg.ref, repair.slots);
    repairedLeagues += 1;
    createdSlots += repair.created;
    patchedSlots += repair.patched;
  }

  return {
    ok: true,
    repairedLeagues,
    createdSlots,
    patchedSlots,
  };
}

function resolveSeasonWindow(input: ResetSeasonInput = {}) {
  const rawStartDate = typeof input.startDate === 'string' ? input.startDate.trim() : '';
  if (rawStartDate) {
    const startDate = new Date(rawStartDate);
    if (Number.isNaN(startDate.getTime())) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid startDate');
    }
    return { startDate, monthKey: monthKeyTR(startDate) };
  }

  const rawTargetMonth = typeof input.targetMonth === 'string' ? input.targetMonth.trim() : '';
  if (rawTargetMonth) {
    const startDate = monthStartAt19TR(rawTargetMonth);
    return { startDate, monthKey: monthKeyTR(startDate) };
  }

  const startDate = nextMonthOrThisMonthFirstAt19();
  return { startDate, monthKey: monthKeyTR(startDate) };
}

async function resetSeasonMonthlyInternal(input: ResetSeasonInput = {}) {
  const leagues = await loadLeagues(input.leagueId);
  const { startDate, monthKey: mKey } = resolveSeasonWindow(input);

  for (const lg of leagues) {
    const leagueRef = lg.ref;
    const league = lg.data() as any;
    const capacity = resolveLeagueCapacity(input.capacity ?? league.capacity ?? DEFAULT_MONTHLY_CAPACITY);
    const rounds = roundsForCapacity(capacity);
    const template = generateDoubleRoundRobinSlots(capacity);

    // Mark completed previous season and schedule new one
    await leagueRef.set({
      capacity,
      state: 'scheduled',
      startDate: Timestamp.fromDate(startDate),
      rounds,
      monthKey: mKey,
      lockedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const repair = await ensureLeagueSlotsIntegrity(leagueRef, capacity);
    await rebuildStandingsFromSlots(leagueRef, repair.slots);

    // Regenerate fixtures
    const existingFix = await leagueRef.collection('fixtures').get();
    let batch = db.batch();
    let ops = 0;
    for (const d of existingFix.docs) {
      batch.delete(d.ref); ops++; if (ops >= 450) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; }

    // Build slot map for current slot owners
    const slotMap = new Map<number, string | null>();
    repair.slots.forEach((slot) => {
      slotMap.set(slot.slotIndex, slot.fixtureTeamId);
    });

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

    const payload = {
      leagueId: (req.body?.leagueId as string) || (req.query?.leagueId as string),
      targetMonth: (req.body?.targetMonth as string) || (req.query?.targetMonth as string),
      startDate: (req.body?.startDate as string) || (req.query?.startDate as string),
      capacity: req.body?.capacity ?? req.query?.capacity,
    } satisfies ResetSeasonInput;
    try {
      const result = await resetSeasonMonthlyInternal(payload);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'internal' });
    }
  });

export const repairLeagueBotSlotsHttp = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-admin-secret');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const authz = (req.headers.authorization as string) || '';
    const bearer = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    const headerSecret = (req.headers['x-admin-secret'] as string) || '';
    const providedSecret = bearer || headerSecret;
    if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const payload = {
      leagueId: (req.body?.leagueId as string) || (req.query?.leagueId as string),
      capacity: req.body?.capacity ?? req.query?.capacity,
    } satisfies RepairLeagueInput;

    try {
      const result = await repairLeagueBotSlotsInternal(payload);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'internal' });
    }
  });
