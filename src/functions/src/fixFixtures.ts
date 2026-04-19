import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { FieldPath, FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { requireAppCheck, requireAuth } from './mw/auth.js';
import { generateDoubleRoundRobinSlots } from './utils/roundrobin.js';
import { dateForRound } from './utils/time.js';
import { nextDayAtTR } from './utils/schedule.js';
import { alignLeagueStartDate, normalizeLeagueKickoffHour } from './utils/leagueKickoff.js';
import { planFixtureCalendarRepair } from './utils/leagueFixtureCalendar.js';
import { ensureBotTeamDoc } from './utils/bots.js';
import { ensureLeagueTeamDocs } from './utils/leagueTeams.js';
import { enqueueLeagueMatchReminders } from './notify/matchReminder.js';

const db = getFirestore();
const REGION = 'europe-west1';
const ADMIN_SECRET = (functions.config() as any)?.admin?.secret || '';
const MAX_BATCH = 450;

interface SlotInfo {
  slotIndex: number;
  teamId: string | null;
  botId?: string | null;
}

interface RebuildOptions {
  force?: boolean;
  dryRun?: boolean;
}

interface RebuildResult {
  leagueId: string;
  created: number;
  deleted: number;
  rounds: number;
  startDate: string;
  source: 'slots' | 'teams';
  error?: string;
}

interface RepairFixtureCalendarOptions {
  competitionType?: string | null;
  dryRun?: boolean;
  includePlayed?: boolean;
  leagueId?: string | null;
  monthKey?: string | null;
  now?: Date;
}

interface FixtureCalendarRepairReportEntry {
  action: 'played_date_only' | 'skip_active' | 'skip_played' | 'unplayed_reset';
  actualDate: string | null;
  canonicalDate: string | null;
  driftKind: string | null;
  fixtureId: string;
  leagueId: string;
  leagueName: string | null;
  round: number | null;
  status: string;
}

interface RepairFixtureCalendarResult {
  competitionType: string;
  driftedFixtures: number;
  dryRun: boolean;
  includePlayed: boolean;
  invalidFixtures: number;
  monthKey: string | null;
  repairedFixtures: number;
  repairedPlayed: number;
  repairedUnplayed: number;
  repairs: FixtureCalendarRepairReportEntry[];
  scannedFixtures: number;
  scannedLeagues: number;
  skippedActive: number;
  skippedPlayed: number;
  targetLeagueId: string | null;
}

function pickStartDate(data: any): Date {
  const kickoffHour = normalizeLeagueKickoffHour(data?.kickoffHourTR);
  const raw = data?.startDate;
  if (raw && typeof raw.toDate === 'function') {
    const startDate = raw.toDate();
    return kickoffHour != null ? alignLeagueStartDate(startDate, kickoffHour) : startDate;
  }
  if (typeof raw === 'string') {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return kickoffHour != null ? alignLeagueStartDate(parsed, kickoffHour) : parsed;
    }
  }
  return nextDayAtTR(kickoffHour ?? 19);
}

function parseAdminBoolean(raw: unknown, fallback = false) {
  if (raw == null || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
}

function normalizeCompetitionTypeFilter(value: unknown) {
  const normalized = String(value || 'domestic').trim().toLowerCase();
  if (!normalized) return 'domestic';
  if (normalized === 'domestic_league') return 'domestic';
  return normalized;
}

function assertMonthKey(raw: unknown) {
  if (raw == null || raw === '') return null;
  const normalized = String(raw).trim();
  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    throw new functions.https.HttpsError('invalid-argument', 'monthKey must be YYYY-MM');
  }
  return normalized;
}

