import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { addMonths, endOfMonth } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { getFirestore, FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { enqueueLeagueMatchReminder } from './notify/matchReminder.js';
import {
  buildChampionsLeagueKnockoutPlan,
  estimatePlanSideStrength,
  resolveDeterministicPenaltyShootout,
  resolveScheduledAtFromSources,
  type ChampionsLeagueKnockoutMatchPlan,
  type ChampionsLeagueParticipantSeed,
} from './utils/championsLeague.js';
import { isChampionsLeagueCompetition, isDomesticCompetition } from './utils/competition.js';
import { monthKeyTR, monthStartAt19TR } from './utils/time.js';

const db = getFirestore();
const REGION = 'europe-west1';
const TZ = 'Europe/Istanbul';
const CHAMPIONS_LEAGUE_KICKOFF_HOUR = 11;
const CHAMPIONS_LEAGUE_ROUND_SPACING_DAYS = 2;
const ADMIN_SECRET =
  (functions.config() as any)?.admin?.secret ||
  (functions.config() as any)?.scheduler?.secret ||
  (functions.config() as any)?.orchestrate?.secret ||
  '';

type BootstrapChampionsLeagueInput = {
  targetMonth?: string;
  baseDate?: Date;
  force?: boolean;
};

type SyncChampionsLeagueInput = {
  leagueId?: string;
  matchId?: string;
  fixtureId?: string;
};

type KnockoutMatchDoc = ChampionsLeagueKnockoutMatchPlan & {
  fixtureId?: string | null;
};

function normalizeString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRequestBody(req: functions.https.Request) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (req.body || {}) as Record<string, unknown>;
}

function readAdminSecret(req: functions.https.Request) {
  const authz = (req.headers.authorization as string) || '';
  const bearer = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  const headerSecret = (req.headers['x-admin-secret'] as string) || '';
  return bearer || headerSecret;
}

function requireAdminSecret(req: functions.https.Request, res: functions.Response<any>) {
  const providedSecret = readAdminSecret(req);
  if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
    res.status(401).json({ ok: false, error: 'Invalid admin secret' });
    return false;
  }
  return true;
}

function applyCors(req: functions.https.Request, res: functions.Response<any>) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-admin-secret');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

function resolveTargetMonth(baseDate: Date) {
  return monthKeyTR(addMonths(baseDate, 1));
}

function isLastDayOfMonthTR(baseDate: Date) {
  const day = formatInTimeZone(baseDate, TZ, 'yyyy-MM-dd');
  const endDay = formatInTimeZone(endOfMonth(baseDate), TZ, 'yyyy-MM-dd');
  return day === endDay;
}

function competitionDocId(targetMonth: string) {
  return `champions-league-${targetMonth}`;
}

function normalizeScore(raw: any): { home: number; away: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.home === 'number' && typeof raw.away === 'number') {
    return { home: raw.home, away: raw.away };
  }
  if (typeof raw.h === 'number' && typeof raw.a === 'number') {
    return { home: raw.h, away: raw.a };
  }
  return null;
}

function matchStatusFromFixtureStatus(value: unknown): KnockoutMatchDoc['status'] {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'played') return 'completed';
  if (normalized === 'running') return 'running';
  if (normalized === 'failed') return 'failed';
  if (normalized === 'scheduled') return 'scheduled';
  return 'pending';
}

function timestampToDate(value: unknown): Date | null {
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  return null;
}

function resolveFixtureCompletionDate(fixture: Record<string, unknown>) {
  return (
    timestampToDate(fixture.playedAt) ||
    timestampToDate(fixture.endedAt) ||
    new Date()
  );
}

async function loadCompetitionLeague(leagueId: string) {
  const snap = await db.doc(`leagues/${leagueId}`).get();
  if (!snap.exists) {
    return null;
  }
  const data = snap.data() as Record<string, unknown>;
  if (!isChampionsLeagueCompetition(data)) {
    return null;
  }
  return { ref: snap.ref, data };
}

