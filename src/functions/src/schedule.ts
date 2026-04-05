import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { generateDoubleRoundRobinSlots } from './utils/roundrobin.js';
import { nextMonthOrThisMonthFirstAt19, monthKeyTR, dateForRound, monthStartAt19TR } from './utils/time.js';
import { ensureBotTeamDoc } from './utils/bots.js';
import { DEFAULT_MONTHLY_CAPACITY, resolveLeagueCapacity, roundsForCapacity } from './utils/leagueConfig.js';
import { enqueueLeagueMatchReminders } from './notify/matchReminder.js';
import {
  buildMonthlyLeagueResetPlan,
  type MonthlyLeagueResetLeagueInput,
} from './utils/monthlyLeagueResetPlan.js';
import { isDomesticCompetition } from './utils/competition.js';

const db = getFirestore();
const REGION = 'europe-west1';
const MAX_BATCH = 450;
const DEFAULT_TIMEZONE = 'Europe/Istanbul';
const DEFAULT_KICKOFF_HOUR_TR = 19;
const ADMIN_SECRET = (functions.config() as any)?.admin?.secret
  || (functions.config() as any)?.scheduler?.secret
  || (functions.config() as any)?.orchestrate?.secret
  || '';

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

type OwnedTeamState = {
  teamId: string;
  name: string;
  ownerUid: string;
  currentLeagueId: string | null;
  createdAtMillis: number;
};

type ExistingLeagueMeta = {
  leagueId: string;
  ref: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  name: string;
  season: number;
  timezone: string;
  kickoffHourTR: number;
  createdAtMillis: number;
};

type PlannedLeagueWrite = {
  leagueId: string;
  ref: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  name: string;
  season: number;
  timezone: string;
  kickoffHourTR: number;
  humanTeamIds: string[];
  isNew: boolean;
};

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function timestampToMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (value instanceof Date) return value.getTime();
  return 0;
}

function parseKickoffHour(value: unknown): number {
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return DEFAULT_KICKOFF_HOUR_TR;
  }
  return hour;
}

function readSlotIndex(doc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>) {
  const data = doc.data() as any;
  return typeof data?.slotIndex === 'number' ? data.slotIndex : Number(doc.id) || 0;
}

function syntheticBotId(leagueId: string, slotIndex: number) {
  return `reset-bot-${leagueId}-${slotIndex}`;
}

function sortLeagueDocs(
  docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[]
) {
  return [...docs].sort((a, b) => {
    const aData = a.data() as any;
    const bData = b.data() as any;
    const seasonDiff = Number(aData?.season || 0) - Number(bData?.season || 0);
    if (seasonDiff !== 0) return seasonDiff;
    const createdDiff = timestampToMillis(aData?.createdAt) - timestampToMillis(bData?.createdAt);
    if (createdDiff !== 0) return createdDiff;
    return a.id.localeCompare(b.id);
  });
}