function buildPlayedFixtureCalendarPatch(canonicalDate: Date) {
  return {
    date: Timestamp.fromDate(canonicalDate),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function buildUnplayedFixtureCalendarPatch(canonicalDate: Date) {
  return {
    date: Timestamp.fromDate(canonicalDate),
    status: 'scheduled',
    score: null,
    replayPath: FieldValue.delete(),
    video: FieldValue.delete(),
    videoMissing: FieldValue.delete(),
    videoError: FieldValue.delete(),
    failReason: FieldValue.delete(),
    failedAt: FieldValue.delete(),
    startedAt: FieldValue.delete(),
    endedAt: FieldValue.delete(),
    playedAt: FieldValue.delete(),
    live: FieldValue.delete(),
    recovery: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function loadFixtureCalendarRepairLeagueDocs(input: RepairFixtureCalendarOptions) {
  const leagueId = String(input.leagueId || '').trim();
  if (leagueId) {
    const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
    if (!leagueSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'League not found');
    }
    return [leagueSnap];
  }

  let query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db.collection('leagues');
  const monthKey = assertMonthKey(input.monthKey ?? '2026-04');
  const competitionType = normalizeCompetitionTypeFilter(input.competitionType);
  if (monthKey) {
    query = query.where('monthKey', '==', monthKey);
  }
  if (competitionType) {
    query = query.where('competitionType', '==', competitionType);
  }
  return (await query.get()).docs;
}

export async function repairLeagueFixtureCalendarInternal(
  input: RepairFixtureCalendarOptions = {},
): Promise<RepairFixtureCalendarResult> {
  const now =
    input.now instanceof Date && !Number.isNaN(input.now.getTime()) ? input.now : new Date();
  const dryRun = input.dryRun === true;
  const includePlayed = input.includePlayed !== false;
  const monthKey = assertMonthKey(input.monthKey ?? '2026-04');
  const competitionType = normalizeCompetitionTypeFilter(input.competitionType);
  const leagueDocs = await loadFixtureCalendarRepairLeagueDocs({
    ...input,
    competitionType,
    monthKey,
  });

  const repairs: FixtureCalendarRepairReportEntry[] = [];
  let scannedLeagues = 0;
  let scannedFixtures = 0;
  let driftedFixtures = 0;
  let repairedFixtures = 0;
  let repairedPlayed = 0;
  let repairedUnplayed = 0;
  let skippedActive = 0;
  let skippedPlayed = 0;
  let invalidFixtures = 0;
  let batch = db.batch();
  let ops = 0;

  const commitBatch = async () => {
    if (dryRun || ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const leagueDoc of leagueDocs) {
    scannedLeagues += 1;
    const league = leagueDoc.data() as any;
    const fixturesSnap = await leagueDoc.ref.collection('fixtures').get();

    for (const fixtureDoc of fixturesSnap.docs) {
      scannedFixtures += 1;
      const fixture = fixtureDoc.data() as any;
      const plan = planFixtureCalendarRepair({
        fixture,
        includePlayed,
        league,
        now,
      });

      if (plan.action === 'invalid') {
        invalidFixtures += 1;
        continue;
      }
      if (plan.action === 'noop') {
        continue;
      }

      driftedFixtures += 1;
      repairs.push({
        action: plan.action,
        actualDate: plan.actualDate?.toISOString() || null,
        canonicalDate: plan.canonicalDate?.toISOString() || null,
        driftKind: plan.driftKind,
        fixtureId: fixtureDoc.id,
        leagueId: leagueDoc.id,
        leagueName: typeof league?.name === 'string' ? league.name : null,
        round: plan.round,
        status: plan.status,
      });

      if (plan.action === 'skip_active') {
        skippedActive += 1;
        continue;
      }
      if (plan.action === 'skip_played') {
        skippedPlayed += 1;
        continue;
      }
      if (!plan.canonicalDate) {
        invalidFixtures += 1;
        continue;
      }

      repairedFixtures += 1;
      if (plan.action === 'played_date_only') {
        repairedPlayed += 1;
      } else {
        repairedUnplayed += 1;
      }

      if (!dryRun) {
        batch.update(
          fixtureDoc.ref,
          plan.action === 'played_date_only'
            ? buildPlayedFixtureCalendarPatch(plan.canonicalDate)
            : buildUnplayedFixtureCalendarPatch(plan.canonicalDate),
        );
        ops += 1;
        if (ops >= MAX_BATCH) {
          await commitBatch();
        }
      }
    }
  }

  await commitBatch();

  repairs.sort((left, right) => {
    const leftDate = left.canonicalDate || left.actualDate || '';
    const rightDate = right.canonicalDate || right.actualDate || '';
    if (leftDate !== rightDate) {
      return leftDate.localeCompare(rightDate);
    }
    if (left.leagueId !== right.leagueId) {
      return left.leagueId.localeCompare(right.leagueId);
    }
    return left.fixtureId.localeCompare(right.fixtureId);
  });

  return {
    competitionType,
    driftedFixtures,
    dryRun,
    includePlayed,
    invalidFixtures,
    monthKey,
    repairedFixtures,
    repairedPlayed,
    repairedUnplayed,
    repairs,
    scannedFixtures,
    scannedLeagues,
    skippedActive,
    skippedPlayed,
    targetLeagueId: String(input.leagueId || '').trim() || null,
  };
}

async function deleteExistingFixtures(
  leagueRef: FirebaseFirestore.DocumentReference
): Promise<number> {
  let deleted = 0;
  const fixturesRef = leagueRef.collection('fixtures');
  // Loop in chunks to avoid exceeding limits
  while (true) {
    const snap = await fixturesRef.limit(MAX_BATCH).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.delete(doc.ref);
      deleted++;
    });
    await batch.commit();
  }
  return deleted;
}

async function loadParticipants(
  leagueRef: FirebaseFirestore.DocumentReference
): Promise<{ slots: SlotInfo[]; source: 'slots' | 'teams' }> {
  const slotSnap = await leagueRef.collection('slots').orderBy('slotIndex', 'asc').get();
  if (!slotSnap.empty) {
    const slots = slotSnap.docs
      .map((doc) => {
        const data = doc.data() as any;
        const slotIndex =
          typeof data.slotIndex === 'number'
            ? data.slotIndex
            : Number(doc.id) || 0;
        return {
          slotIndex,
          teamId: (data.teamId as string | undefined) || null,
          botId: (data.botId as string | undefined) || null,
        } as SlotInfo;
      })
      .filter((s) => s.slotIndex > 0)
      .sort((a, b) => a.slotIndex - b.slotIndex);
    return { slots, source: 'slots' };
  }

  const teamsSnap = await leagueRef.collection('teams').get();
  const slots = teamsSnap.docs
    .map((doc, idx) => ({
      slotIndex: idx + 1,
      teamId: doc.id,
      botId: null,
    }))
    .sort((a, b) => a.slotIndex - b.slotIndex);
  return { slots, source: 'teams' };
}

function ensureEvenSlots(slots: SlotInfo[]): SlotInfo[] {
  if (slots.length % 2 === 0) return slots;
  const maxIndex = slots.reduce((max, slot) => Math.max(max, slot.slotIndex), 0);
  const fillerIndex = maxIndex + 1;
  return [
    ...slots,
    {
      slotIndex: fillerIndex,
      teamId: null,
      botId: `bot-auto-${fillerIndex}`,
    },
  ];
}

async function rebuildFixturesForLeague(
  leagueId: string,
  opts: RebuildOptions = {}
): Promise<RebuildResult> {
  const leagueRef = db.collection('leagues').doc(leagueId);
  const snap = await leagueRef.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'League not found');
  }
  const league = snap.data() as any;
  const { slots: rawSlots, source } = await loadParticipants(leagueRef);
  if (rawSlots.length < 2) {
    throw new functions.https.HttpsError('failed-precondition', 'At least two slots required');
  }
  const slots = ensureEvenSlots(rawSlots);
  const slotOrder = slots.map((slot) => slot.slotIndex);
  const slotMap = new Map<number, SlotInfo>();
  for (const slot of slots) {
    let teamId = slot.teamId || null;
    if (!teamId && slot.botId) {
      teamId = await ensureBotTeamDoc({ botId: slot.botId, slotIndex: slot.slotIndex });
    }
    slotMap.set(slot.slotIndex, { ...slot, teamId });
  }
  const leagueTeamIds = Array.from(
    new Set(
      Array.from(slotMap.values())
        .map((slot) => slot.teamId)
        .filter((teamId): teamId is string => Boolean(teamId))
    )
  );
  await ensureLeagueTeamDocs(leagueId, leagueTeamIds);

  const template = generateDoubleRoundRobinSlots(slotOrder.length);
  if (template.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Unable to build fixture template');
  }

  let deleted = 0;
  if (opts.force !== false) {
    deleted = await deleteExistingFixtures(leagueRef);
  }

  if (opts.dryRun) {
    return {
      leagueId,
      created: 0,
      deleted,
      rounds: template[template.length - 1]?.round || 0,
      startDate: pickStartDate(league).toISOString(),
      source,
    };
  }

  const startDate = pickStartDate(league);
  let batch = db.batch();
  let ops = 0;
  let created = 0;
  const reminderJobs: Array<{ fixtureId: string; kickoffAt: Date }> = [];

  for (const match of template) {
    const realHomeSlot = slotOrder[match.homeSlot - 1];
    const realAwaySlot = slotOrder[match.awaySlot - 1];
    if (!realHomeSlot || !realAwaySlot) continue;
    const homeInfo = slotMap.get(realHomeSlot);
    const awayInfo = slotMap.get(realAwaySlot);
    const date = dateForRound(startDate, match.round);
    const ref = leagueRef.collection('fixtures').doc();
    reminderJobs.push({ fixtureId: ref.id, kickoffAt: date });
    batch.set(ref, {
      round: match.round,
      date: Timestamp.fromDate(date),
      homeSlot: realHomeSlot,
      awaySlot: realAwaySlot,
      status: 'scheduled',
      score: null,
      homeTeamId: homeInfo?.teamId || null,
      awayTeamId: awayInfo?.teamId || null,
      participants: [homeInfo?.teamId, awayInfo?.teamId].filter(Boolean),
    });
    created++;
    ops++;
    if (ops >= MAX_BATCH) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) {
    await batch.commit();
  }

  const reminders = await enqueueLeagueMatchReminders(leagueId, reminderJobs);
  if (reminders.failed > 0) {
    functions.logger.warn('[rebuildFixturesForLeague] reminder enqueue partial failure', {
      leagueId,
      scheduled: reminders.scheduled,
      failed: reminders.failed,
    });
  }

  const totalRounds = template[template.length - 1]?.round || 0;
  if (league.rounds !== totalRounds) {
    await leagueRef.set({ rounds: totalRounds }, { merge: true });
  }

  return {
    leagueId,
    created,
    deleted,
    rounds: totalRounds,
    startDate: startDate.toISOString(),
    source,
  };
}