async function loadCompetitionContext(leagueId: string) {
  const league = await loadCompetitionLeague(leagueId);
  if (!league) {
    return null;
  }

  const [entrantsSnap, matchesSnap] = await Promise.all([
    league.ref.collection('entrants').get(),
    league.ref.collection('knockoutMatches').get(),
  ]);

  const entrants = new Map<string, ChampionsLeagueParticipantSeed>();
  entrantsSnap.docs.forEach((doc) => {
    entrants.set(doc.id, {
      ...(doc.data() as ChampionsLeagueParticipantSeed),
      teamId: doc.id,
    });
  });

  const matches = matchesSnap.docs
    .map((doc) => {
      const data = doc.data() as Omit<KnockoutMatchDoc, 'id'> & {
        scheduledAt?: unknown;
        resolvedAt?: unknown;
      };
      return {
        id: doc.id,
        ...data,
        scheduledAt: timestampToDate(data.scheduledAt) ?? new Date(String(data.scheduledAt)),
        resolvedAt: timestampToDate(data.resolvedAt),
      };
    })
    .sort((left, right) => left.round - right.round || left.slot - right.slot);

  const matchesById = new Map<string, KnockoutMatchDoc>();
  matches.forEach((match) => matchesById.set(match.id, match));

  return { league, entrants, matches, matchesById };
}

async function resolveDomesticChampions(): Promise<ChampionsLeagueParticipantSeed[]> {
  const leaguesSnap = await db.collection('leagues').get();
  const domesticLeagues = leaguesSnap.docs.filter((doc) => isDomesticCompetition(doc.data() as Record<string, unknown>));
  const participantRows: ChampionsLeagueParticipantSeed[] = [];

  for (const leagueDoc of domesticLeagues) {
    const leagueData = leagueDoc.data() as Record<string, unknown>;
    const standingsSnap = await leagueDoc.ref.collection('standings').get();
    if (standingsSnap.empty) continue;

    const rows = standingsSnap.docs
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        return {
          teamId: normalizeString(data.teamId),
          name: normalizeString(data.name),
          points: Number(data.Pts ?? 0),
          goalDifference: Number(data.GD ?? 0),
          scored: Number(data.GF ?? 0),
        };
      })
      .filter((row) => row.teamId)
      .sort((left, right) => {
        if (right.points !== left.points) return right.points - left.points;
        if (right.goalDifference !== left.goalDifference) return right.goalDifference - left.goalDifference;
        if (right.scored !== left.scored) return right.scored - left.scored;
        return String(left.name || left.teamId).localeCompare(String(right.name || right.teamId));
      });

    if (rows.length === 0) continue;

    const teamDocs = await Promise.all(rows.map((row) => db.doc(`teams/${row.teamId}`).get()));
    const firstHuman = teamDocs
      .map((snap, index) => {
        const data = snap.exists ? (snap.data() as Record<string, unknown>) : null;
        return {
          row: rows[index]!,
          team: data,
        };
      })
      .find((entry) => normalizeString(entry.team?.ownerUid));

    if (!firstHuman) continue;

    participantRows.push({
      teamId: firstHuman.row.teamId!,
      teamName:
        normalizeString(firstHuman.team?.name) ||
        normalizeString(firstHuman.team?.clubName) ||
        firstHuman.row.name ||
        firstHuman.row.teamId!,
      leagueId: leagueDoc.id,
      leagueName: normalizeString(leagueData.name) || leagueDoc.id,
      leaguePosition: 1,
      points: firstHuman.row.points,
      goalDifference: firstHuman.row.goalDifference,
      scored: firstHuman.row.scored,
      ownerUid: normalizeString(firstHuman.team?.ownerUid),
      logo: normalizeString(firstHuman.team?.logo),
    });
  }

  return participantRows;
}

type ResolvedTeamInfo = {
  teamId: string | null;
  teamName: string | null;
  leagueId: string | null;
  leagueName: string | null;
  resolvedAt: Date | null;
};