async function loadLeagues(targetLeagueId?: string) {
  if (targetLeagueId) {
    const doc = await db.collection('leagues').doc(targetLeagueId).get();
    if (!doc.exists) {
      throw new functions.https.HttpsError('not-found', 'League not found');
    }
    if (!isDomesticCompetition((doc.data() as Record<string, unknown>) ?? {})) {
      throw new functions.https.HttpsError('failed-precondition', 'League reset supports domestic competitions only');
    }
    return [doc as FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>];
  }
  const snap = await db.collection('leagues').get();
  return sortLeagueDocs(
    snap.docs.filter((doc) => isDomesticCompetition((doc.data() as Record<string, unknown>) ?? {})),
  );
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
      if (ops >= MAX_BATCH) await flush();
      continue;
    }

    const data = existing.data() as any;
    const teamId = normalizeString(data?.teamId);
    const botId = normalizeString(data?.botId);
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
    if (ops >= MAX_BATCH) await flush();
  }

  await flush();

  const repairedSnap = await slotsCol.orderBy('slotIndex', 'asc').get();
  const slots: SlotState[] = [];
  for (const doc of repairedSnap.docs) {
    const data = doc.data() as any;
    const slotIndex = readSlotIndex(doc);
    if (slotIndex < 1 || slotIndex > capacity) continue;

    const teamId = normalizeString(data?.teamId);
    const botId = normalizeString(data?.botId) || syntheticBotId(leagueRef.id, slotIndex);

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
    if (ops >= MAX_BATCH) await flush();
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
    if (ops >= MAX_BATCH) await flush();
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
    if (ops >= MAX_BATCH) {
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

async function loadOwnedTeamsForReset() {
  const snap = await db.collection('teams').get();
  const ownedTeams = new Map<string, OwnedTeamState>();

  for (const doc of snap.docs) {
    const data = doc.data() as any;
    const ownerUid = normalizeString(data?.ownerUid);
    if (!ownerUid) continue;

    ownedTeams.set(doc.id, {
      teamId: doc.id,
      name: normalizeString(data?.name) || normalizeString(data?.clubName) || `Team ${doc.id}`,
      ownerUid,
      currentLeagueId: normalizeString(data?.leagueId),
      createdAtMillis: timestampToMillis(data?.createdAt),
    });
  }

  return ownedTeams;
}

async function loadSlotInputsForLeague(
  leagueRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  ownedTeams: Map<string, OwnedTeamState>
) {
  const slotsSnap = await leagueRef.collection('slots').get();
  const slots = slotsSnap.docs.map((doc) => {
    const data = doc.data() as any;
    const slotIndex = readSlotIndex(doc);
    const teamId = normalizeString(data?.teamId);
    const kind =
      teamId && ownedTeams.has(teamId)
        ? 'human'
        : teamId || normalizeString(data?.botId)
          ? 'bot'
          : 'empty';
    return {
      slotIndex,
      teamId,
      kind,
    } as MonthlyLeagueResetLeagueInput['slots'][number];
  });

  return slots.sort((a, b) => a.slotIndex - b.slotIndex);
}

function sortOwnedTeams(values: OwnedTeamState[]) {
  return [...values].sort((a, b) => {
    const createdDiff = a.createdAtMillis - b.createdAtMillis;
    if (createdDiff !== 0) return createdDiff;
    return a.teamId.localeCompare(b.teamId);
  });
}

function computeNextLeagueOrdinal(names: string[]) {
  let max = 0;
  for (const name of names) {
    const match = /\b(\d+)\b/.exec(String(name || ''));
    if (!match) continue;
    max = Math.max(max, Number(match[1]) || 0);
  }
  return max + 1;
}

function planKickoffHours(existingHours: number[], count: number) {
  const pool = Array.from(new Set(existingHours.map(parseKickoffHour))).sort((a, b) => a - b);
  const hours = pool.length > 0 ? pool : [DEFAULT_KICKOFF_HOUR_TR];
  const counts = new Map<number, number>();
  hours.forEach((hour) => counts.set(hour, 0));
  existingHours.forEach((hour) => counts.set(parseKickoffHour(hour), (counts.get(parseKickoffHour(hour)) || 0) + 1));

  const assigned: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const nextHour = [...hours].sort((a, b) => {
      const countDiff = (counts.get(a) || 0) - (counts.get(b) || 0);
      return countDiff !== 0 ? countDiff : a - b;
    })[0]!;
    assigned.push(nextHour);
    counts.set(nextHour, (counts.get(nextHour) || 0) + 1);
  }
  return assigned;
}

async function deleteCollectionDocs(
  collectionRef: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>
) {
  while (true) {
    const snap = await collectionRef.limit(MAX_BATCH).get();
    if (snap.empty) break;
    let batch = db.batch();
    let ops = 0;
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      ops += 1;
      if (ops >= MAX_BATCH) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    if (ops > 0) {
      await batch.commit();
    }
  }
}

async function buildSlotStatesForLeague(
  leagueId: string,
  humanTeamIds: string[],
  ownedTeams: Map<string, OwnedTeamState>,
  capacity: number
) {
  const slots: SlotState[] = humanTeamIds.slice(0, capacity).map((teamId, index) => {
    const slotIndex = index + 1;
    const team = ownedTeams.get(teamId);
    return {
      slotIndex,
      type: 'human' as const,
      teamId,
      botId: null,
      fixtureTeamId: teamId,
      displayName: team?.name || `Team ${teamId}`,
    };
  });

  const botSlots = await Promise.all(
    Array.from({ length: Math.max(0, capacity - slots.length) }, async (_, index) => {
      const slotIndex = slots.length + index + 1;
      const botId = syntheticBotId(leagueId, slotIndex);
      const fixtureTeamId = await ensureBotTeamDoc({ botId, slotIndex, name: `Bot ${slotIndex}` });
      return {
        slotIndex,
        type: 'bot' as const,
        teamId: null,
        botId,
        fixtureTeamId: fixtureTeamId || null,
        displayName: `Bot ${slotIndex}`,
      } satisfies SlotState;
    })
  );

  return [...slots, ...botSlots];
}

async function recreateLeagueForReset(input: {
  league: PlannedLeagueWrite;
  ownedTeams: Map<string, OwnedTeamState>;
  startDate: Date;
  monthKey: string;
  capacity: number;
  rounds: number;
  template: ReturnType<typeof generateDoubleRoundRobinSlots>;
}) {
  const { league, ownedTeams, startDate, monthKey, capacity, rounds, template } = input;
  const slots = await buildSlotStatesForLeague(league.leagueId, league.humanTeamIds, ownedTeams, capacity);
  const teamMirror = league.humanTeamIds.map((teamId) => ({
    id: teamId,
    name: ownedTeams.get(teamId)?.name || `Team ${teamId}`,
  }));

  await deleteCollectionDocs(league.ref.collection('fixtures'));
  await deleteCollectionDocs(league.ref.collection('slots'));
  await deleteCollectionDocs(league.ref.collection('standings'));
  await deleteCollectionDocs(league.ref.collection('teams'));

  let batch = db.batch();
  let ops = 0;
  const reminderJobs: Array<{ fixtureId: string; kickoffAt: Date }> = [];

  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  const leaguePayload: Record<string, unknown> = {
    name: league.name,
    season: league.season,
    timezone: league.timezone,
    kickoffHourTR: league.kickoffHourTR,
    capacity,
    state: 'scheduled',
    startDate: Timestamp.fromDate(startDate),
    rounds,
    monthKey,
    lockedAt: FieldValue.serverTimestamp(),
    teams: teamMirror,
    teamCount: teamMirror.length,
    competitionType: 'domestic',
    competitionFormat: 'round_robin',
    hiddenFromLeagueList: false,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (league.isNew) {
    leaguePayload.createdAt = FieldValue.serverTimestamp();
  }

  batch.set(league.ref, leaguePayload, { merge: true });
  ops += 1;

  for (const slot of slots) {
    batch.set(league.ref.collection('slots').doc(String(slot.slotIndex)), {
      slotIndex: slot.slotIndex,
      type: slot.type,
      teamId: slot.teamId,
      botId: slot.botId,
      lockedAt: slot.type === 'human' ? FieldValue.serverTimestamp() : null,
    });
    ops += 1;
    if (ops >= MAX_BATCH) await flush();

    batch.set(league.ref.collection('standings').doc(String(slot.slotIndex)), {
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
    if (ops >= MAX_BATCH) await flush();
  }

  for (const teamId of league.humanTeamIds) {
    const team = ownedTeams.get(teamId);
    batch.set(league.ref.collection('teams').doc(teamId), {
      teamId,
      name: team?.name || `Team ${teamId}`,
      ownerUid: team?.ownerUid || null,
      joinedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    ops += 1;
    if (ops >= MAX_BATCH) await flush();
  }

  const slotMap = new Map<number, string | null>();
  slots.forEach((slot) => {
    slotMap.set(slot.slotIndex, slot.fixtureTeamId);
  });

  for (const fixture of template) {
    const fixtureRef = league.ref.collection('fixtures').doc();
    const kickoffAt = dateForRound(startDate, fixture.round);
    const homeTeamId = slotMap.get(fixture.homeSlot) || null;
    const awayTeamId = slotMap.get(fixture.awaySlot) || null;
    reminderJobs.push({ fixtureId: fixtureRef.id, kickoffAt });
    batch.set(fixtureRef, {
      round: fixture.round,
      date: Timestamp.fromDate(kickoffAt),
      homeSlot: fixture.homeSlot,
      awaySlot: fixture.awaySlot,
      status: 'scheduled',
      score: null,
      homeTeamId,
      awayTeamId,
      participants: [homeTeamId, awayTeamId].filter(Boolean),
    });
    ops += 1;
    if (ops >= MAX_BATCH) await flush();
  }

  await flush();

  const reminders = await enqueueLeagueMatchReminders(league.leagueId, reminderJobs);
  if (reminders.failed > 0) {
    functions.logger.warn('[resetSeasonMonthlyInternal] reminder enqueue partial failure', {
      leagueId: league.leagueId,
      scheduled: reminders.scheduled,
      failed: reminders.failed,
    });
  }
}

async function syncTopLevelTeamLeagueAssignments(input: {
  ownedTeams: Map<string, OwnedTeamState>;
  assignedLeagueByTeamId: Map<string, string>;
  impactedTeamIds: string[];
}) {
  const { ownedTeams, assignedLeagueByTeamId, impactedTeamIds } = input;
  let batch = db.batch();
  let ops = 0;

  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const teamId of impactedTeamIds) {
    if (!ownedTeams.has(teamId)) continue;
    batch.set(db.collection('teams').doc(teamId), {
      leagueId: assignedLeagueByTeamId.get(teamId) || null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    ops += 1;
    if (ops >= MAX_BATCH) await flush();
  }

  await flush();
}

export async function resetSeasonMonthlyInternal(input: ResetSeasonInput = {}) {
  const targetLeagues = await loadLeagues(input.leagueId);
  const { startDate, monthKey: monthKey } = resolveSeasonWindow(input);
  const capacity = resolveLeagueCapacity(input.capacity ?? DEFAULT_MONTHLY_CAPACITY);
  const rounds = roundsForCapacity(capacity);
  const template = generateDoubleRoundRobinSlots(capacity);
  const ownedTeams = await loadOwnedTeamsForReset();
  const targetLeagueIds = new Set(targetLeagues.map((league) => league.id));

  const leagueInputs: MonthlyLeagueResetLeagueInput[] = [];
  const impactedTeamIds = new Set<string>();

  for (const leagueDoc of targetLeagues) {
    const slots = await loadSlotInputsForLeague(leagueDoc.ref, ownedTeams);
    const slotHumanIds = new Set(
      slots
        .filter((slot) => slot.kind === 'human' && slot.teamId)
        .map((slot) => slot.teamId as string)
    );
    slotHumanIds.forEach((teamId) => impactedTeamIds.add(teamId));

    const extraHumanTeamIds = sortOwnedTeams(
      [...ownedTeams.values()].filter((team) => team.currentLeagueId === leagueDoc.id && !slotHumanIds.has(team.teamId))
    ).map((team) => team.teamId);
    extraHumanTeamIds.forEach((teamId) => impactedTeamIds.add(teamId));

    leagueInputs.push({
      leagueId: leagueDoc.id,
      slots,
      extraHumanTeamIds,
    });
  }

  const targetedReset = Boolean(input.leagueId);
  const explicitlyPlannedHumanIds = new Set(
    leagueInputs.flatMap((league) => [
      ...league.slots.filter((slot) => slot.kind === 'human' && slot.teamId).map((slot) => slot.teamId as string),
      ...(league.extraHumanTeamIds || []),
    ])
  );

  const unassignedHumanTeamIds = sortOwnedTeams([...ownedTeams.values()])
    .filter((team) => !explicitlyPlannedHumanIds.has(team.teamId))
    .filter((team) => !targetedReset || (team.currentLeagueId != null && targetLeagueIds.has(team.currentLeagueId)))
    .map((team) => team.teamId);
  unassignedHumanTeamIds.forEach((teamId) => impactedTeamIds.add(teamId));

  const resetPlan = buildMonthlyLeagueResetPlan({
    capacity,
    leagues: leagueInputs,
    unassignedHumanTeamIds,
  });

  const existingLeagueMetas: ExistingLeagueMeta[] = targetLeagues.map((leagueDoc) => {
    const data = leagueDoc.data() as any;
    return {
      leagueId: leagueDoc.id,
      ref: leagueDoc.ref,
      name: normalizeString(data?.name) || `Lig ${leagueDoc.id.slice(0, 6)}`,
      season: Number(data?.season || 1),
      timezone: normalizeString(data?.timezone) || DEFAULT_TIMEZONE,
      kickoffHourTR: parseKickoffHour(data?.kickoffHourTR),
      createdAtMillis: timestampToMillis(data?.createdAt),
    };
  });

  const plannedLeagues: PlannedLeagueWrite[] = existingLeagueMetas.map((meta, index) => ({
    leagueId: meta.leagueId,
    ref: meta.ref,
    name: meta.name,
    season: meta.season,
    timezone: meta.timezone,
    kickoffHourTR: meta.kickoffHourTR,
    humanTeamIds: resetPlan.existingLeagues[index]?.humanTeamIds || [],
    isNew: false,
  }));

  if (resetPlan.newLeagues.length > 0) {
    const allLeagueDocs = await db.collection('leagues').get();
    const allLeagueNames = allLeagueDocs.docs.map((doc) => String((doc.data() as any)?.name || ''));
    const nextOrdinal = computeNextLeagueOrdinal(allLeagueNames);
    const kickoffHours = planKickoffHours(
      allLeagueDocs.docs.map((doc) => parseKickoffHour((doc.data() as any)?.kickoffHourTR)),
      resetPlan.newLeagues.length
    );
    const baseSeason = existingLeagueMetas[0]?.season ?? 1;
    const baseTimezone = existingLeagueMetas[0]?.timezone || DEFAULT_TIMEZONE;

    resetPlan.newLeagues.forEach((newLeague, index) => {
      const ref = db.collection('leagues').doc();
      plannedLeagues.push({
        leagueId: ref.id,
        ref,
        name: `Lig ${nextOrdinal + index}`,
        season: baseSeason,
        timezone: baseTimezone,
        kickoffHourTR: kickoffHours[index] || DEFAULT_KICKOFF_HOUR_TR,
        humanTeamIds: newLeague.humanTeamIds,
        isNew: true,
      });
    });
  }

  const assignedLeagueByTeamId = new Map<string, string>();
  plannedLeagues.forEach((league) => {
    league.humanTeamIds.forEach((teamId) => {
      assignedLeagueByTeamId.set(teamId, league.leagueId);
    });
  });

  for (const league of plannedLeagues) {
    await recreateLeagueForReset({
      league,
      ownedTeams,
      startDate,
      monthKey,
      capacity,
      rounds,
      template,
    });
  }

  await syncTopLevelTeamLeagueAssignments({
    ownedTeams,
    assignedLeagueByTeamId,
    impactedTeamIds: [...impactedTeamIds],
  });

  return {
    processed: plannedLeagues.length,
    existingLeagues: resetPlan.existingLeagues.length,
    createdLeagues: resetPlan.newLeagues.length,
    humanTeams: resetPlan.assignedHumanTeamIds.length,
    capacity,
    rounds,
    startDate: startDate.toISOString(),
    monthKey,
  };
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