export const rebuildDailyFixtures = functions
  .region(REGION)
  .https.onCall(async (request) => {
    requireAppCheck(request as any);
    requireAuth(request as any);
    const leagueId: string | undefined = (request.data as any)?.leagueId;
    const force = (request.data as any)?.force;
    const dryRun = (request.data as any)?.dryRun;
    if (!leagueId) {
      throw new functions.https.HttpsError('invalid-argument', 'leagueId required');
    }
    const result = await rebuildFixturesForLeague(leagueId, { force, dryRun });
    return { ok: true, ...result };
  });

export const rebuildDailyFixturesHttp = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    const authHeader = (req.headers.authorization as string) || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const leagueId = (req.body?.leagueId as string) || (req.query?.leagueId as string);
    if (!leagueId) {
      res.status(400).json({ error: 'leagueId required' });
      return;
    }
    const force = req.body?.force ?? req.query?.force;
    const dryRun = req.body?.dryRun ?? req.query?.dryRun;
    try {
      const result = await rebuildFixturesForLeague(leagueId, {
        force: force !== 'false' && force !== false,
        dryRun: dryRun === 'true' || dryRun === true,
      });
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'internal' });
    }
  });

export const rebuildAllDailyFixturesHttp = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    const authHeader = (req.headers.authorization as string) || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const stateFilter =
      (req.body?.states as string[]) ||
      (typeof req.query?.states === 'string'
        ? (req.query.states as string).split(',').map((s) => s.trim()).filter(Boolean)
        : ['scheduled', 'active']);
    const force = req.body?.force ?? req.query?.force;
    const cursor = (req.body?.cursor as string) || (req.query?.cursor as string) || '';
    const limitRaw = Number(req.body?.limit ?? req.query?.limit ?? 20);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 50) : 20;

    let query = db
      .collection('leagues')
      .where('state', 'in', stateFilter.length > 0 ? stateFilter : ['scheduled', 'active'])
      .orderBy(FieldPath.documentId())
      .limit(limit);

    if (cursor) {
      query = query.startAfter(cursor);
    }

    const leaguesSnap = await query.get();
    const reports: RebuildResult[] = [];
    for (const doc of leaguesSnap.docs) {
      try {
        const result = await rebuildFixturesForLeague(doc.id, {
          force: force !== 'false' && force !== false,
        });
        reports.push(result);
      } catch (err: any) {
        reports.push({
          leagueId: doc.id,
          created: 0,
          deleted: 0,
          rounds: doc.data()?.rounds || 0,
          startDate: pickStartDate(doc.data()).toISOString(),
          source: 'slots',
          error: err?.message || 'failed',
        });
        functions.logger.error('[rebuildAllDailyFixtures] failed', {
          leagueId: doc.id,
          error: err?.message,
        });
      }
    }
    const lastDoc = leaguesSnap.docs[leaguesSnap.docs.length - 1];
    const nextCursor = leaguesSnap.docs.length === limit ? lastDoc?.id : null;
    res.json({
      ok: true,
      processed: reports.length,
      reports,
      nextCursor,
      hasMore: Boolean(nextCursor),
    });
  });

export const repairLeagueFixtureCalendarHttp = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed' });
      return;
    }
    const authHeader = (req.headers.authorization as string) || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    try {
      const body =
        typeof req.body === 'string'
          ? JSON.parse(req.body || '{}')
          : ((req.body || {}) as Record<string, unknown>);
      const result = await repairLeagueFixtureCalendarInternal({
        competitionType: body.competitionType ?? req.query?.competitionType ?? 'domestic',
        dryRun: parseAdminBoolean(body.dryRun ?? req.query?.dryRun, true),
        includePlayed: parseAdminBoolean(body.includePlayed ?? req.query?.includePlayed, true),
        leagueId: (body.leagueId as string) || (req.query?.leagueId as string) || null,
        monthKey: (body.monthKey as string) || (req.query?.monthKey as string) || '2026-04',
      });
      res.json({ ok: true, ...result });
    } catch (error: any) {
      const message = error instanceof functions.https.HttpsError
        ? error.message
        : error?.message || 'internal';
      const status = error instanceof functions.https.HttpsError
        ? (error.httpErrorCode.status || 400)
        : 500;
      res.status(status).json({ ok: false, error: message });
    }
  });