function resolveTeamInfoForMatch(
  match: KnockoutMatchDoc,
  entrants: Map<string, ChampionsLeagueParticipantSeed>,
  matchesById: Map<string, KnockoutMatchDoc>,
  side: 'home' | 'away',
): ResolvedTeamInfo {
  const directTeamId = side === 'home' ? match.homeTeamId : match.awayTeamId;
  const directTeamName = side === 'home' ? match.homeTeamName : match.awayTeamName;
  const directLeagueId = side === 'home' ? match.homeLeagueId : match.awayLeagueId;
  const directLeagueName = side === 'home' ? match.homeLeagueName : match.awayLeagueName;
  const sourceMatchId = side === 'home' ? match.homeSourceMatchId : match.awaySourceMatchId;
  const seed = side === 'home' ? match.homeSeed : match.awaySeed;

  if (directTeamId) {
    return {
      teamId: directTeamId,
      teamName: directTeamName ?? entrants.get(directTeamId)?.teamName ?? directTeamId,
      leagueId: directLeagueId ?? entrants.get(directTeamId)?.leagueId ?? null,
      leagueName: directLeagueName ?? entrants.get(directTeamId)?.leagueName ?? null,
      resolvedAt: match.resolvedAt ?? null,
    };
  }

  if (seed != null) {
    const seeded = [...entrants.values()].find((entry) => entry.seed === seed);
    if (seeded) {
      return {
        teamId: seeded.teamId,
        teamName: seeded.teamName,
        leagueId: seeded.leagueId,
        leagueName: seeded.leagueName,
        resolvedAt: match.resolvedAt ?? null,
      };
    }
  }

  if (sourceMatchId) {
    const source = matchesById.get(sourceMatchId);
    if (source?.winnerTeamId) {
      return {
        teamId: source.winnerTeamId,
        teamName: source.winnerTeamName ?? entrants.get(source.winnerTeamId)?.teamName ?? source.winnerTeamId,
        leagueId: entrants.get(source.winnerTeamId)?.leagueId ?? null,
        leagueName: entrants.get(source.winnerTeamId)?.leagueName ?? null,
        resolvedAt: source.resolvedAt ?? null,
      };
    }
  }

  return {
    teamId: null,
    teamName: null,
    leagueId: null,
    leagueName: null,
    resolvedAt: null,
  };
}

async function maybeCreateFixtureForMatch(input: {
  competitionRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  competitionData: Record<string, unknown>;
  match: KnockoutMatchDoc;
  home: ResolvedTeamInfo;
  away: ResolvedTeamInfo;
  scheduledAt: Date;
}) {
  const { competitionRef, competitionData, match, home, away, scheduledAt } = input;
  if (!home.teamId || !away.teamId) {
    return null;
  }

  if (match.fixtureId) {
    return match.fixtureId;
  }

  const existing = await competitionRef
    .collection('fixtures')
    .where('competitionMatchId', '==', match.id)
    .limit(1)
    .get();
  if (!existing.empty) {
    return existing.docs[0]!.id;
  }

  const fixtureRef = competitionRef.collection('fixtures').doc();
  await fixtureRef.set({
    round: match.round,
    date: Timestamp.fromDate(scheduledAt),
    status: 'scheduled',
    score: null,
    homeTeamId: home.teamId,
    awayTeamId: away.teamId,
    participants: [home.teamId, away.teamId],
    seasonId: normalizeString(competitionData.seasonId) || normalizeString(competitionData.sourceMonth) || 'default',
    competitionType: 'champions_league',
    competitionName: 'Şampiyonlar Ligi',
    competitionMatchId: match.id,
    competitionRound: match.round,
  });
  await enqueueLeagueMatchReminder(competitionRef.id, fixtureRef.id, scheduledAt).catch((error: any) => {
    functions.logger.warn('[championsLeague] reminder enqueue failed', {
      leagueId: competitionRef.id,
      fixtureId: fixtureRef.id,
      error: error?.message || String(error),
    });
  });
  return fixtureRef.id;
}

async function clearCompetitionSubcollection(
  collection: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>,
) {
  while (true) {
    const snap = await collection.limit(400).get();
    if (snap.empty) return;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

async function replaceCompetitionPlan(
  competitionRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  plan: ReturnType<typeof buildChampionsLeagueKnockoutPlan>,
  targetMonth: string,
) {
  await clearCompetitionSubcollection(competitionRef.collection('fixtures'));
  await clearCompetitionSubcollection(competitionRef.collection('knockoutMatches'));
  await clearCompetitionSubcollection(competitionRef.collection('entrants'));

  for (const participant of plan.participants) {
    await competitionRef.collection('entrants').doc(participant.teamId).set({
      ...participant,
      sourceMonth: targetMonth,
    });
  }

  for (const round of plan.rounds) {
    for (const match of round) {
      await competitionRef.collection('knockoutMatches').doc(match.id).set({
        ...match,
        fixtureId: null,
        scheduledAt: Timestamp.fromDate(match.scheduledAt),
        resolvedAt: match.resolvedAt ? Timestamp.fromDate(match.resolvedAt) : null,
      });
    }
  }
}

async function materializeReadyChampionsLeagueMatches(leagueId: string) {
  const context = await loadCompetitionContext(leagueId);
  if (!context) {
    return { updatedMatches: 0, createdFixtures: 0, championTeamId: null as string | null };
  }

  const { league, entrants, matches, matchesById } = context;
  const kickoffHour = Number(league.data.kickoffHourTR ?? CHAMPIONS_LEAGUE_KICKOFF_HOUR) || CHAMPIONS_LEAGUE_KICKOFF_HOUR;
  const roundSpacingDays = Number(league.data.roundSpacingDays ?? CHAMPIONS_LEAGUE_ROUND_SPACING_DAYS) || CHAMPIONS_LEAGUE_ROUND_SPACING_DAYS;

  let updatedMatches = 0;
  let createdFixtures = 0;
  let changed = true;

  while (changed) {
    changed = false;

    for (const match of matches) {
      const home = resolveTeamInfoForMatch(match, entrants, matchesById, 'home');
      const away = resolveTeamInfoForMatch(match, entrants, matchesById, 'away');
      const latestResolvedAt =
        home.resolvedAt && away.resolvedAt
          ? (home.resolvedAt.getTime() > away.resolvedAt.getTime() ? home.resolvedAt : away.resolvedAt)
          : (home.resolvedAt || away.resolvedAt);
      const scheduledAt = resolveScheduledAtFromSources({
        nominalScheduledAt: timestampToDate(match.scheduledAt) || new Date(match.scheduledAt),
        latestResolvedAt,
        kickoffHour,
        roundSpacingDays,
        timezone: TZ,
      });

      const patch: Record<string, unknown> = {};
      if ((match.homeTeamId || null) !== home.teamId) patch.homeTeamId = home.teamId;
      if ((match.awayTeamId || null) !== away.teamId) patch.awayTeamId = away.teamId;
      if ((match.homeTeamName || null) !== home.teamName) patch.homeTeamName = home.teamName;
      if ((match.awayTeamName || null) !== away.teamName) patch.awayTeamName = away.teamName;
      if ((match.homeLeagueId || null) !== home.leagueId) patch.homeLeagueId = home.leagueId;
      if ((match.awayLeagueId || null) !== away.leagueId) patch.awayLeagueId = away.leagueId;
      if ((match.homeLeagueName || null) !== home.leagueName) patch.homeLeagueName = home.leagueName;
      if ((match.awayLeagueName || null) !== away.leagueName) patch.awayLeagueName = away.leagueName;
      if (scheduledAt.getTime() !== (timestampToDate(match.scheduledAt) || new Date(match.scheduledAt)).getTime()) {
        patch.scheduledAt = Timestamp.fromDate(scheduledAt);
      }

      if (
        match.isBye &&
        !match.winnerTeamId &&
        ((home.teamId && !away.teamId) || (!home.teamId && away.teamId))
      ) {
        const winner = home.teamId ? home : away;
        patch.winnerTeamId = winner.teamId;
        patch.winnerTeamName = winner.teamName;
        patch.decidedBy = 'bye';
        patch.status = 'completed';
        patch.resolvedAt = Timestamp.fromDate(scheduledAt);
        patch.isBye = true;
      } else if (!match.winnerTeamId && home.teamId && away.teamId && !match.fixtureId) {
        const fixtureId = await maybeCreateFixtureForMatch({
          competitionRef: league.ref,
          competitionData: league.data,
          match,
          home,
          away,
          scheduledAt,
        });
        if (fixtureId) {
          patch.fixtureId = fixtureId;
          patch.status = 'scheduled';
          createdFixtures += 1;
        }
      }

      if (Object.keys(patch).length > 0) {
        await league.ref.collection('knockoutMatches').doc(match.id).set(patch, { merge: true });
        Object.assign(match, patch);
        matchesById.set(match.id, match);
        updatedMatches += 1;
        changed = true;
      }
    }
  }

  const finalRound = Math.max(...matches.map((match) => match.round));
  const finalMatch = matches.find((match) => match.round === finalRound);
  const championTeamId = finalMatch?.winnerTeamId ?? null;

  await league.ref.set(
    {
      championTeamId,
      state: championTeamId ? 'completed' : (createdFixtures > 0 ? 'scheduled' : league.data.state || 'scheduled'),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { updatedMatches, createdFixtures, championTeamId };
}

async function resolvePenaltyOutcomeFromFixture(input: {
  fixtureId: string;
  homeTeamId: string;
  awayTeamId: string;
}) {
  const planSnap = await db.doc(`matchPlans/${input.fixtureId}`).get();
  const plan = planSnap.exists ? (planSnap.data() as Record<string, any>) : null;
  const homeOverall = estimatePlanSideStrength(plan?.home as Record<string, any> | undefined);
  const awayOverall = estimatePlanSideStrength(plan?.away as Record<string, any> | undefined);
  return resolveDeterministicPenaltyShootout({
    matchId: input.fixtureId,
    homeOverall,
    awayOverall,
  });
}

async function syncPlayedFixtureIntoKnockoutMatch(input: {
  leagueId: string;
  matchId?: string | null;
  fixtureId: string;
}) {
  const context = await loadCompetitionContext(input.leagueId);
  if (!context) {
    return { updated: false };
  }

  const { league, entrants, matchesById } = context;
  let match: KnockoutMatchDoc | undefined = undefined;

  if (input.matchId) {
    match = matchesById.get(input.matchId);
  }

  if (!match) {
    match = [...matchesById.values()].find((candidate) => candidate.fixtureId === input.fixtureId);
  }

  if (!match) {
    return { updated: false };
  }

  const fixtureSnap = await league.ref.collection('fixtures').doc(input.fixtureId).get();
  if (!fixtureSnap.exists) {
    return { updated: false };
  }

  const fixture = (fixtureSnap.data() as Record<string, unknown>) ?? {};
  const score = normalizeScore(fixture.score);
  const patch: Record<string, unknown> = {
    status: matchStatusFromFixtureStatus(fixture.status),
  };

  if (score) {
    patch.score = score;
  }

  if (fixture.status === 'played' && score && !match.winnerTeamId) {
    let winnerTeamId: string | null = null;
    let loserTeamId: string | null = null;
    let winnerTeamName: string | null = null;
    let decidedBy: 'normal' | 'penalties' = 'normal';
    let penalties: { home: number; away: number } | null = null;

    if (score.home === score.away) {
      const penalty = await resolvePenaltyOutcomeFromFixture({
        fixtureId: input.fixtureId,
        homeTeamId: normalizeString(fixture.homeTeamId) || match.homeTeamId || '',
        awayTeamId: normalizeString(fixture.awayTeamId) || match.awayTeamId || '',
      });
      penalties = penalty.penalties;
      decidedBy = 'penalties';
      winnerTeamId =
        penalty.winner === 'home'
          ? (normalizeString(fixture.homeTeamId) || match.homeTeamId || null)
          : (normalizeString(fixture.awayTeamId) || match.awayTeamId || null);
      loserTeamId =
        penalty.winner === 'home'
          ? (normalizeString(fixture.awayTeamId) || match.awayTeamId || null)
          : (normalizeString(fixture.homeTeamId) || match.homeTeamId || null);
    } else if (score.home > score.away) {
      winnerTeamId = normalizeString(fixture.homeTeamId) || match.homeTeamId || null;
      loserTeamId = normalizeString(fixture.awayTeamId) || match.awayTeamId || null;
    } else {
      winnerTeamId = normalizeString(fixture.awayTeamId) || match.awayTeamId || null;
      loserTeamId = normalizeString(fixture.homeTeamId) || match.homeTeamId || null;
    }

    winnerTeamName = winnerTeamId ? (entrants.get(winnerTeamId)?.teamName || match.homeTeamName || match.awayTeamName || winnerTeamId) : null;
    patch.winnerTeamId = winnerTeamId;
    patch.winnerTeamName = winnerTeamName;
    patch.loserTeamId = loserTeamId;
    patch.decidedBy = decidedBy;
    patch.penalties = penalties;
    patch.status = 'completed';
    patch.resolvedAt = Timestamp.fromDate(resolveFixtureCompletionDate(fixture));

    await fixtureSnap.ref.set(
      {
        knockoutResult: {
          winnerTeamId,
          loserTeamId,
          decidedBy,
          penalties,
        },
      },
      { merge: true },
    );
  }

  await league.ref.collection('knockoutMatches').doc(match.id).set(patch, { merge: true });
  return { updated: true };
}

export async function bootstrapChampionsLeagueMonthlyInternal(
  input: BootstrapChampionsLeagueInput = {},
) {
  const baseDate = input.baseDate ?? new Date();
  const targetMonth = normalizeString(input.targetMonth) || resolveTargetMonth(baseDate);

  if (!input.targetMonth && !isLastDayOfMonthTR(baseDate)) {
    return { ok: true, skipped: 'not-last-day', targetMonth };
  }

  const competitionId = competitionDocId(targetMonth);
  const competitionRef = db.doc(`leagues/${competitionId}`);
  const existingCompetition = await competitionRef.get();
  if (existingCompetition.exists && !input.force) {
    return { ok: true, skipped: 'already-exists', targetMonth, leagueId: competitionId };
  }

  const participants = await resolveDomesticChampions();
  if (participants.length < 2) {
    return { ok: true, skipped: 'insufficient-participants', targetMonth, participants: participants.length };
  }

  const seededSeason = await db.collection('leagues').get();
  const domesticLeagues = seededSeason.docs.filter((doc) => isDomesticCompetition(doc.data() as Record<string, unknown>));
  const baseSeason = domesticLeagues.reduce((max, doc) => {
    const season = Number((doc.data() as any)?.season || 0);
    return season > max ? season : max;
  }, 1);

  const startDate = (() => {
    const monthStartAt19 = monthStartAt19TR(targetMonth);
    const dayString = formatInTimeZone(monthStartAt19, TZ, 'yyyy-MM-dd');
    return new Date(`${dayString}T${String(CHAMPIONS_LEAGUE_KICKOFF_HOUR).padStart(2, '0')}:00:00+03:00`);
  })();

  const plan = buildChampionsLeagueKnockoutPlan(participants, {
    slug: competitionId,
    startDate,
    kickoffHour: CHAMPIONS_LEAGUE_KICKOFF_HOUR,
    roundSpacingDays: CHAMPIONS_LEAGUE_ROUND_SPACING_DAYS,
    timezone: TZ,
  });

  if (!existingCompetition.exists || input.force) {
    await competitionRef.set({
      name: 'Şampiyonlar Ligi',
      season: baseSeason,
      seasonId: targetMonth,
      capacity: plan.bracketSize,
      timezone: TZ,
      state: 'scheduled',
      rounds: plan.totalRounds,
      teamCount: plan.participants.length,
      competitionType: 'champions_league',
      competitionFormat: 'knockout',
      hiddenFromLeagueList: true,
      sourceMonth: targetMonth,
      snapshotAt: FieldValue.serverTimestamp(),
      roundSpacingDays: CHAMPIONS_LEAGUE_ROUND_SPACING_DAYS,
      kickoffHourTR: CHAMPIONS_LEAGUE_KICKOFF_HOUR,
      championTeamId: null,
      updatedAt: FieldValue.serverTimestamp(),
      startDate: Timestamp.fromDate(startDate),
      teams: plan.participants.map((participant) => ({
        id: participant.teamId,
        name: participant.teamName,
      })),
      ...(existingCompetition.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
  }

  if (!existingCompetition.exists || input.force) {
    await replaceCompetitionPlan(competitionRef, plan, targetMonth);
  }

  const materialized = await materializeReadyChampionsLeagueMatches(competitionId);
  return {
    ok: true,
    targetMonth,
    leagueId: competitionId,
    participants: plan.participants.length,
    bracketSize: plan.bracketSize,
    createdFixtures: materialized.createdFixtures,
    championTeamId: materialized.championTeamId,
  };
}

export async function syncChampionsLeagueProgressInternal(input: SyncChampionsLeagueInput = {}) {
  let leagueId = normalizeString(input.leagueId);
  let matchId = normalizeString(input.matchId);
  const fixtureId = normalizeString(input.fixtureId);

  if (!leagueId && fixtureId) {
    const fixtureSnap = await db
      .collectionGroup('fixtures')
      .where(FieldPath.documentId(), '==', fixtureId)
      .limit(1)
      .get();
    if (!fixtureSnap.empty) {
      leagueId = fixtureSnap.docs[0].ref.parent.parent?.id || null;
      const fixtureData = fixtureSnap.docs[0].data() as Record<string, unknown>;
      matchId = normalizeString(fixtureData.competitionMatchId);
    }
  }

  if (!leagueId) {
    throw new Error('leagueId or fixtureId required');
  }

  const competition = await loadCompetitionLeague(leagueId);
  if (!competition) {
    return { ok: true, skipped: 'not-champions-league', leagueId };
  }

  if (fixtureId) {
    await syncPlayedFixtureIntoKnockoutMatch({
      leagueId,
      matchId,
      fixtureId,
    });
  }

  const materialized = await materializeReadyChampionsLeagueMatches(leagueId);
  return { ok: true, leagueId, ...materialized };
}

export const bootstrapChampionsLeagueMonthly = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .pubsub.schedule('50 23 * * *')
  .timeZone(TZ)
  .onRun(async () => {
    return bootstrapChampionsLeagueMonthlyInternal();
  });

export const bootstrapChampionsLeagueMonthlyHttp = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed' });
      return;
    }
    if (!requireAdminSecret(req, res)) return;

    try {
      const body = readRequestBody(req);
      const targetMonth = normalizeString(body.targetMonth ?? req.query?.targetMonth);
      const force = body.force === true || req.query?.force === '1';
      const result = await bootstrapChampionsLeagueMonthlyInternal({
        targetMonth: targetMonth || undefined,
        force,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error?.message || 'internal' });
    }
  });

export const syncChampionsLeagueProgressHttp = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed' });
      return;
    }
    if (!requireAdminSecret(req, res)) return;

    try {
      const body = readRequestBody(req);
      const result = await syncChampionsLeagueProgressInternal({
        leagueId: normalizeString(body.leagueId ?? req.query?.leagueId) || undefined,
        matchId: normalizeString(body.matchId ?? req.query?.matchId) || undefined,
        fixtureId: normalizeString(body.fixtureId ?? req.query?.fixtureId) || undefined,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error?.message || 'internal' });
    }
  });

export const syncChampionsLeagueProgressOnFixtureWrite = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .firestore.document('leagues/{leagueId}/fixtures/{fixtureId}')
  .onWrite(async (change, context) => {
    const leagueId = context.params.leagueId as string;
    const fixtureId = context.params.fixtureId as string;
    const after = change.after.exists ? (change.after.data() as Record<string, unknown>) : null;
    if (!after) return;

    const competition = await loadCompetitionLeague(leagueId);
    if (!competition) return;

    const matchId = normalizeString(after.competitionMatchId) || undefined;
    const beforeStatus = String(change.before.exists ? change.before.data()?.status || '' : '').trim().toLowerCase();
    const afterStatus = String(after.status || '').trim().toLowerCase();

    if (beforeStatus === afterStatus && afterStatus !== 'played' && !matchId) {
      return;
    }

    await syncChampionsLeagueProgressInternal({
      leagueId,
      matchId,
      fixtureId,
    });
  });
