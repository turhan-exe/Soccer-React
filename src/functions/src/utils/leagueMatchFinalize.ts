import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { ensureBotTeamDoc } from './bots.js';
import { isKnockoutCompetition } from './competition.js';
import {
  buildMatchRevenuePlan,
  resolveFixtureRevenueTeamIdsFromLookups,
  type MatchRevenuePlanSide,
  type MatchRevenueSkippedSide,
  type RevenueEligiblePlayer,
  type RevenueSide,
} from './leagueMatchRevenueModel.js';

const db = getFirestore();
const INITIAL_CLUB_BALANCE = 50_000;
const DEFAULT_VITAL_GAUGE = 0.75;
const DEFAULT_HEALTHY_HEALTH = 1;
const DEFAULT_INJURED_HEALTH = 0.5;
const LEAGUE_STARTER_CONDITION_LOSS = 0.08;
const LEAGUE_BENCH_MOTIVATION_PENALTY = 0.05;
const LEAGUE_SQUAD_OUT_MOTIVATION_PENALTY = 0.08;
const LEAGUE_LINEUP_EFFECTS_VERSION = 2;

type ResolvedRevenueTeamIds = Partial<Record<RevenueSide, string | null>>;

type TeamFinanceData = {
  budget?: number | null;
  transferBudget?: number | null;
  players?: RevenueEligiblePlayer[] | null;
};

type FinanceBalanceData = {
  balance?: number | null;
};

type StadiumStateData = {
  level?: number | null;
};

export type ApplyLeagueMatchRevenueResult = {
  appliedSides: MatchRevenuePlanSide[];
  skippedSides: MatchRevenueSkippedSide[];
  nextAppliedSides: RevenueSide[];
};

const financeDoc = (uid: string) => db.collection('finance').doc(uid);
const financeHistoryCollection = (uid: string) => db.collection('finance').doc('history').collection(uid);
const teamDoc = (teamId: string) => db.collection('teams').doc(teamId);
const teamStadiumDoc = (teamId: string) => db.doc(`teams/${teamId}/stadium/state`);
const matchPlanDoc = (matchId: string) => db.doc(`matchPlans/${matchId}`);

const normalizeTeamId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isSlotTeamId = (teamId: string): boolean => teamId.startsWith('slot-');

const clampGauge = (value: unknown, fallback = DEFAULT_VITAL_GAUGE): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, Number(numeric.toFixed(3))));
};

const normalizeInjuryStatus = (value: unknown): 'healthy' | 'injured' =>
  value === 'injured' ? 'injured' : 'healthy';

const resolveHealth = (value: unknown, injuryStatus: 'healthy' | 'injured'): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(numeric)) {
    return clampGauge(numeric, DEFAULT_HEALTHY_HEALTH);
  }
  return injuryStatus === 'injured'
    ? DEFAULT_INJURED_HEALTH
    : DEFAULT_HEALTHY_HEALTH;
};

const asPlayerIdSet = (value: unknown): Set<string> =>
  new Set(
    Array.isArray(value)
      ? value
          .map((entry) => (typeof entry === 'string' || typeof entry === 'number' ? String(entry) : ''))
          .filter(Boolean)
      : [],
  );

const normalizeRosterPlayers = (players: unknown[]): Record<string, unknown>[] => {
  let starters = 0;

  return players.map((entry) => {
    const player = entry && typeof entry === 'object' ? { ...(entry as Record<string, unknown>) } : {};
    const injuryStatus = normalizeInjuryStatus(player.injuryStatus);
    const normalized = {
      ...player,
      id: typeof player.id === 'string' || typeof player.id === 'number' ? String(player.id) : '',
      health: resolveHealth(player.health, injuryStatus),
      condition: clampGauge(player.condition),
      motivation: clampGauge(player.motivation),
      injuryStatus,
      squadRole: player.squadRole === 'starting' || player.squadRole === 'bench' || player.squadRole === 'reserve'
        ? player.squadRole
        : 'reserve',
    };

    if (normalized.squadRole !== 'starting') {
      return normalized;
    }

    starters += 1;
    if (starters <= 11) {
      return normalized;
    }

    return {
      ...normalized,
      squadRole: 'bench',
    };
  });
};

type LeagueLineupPenaltySummary = {
  changed: boolean;
  starterConditionPenalties: number;
  benchPenalties: number;
  squadOutPenalties: number;
  players: Record<string, unknown>[];
};

export const applyLeagueLineupEffectsToRoster = (
  players: Record<string, unknown>[],
  starters: Set<string>,
  subs: Set<string>,
): LeagueLineupPenaltySummary => {
  let changed = false;
  let starterConditionPenalties = 0;
  let benchPenalties = 0;
  let squadOutPenalties = 0;

  const nextPlayers = players.map((player) => {
    const playerId = typeof player.id === 'string' ? player.id : '';
    if (!playerId) {
      return player;
    }

    if (player.injuryStatus === 'injured') {
      return player;
    }

    if (starters.has(playerId)) {
      const currentCondition =
        typeof player.condition === 'number'
          ? clampGauge(player.condition)
          : DEFAULT_VITAL_GAUGE;
      const nextCondition = clampGauge(
        currentCondition - LEAGUE_STARTER_CONDITION_LOSS,
      );

      if (nextCondition === currentCondition) {
        return player;
      }

      starterConditionPenalties += 1;
      changed = true;
      return {
        ...player,
        condition: nextCondition,
      };
    }

    if (subs.has(playerId)) {
      const currentMotivation =
        typeof player.motivation === 'number'
          ? clampGauge(player.motivation)
          : DEFAULT_VITAL_GAUGE;
      const nextMotivation = clampGauge(
        currentMotivation - LEAGUE_BENCH_MOTIVATION_PENALTY,
      );

      if (nextMotivation === currentMotivation) {
        return player;
      }

      benchPenalties += 1;
      changed = true;
      return {
        ...player,
        motivation: nextMotivation,
      };
    }

    const currentMotivation =
      typeof player.motivation === 'number'
        ? clampGauge(player.motivation)
        : DEFAULT_VITAL_GAUGE;
    const nextMotivation = clampGauge(
      currentMotivation - LEAGUE_SQUAD_OUT_MOTIVATION_PENALTY,
    );

    if (nextMotivation === currentMotivation) {
      return player;
    }

    squadOutPenalties += 1;
    changed = true;
    return {
      ...player,
      motivation: nextMotivation,
    };
  });

  return {
    changed,
    starterConditionPenalties,
    benchPenalties,
    squadOutPenalties,
    players: nextPlayers,
  };
};

const extractSlotReference = (teamId: unknown, fallbackSlot: unknown): unknown => {
  const normalizedTeamId = normalizeTeamId(teamId);
  if (normalizedTeamId && isSlotTeamId(normalizedTeamId)) {
    return normalizedTeamId.slice('slot-'.length);
  }
  return fallbackSlot;
};

const resolveTeamFinanceBalance = (
  teamData?: TeamFinanceData | null,
  financeData?: FinanceBalanceData | null,
): number => {
  const balanceSource = Number.isFinite(teamData?.transferBudget)
    ? Number(teamData?.transferBudget)
    : Number.isFinite(teamData?.budget)
      ? Number(teamData?.budget)
      : (financeData?.balance ?? INITIAL_CLUB_BALANCE);

  return Math.max(0, Math.round(balanceSource));
};

async function resolveSlotTeamId(leagueId: string, slotValue: unknown): Promise<string | null> {
  const slot = Number(slotValue);
  if (!Number.isFinite(slot) || slot <= 0) {
    return null;
  }

  const slotSnap = await db.doc(`leagues/${leagueId}/slots/${slot}`).get();
  if (!slotSnap.exists) {
    return null;
  }

  const slotData = slotSnap.data() as { teamId?: unknown; botId?: unknown; name?: unknown } | undefined;
  let teamId = normalizeTeamId(slotData?.teamId);
  if (!teamId && slotData?.botId) {
    teamId = await ensureBotTeamDoc({
      botId: String(slotData.botId),
      slotIndex: slot,
      name: typeof slotData?.name === 'string' ? slotData.name : undefined,
    });
  }

  return teamId;
}

export async function resolveFixtureRevenueTeamIds(
  leagueId: string,
  fixture: {
    homeTeamId?: unknown;
    awayTeamId?: unknown;
    homeSlot?: unknown;
    awaySlot?: unknown;
  },
): Promise<{ home: string | null; away: string | null }> {
  const [homeSlotTeamId, awaySlotTeamId] = await Promise.all([
    resolveSlotTeamId(leagueId, extractSlotReference(fixture.homeTeamId, fixture.homeSlot)),
    resolveSlotTeamId(leagueId, extractSlotReference(fixture.awayTeamId, fixture.awaySlot)),
  ]);

  return resolveFixtureRevenueTeamIdsFromLookups(fixture, {
    homeSlotTeamId,
    awaySlotTeamId,
  });
}

export async function applyStandingResultInTx(
  tx: FirebaseFirestore.Transaction,
  fixtureRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  fixture: Record<string, unknown>,
  score: { home: number; away: number },
): Promise<void> {
  const homeSlot = Number(fixture.homeSlot);
  const awaySlot = Number(fixture.awaySlot);
  const useSlots = Number.isFinite(homeSlot) || Number.isFinite(awaySlot);
  const homeId = useSlots
    ? (Number.isFinite(homeSlot) ? String(homeSlot) : null)
    : normalizeTeamId(fixture.homeTeamId);
  const awayId = useSlots
    ? (Number.isFinite(awaySlot) ? String(awaySlot) : null)
    : normalizeTeamId(fixture.awayTeamId);

  if (!homeId || !awayId) {
    return;
  }

  const leagueRef = fixtureRef.parent.parent;
  if (!leagueRef) {
    return;
  }

  const leagueSnap = await tx.get(leagueRef);
  const leagueData = leagueSnap.exists
    ? (leagueSnap.data() as Record<string, unknown>)
    : null;
  if (isKnockoutCompetition(leagueData)) {
    return;
  }

  const homeRef = leagueRef.collection('standings').doc(homeId);
  const awayRef = leagueRef.collection('standings').doc(awayId);
  const [homeSnap, awaySnap] = await Promise.all([tx.get(homeRef), tx.get(awayRef)]);

  const homeStanding = homeSnap.exists
    ? (homeSnap.data() as Record<string, unknown>)
    : useSlots
      ? { slotIndex: homeSlot, teamId: fixture.homeTeamId ?? null, name: '', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 }
      : { teamId: homeId, name: '', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
  const awayStanding = awaySnap.exists
    ? (awaySnap.data() as Record<string, unknown>)
    : useSlots
      ? { slotIndex: awaySlot, teamId: fixture.awayTeamId ?? null, name: '', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 }
      : { teamId: awayId, name: '', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };

  const hs = { ...homeStanding } as Record<string, number | string | null | undefined>;
  const as = { ...awayStanding } as Record<string, number | string | null | undefined>;

  hs.P = Number(hs.P ?? 0) + 1;
  as.P = Number(as.P ?? 0) + 1;
  hs.GF = Number(hs.GF ?? 0) + score.home;
  hs.GA = Number(hs.GA ?? 0) + score.away;
  as.GF = Number(as.GF ?? 0) + score.away;
  as.GA = Number(as.GA ?? 0) + score.home;
  hs.GD = Number(hs.GF ?? 0) - Number(hs.GA ?? 0);
  as.GD = Number(as.GF ?? 0) - Number(as.GA ?? 0);

  if (score.home > score.away) {
    hs.W = Number(hs.W ?? 0) + 1;
    as.L = Number(as.L ?? 0) + 1;
    hs.Pts = Number(hs.Pts ?? 0) + 3;
  } else if (score.home < score.away) {
    as.W = Number(as.W ?? 0) + 1;
    hs.L = Number(hs.L ?? 0) + 1;
    as.Pts = Number(as.Pts ?? 0) + 3;
  } else {
    hs.D = Number(hs.D ?? 0) + 1;
    as.D = Number(as.D ?? 0) + 1;
    hs.Pts = Number(hs.Pts ?? 0) + 1;
    as.Pts = Number(as.Pts ?? 0) + 1;
  }

  tx.set(homeRef, hs, { merge: true });
  tx.set(awayRef, as, { merge: true });
}

export async function applyLeagueMatchRevenueInTx(
  tx: FirebaseFirestore.Transaction,
  fixtureRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  fixture: Record<string, unknown>,
  resolvedTeamIds?: ResolvedRevenueTeamIds,
): Promise<ApplyLeagueMatchRevenueResult> {
  const homeTeamId = normalizeTeamId(resolvedTeamIds?.home) ?? normalizeTeamId(fixture.homeTeamId);
  const awayTeamId = normalizeTeamId(resolvedTeamIds?.away) ?? normalizeTeamId(fixture.awayTeamId);
  const uniqueTeamIds = Array.from(new Set([homeTeamId, awayTeamId].filter(Boolean))) as string[];

  const teamSnapshots = new Map<
    string,
    {
      team: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>;
      finance: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>;
      stadium: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>;
    }
  >();

  await Promise.all(
    uniqueTeamIds.map(async (teamId) => {
      const [teamSnap, financeSnap, stadiumSnap] = await Promise.all([
        tx.get(teamDoc(teamId)),
        tx.get(financeDoc(teamId)),
        tx.get(teamStadiumDoc(teamId)),
      ]);
      teamSnapshots.set(teamId, {
        team: teamSnap,
        finance: financeSnap,
        stadium: stadiumSnap,
      });
    }),
  );

  const sideInputs = (['home', 'away'] as RevenueSide[]).map((side) => {
    const teamId = side === 'home' ? homeTeamId : awayTeamId;
    if (!teamId) {
      return { side, teamId: null, skipReason: 'missing_team_id' as const };
    }

    const snapshots = teamSnapshots.get(teamId);
    if (!snapshots?.team.exists) {
      return { side, teamId, skipReason: 'missing_team_doc' as const };
    }

    const teamData = (snapshots.team.data() as TeamFinanceData | undefined) ?? undefined;
    const stadiumData = (snapshots.stadium.data() as StadiumStateData | undefined) ?? undefined;

    return {
      side,
      teamId,
      players: Array.isArray(teamData?.players) ? teamData.players : [],
      stadiumLevel: Number.isFinite(stadiumData?.level) ? Number(stadiumData?.level) : 1,
    };
  });

  const economy = (fixture.economy as { matchRevenueAppliedSides?: unknown; matchRevenueEntries?: unknown } | undefined) ?? {};
  const plan = buildMatchRevenuePlan({
    existingAppliedSides: economy.matchRevenueAppliedSides,
    existingEntries: economy.matchRevenueEntries,
    sides: sideInputs,
  });

  const revenueByTeam = new Map<string, number>();
  for (const pending of plan.pendingSides) {
    revenueByTeam.set(pending.teamId, (revenueByTeam.get(pending.teamId) ?? 0) + pending.amount);
  }

  for (const [teamId, totalAmount] of revenueByTeam.entries()) {
    const snapshots = teamSnapshots.get(teamId);
    const teamData = (snapshots?.team.data() as TeamFinanceData | undefined) ?? undefined;
    const financeData = (snapshots?.finance.data() as FinanceBalanceData | undefined) ?? undefined;
    const nextBalance = resolveTeamFinanceBalance(teamData, financeData) + totalAmount;

    tx.set(
      financeDoc(teamId),
      {
        balance: nextBalance,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      teamDoc(teamId),
      {
        budget: nextBalance,
        transferBudget: nextBalance,
      },
      { merge: true },
    );
  }

  for (const pending of plan.pendingSides) {
    const historyRef = financeHistoryCollection(pending.teamId).doc();
    tx.set(historyRef, {
      id: historyRef.id,
      type: 'income',
      category: 'match',
      amount: pending.amount,
      source: fixtureRef.id,
      note: 'Lig maci geliri',
      timestamp: FieldValue.serverTimestamp(),
    });
  }

  const shouldWriteEconomyMetadata =
    plan.pendingSides.length > 0 ||
    plan.nextAppliedSides.length !== plan.existingAppliedSides.length ||
    plan.nextEntries.length !== plan.existingEntries.length;

  if (shouldWriteEconomyMetadata) {
    tx.set(
      fixtureRef,
      {
        economy: {
          matchRevenueAppliedSides: plan.nextAppliedSides,
          matchRevenueEntries: plan.nextEntries,
        },
      },
      { merge: true },
    );
  }

  const leagueId = fixtureRef.parent.parent?.id ?? null;
  for (const skipped of plan.skippedSides) {
    if (skipped.reason === 'already_applied') {
      continue;
    }
    console.warn('[leagueMatchRevenue] skipped side', {
      fixtureId: fixtureRef.id,
      leagueId,
      side: skipped.side,
      reason: skipped.reason,
    });
  }

  return {
    appliedSides: plan.pendingSides,
    skippedSides: plan.skippedSides,
    nextAppliedSides: plan.nextAppliedSides,
  };
}

export async function applyLeagueResultSideEffectsInTx(
  tx: FirebaseFirestore.Transaction,
  fixtureRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  fixture: Record<string, unknown>,
  options: {
    score?: { home: number; away: number } | null;
    resolvedTeamIds?: ResolvedRevenueTeamIds;
    includeStandings?: boolean;
    includeRevenue?: boolean;
  } = {},
): Promise<ApplyLeagueMatchRevenueResult> {
  const score = options.score ?? null;
  const includeStandings = options.includeStandings !== false && score != null;
  const includeRevenue = options.includeRevenue !== false;

  const homeSlot = Number(fixture.homeSlot);
  const awaySlot = Number(fixture.awaySlot);
  const useSlots = Number.isFinite(homeSlot) || Number.isFinite(awaySlot);
  const homeStandingId = useSlots
    ? (Number.isFinite(homeSlot) ? String(homeSlot) : null)
    : normalizeTeamId(fixture.homeTeamId);
  const awayStandingId = useSlots
    ? (Number.isFinite(awaySlot) ? String(awaySlot) : null)
    : normalizeTeamId(fixture.awayTeamId);

  const leagueRef = fixtureRef.parent.parent;
  const shouldAttemptStandings =
    includeStandings &&
    score != null &&
    Boolean(leagueRef) &&
    Boolean(homeStandingId) &&
    Boolean(awayStandingId);

  let leagueData: Record<string, unknown> | null = null;
  let homeStanding: Record<string, unknown> | null = null;
  let awayStanding: Record<string, unknown> | null = null;

  if (shouldAttemptStandings && leagueRef && homeStandingId && awayStandingId) {
    const homeStandingRef = leagueRef.collection('standings').doc(homeStandingId);
    const awayStandingRef = leagueRef.collection('standings').doc(awayStandingId);
    const [leagueSnap, homeSnap, awaySnap] = await Promise.all([
      tx.get(leagueRef),
      tx.get(homeStandingRef),
      tx.get(awayStandingRef),
    ]);

    leagueData = leagueSnap.exists
      ? (leagueSnap.data() as Record<string, unknown>)
      : null;

    if (!isKnockoutCompetition(leagueData)) {
      homeStanding = homeSnap.exists
        ? (homeSnap.data() as Record<string, unknown>)
        : useSlots
          ? {
              slotIndex: homeSlot,
              teamId: fixture.homeTeamId ?? null,
              name: '',
              P: 0,
              W: 0,
              D: 0,
              L: 0,
              GF: 0,
              GA: 0,
              GD: 0,
              Pts: 0,
            }
          : { teamId: homeStandingId, name: '', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
      awayStanding = awaySnap.exists
        ? (awaySnap.data() as Record<string, unknown>)
        : useSlots
          ? {
              slotIndex: awaySlot,
              teamId: fixture.awayTeamId ?? null,
              name: '',
              P: 0,
              W: 0,
              D: 0,
              L: 0,
              GF: 0,
              GA: 0,
              GD: 0,
              Pts: 0,
            }
          : { teamId: awayStandingId, name: '', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
    }
  }

  const homeTeamId = normalizeTeamId(options.resolvedTeamIds?.home) ?? normalizeTeamId(fixture.homeTeamId);
  const awayTeamId = normalizeTeamId(options.resolvedTeamIds?.away) ?? normalizeTeamId(fixture.awayTeamId);
  const uniqueTeamIds = includeRevenue
    ? Array.from(new Set([homeTeamId, awayTeamId].filter(Boolean))) as string[]
    : [];

  const teamSnapshots = new Map<
    string,
    {
      team: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>;
      finance: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>;
      stadium: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>;
    }
  >();

  if (includeRevenue) {
    await Promise.all(
      uniqueTeamIds.map(async (teamId) => {
        const [teamSnap, financeSnap, stadiumSnap] = await Promise.all([
          tx.get(teamDoc(teamId)),
          tx.get(financeDoc(teamId)),
          tx.get(teamStadiumDoc(teamId)),
        ]);
        teamSnapshots.set(teamId, {
          team: teamSnap,
          finance: financeSnap,
          stadium: stadiumSnap,
        });
      }),
    );
  }

  if (score && homeStanding && awayStanding && leagueRef && homeStandingId && awayStandingId) {
    const homeStandingRef = leagueRef.collection('standings').doc(homeStandingId);
    const awayStandingRef = leagueRef.collection('standings').doc(awayStandingId);
    const hs = { ...homeStanding } as Record<string, number | string | null | undefined>;
    const as = { ...awayStanding } as Record<string, number | string | null | undefined>;

    hs.P = Number(hs.P ?? 0) + 1;
    as.P = Number(as.P ?? 0) + 1;
    hs.GF = Number(hs.GF ?? 0) + score.home;
    hs.GA = Number(hs.GA ?? 0) + score.away;
    as.GF = Number(as.GF ?? 0) + score.away;
    as.GA = Number(as.GA ?? 0) + score.home;
    hs.GD = Number(hs.GF ?? 0) - Number(hs.GA ?? 0);
    as.GD = Number(as.GF ?? 0) - Number(as.GA ?? 0);

    if (score.home > score.away) {
      hs.W = Number(hs.W ?? 0) + 1;
      as.L = Number(as.L ?? 0) + 1;
      hs.Pts = Number(hs.Pts ?? 0) + 3;
    } else if (score.home < score.away) {
      as.W = Number(as.W ?? 0) + 1;
      hs.L = Number(hs.L ?? 0) + 1;
      as.Pts = Number(as.Pts ?? 0) + 3;
    } else {
      hs.D = Number(hs.D ?? 0) + 1;
      as.D = Number(as.D ?? 0) + 1;
      hs.Pts = Number(hs.Pts ?? 0) + 1;
      as.Pts = Number(as.Pts ?? 0) + 1;
    }

    tx.set(homeStandingRef, hs, { merge: true });
    tx.set(awayStandingRef, as, { merge: true });
  }

  if (!includeRevenue) {
    return {
      appliedSides: [],
      skippedSides: [],
      nextAppliedSides: [],
    };
  }

  const sideInputs = (['home', 'away'] as RevenueSide[]).map((side) => {
    const teamId = side === 'home' ? homeTeamId : awayTeamId;
    if (!teamId) {
      return { side, teamId: null, skipReason: 'missing_team_id' as const };
    }

    const snapshots = teamSnapshots.get(teamId);
    if (!snapshots?.team.exists) {
      return { side, teamId, skipReason: 'missing_team_doc' as const };
    }

    const teamData = (snapshots.team.data() as TeamFinanceData | undefined) ?? undefined;
    const stadiumData = (snapshots.stadium.data() as StadiumStateData | undefined) ?? undefined;

    return {
      side,
      teamId,
      players: Array.isArray(teamData?.players) ? teamData.players : [],
      stadiumLevel: Number.isFinite(stadiumData?.level) ? Number(stadiumData?.level) : 1,
    };
  });

  const economy = (fixture.economy as { matchRevenueAppliedSides?: unknown; matchRevenueEntries?: unknown } | undefined) ?? {};
  const plan = buildMatchRevenuePlan({
    existingAppliedSides: economy.matchRevenueAppliedSides,
    existingEntries: economy.matchRevenueEntries,
    sides: sideInputs,
  });

  const revenueByTeam = new Map<string, number>();
  for (const pending of plan.pendingSides) {
    revenueByTeam.set(pending.teamId, (revenueByTeam.get(pending.teamId) ?? 0) + pending.amount);
  }

  for (const [teamId, totalAmount] of revenueByTeam.entries()) {
    const snapshots = teamSnapshots.get(teamId);
    const teamData = (snapshots?.team.data() as TeamFinanceData | undefined) ?? undefined;
    const financeData = (snapshots?.finance.data() as FinanceBalanceData | undefined) ?? undefined;
    const nextBalance = resolveTeamFinanceBalance(teamData, financeData) + totalAmount;

    tx.set(
      financeDoc(teamId),
      {
        balance: nextBalance,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      teamDoc(teamId),
      {
        budget: nextBalance,
        transferBudget: nextBalance,
      },
      { merge: true },
    );
  }

  for (const pending of plan.pendingSides) {
    const historyRef = financeHistoryCollection(pending.teamId).doc();
    tx.set(historyRef, {
      id: historyRef.id,
      type: 'income',
      category: 'match',
      amount: pending.amount,
      source: fixtureRef.id,
      note: 'Lig maci geliri',
      timestamp: FieldValue.serverTimestamp(),
    });
  }

  const shouldWriteEconomyMetadata =
    plan.pendingSides.length > 0 ||
    plan.nextAppliedSides.length !== plan.existingAppliedSides.length ||
    plan.nextEntries.length !== plan.existingEntries.length;

  if (shouldWriteEconomyMetadata) {
    tx.set(
      fixtureRef,
      {
        economy: {
          matchRevenueAppliedSides: plan.nextAppliedSides,
          matchRevenueEntries: plan.nextEntries,
        },
      },
      { merge: true },
    );
  }

  const leagueId = fixtureRef.parent.parent?.id ?? null;
  for (const skipped of plan.skippedSides) {
    if (skipped.reason === 'already_applied') {
      continue;
    }
    console.warn('[leagueMatchRevenue] skipped side', {
      fixtureId: fixtureRef.id,
      leagueId,
      side: skipped.side,
      reason: skipped.reason,
    });
  }

  return {
    appliedSides: plan.pendingSides,
    skippedSides: plan.skippedSides,
    nextAppliedSides: plan.nextAppliedSides,
  };
}

export async function applyLeagueLineupMotivationEffects(
  leagueId: string,
  fixtureId: string,
): Promise<{
  status: string;
  starterConditionPenalties: number;
  benchPenalties: number;
  squadOutPenalties: number;
}> {
  const fixtureRef = db.doc(`leagues/${leagueId}/fixtures/${fixtureId}`);

  return db.runTransaction(async (tx) => {
    const fixtureSnap = await tx.get(fixtureRef);
    if (!fixtureSnap.exists) {
      return {
        status: 'missing_fixture',
        starterConditionPenalties: 0,
        benchPenalties: 0,
        squadOutPenalties: 0,
      };
    }

    const fixture = (fixtureSnap.data() as Record<string, unknown>) ?? {};
    const playerEffects =
      fixture.playerEffects && typeof fixture.playerEffects === 'object'
        ? (fixture.playerEffects as Record<string, unknown>)
        : {};
    const currentStatus =
      typeof playerEffects.lineupMotivationStatus === 'string'
        ? String(playerEffects.lineupMotivationStatus)
        : null;

    if (currentStatus) {
      return {
        status: currentStatus,
        starterConditionPenalties: 0,
        benchPenalties: 0,
        squadOutPenalties: 0,
      };
    }

    const planSnap = await tx.get(matchPlanDoc(fixtureId));
    if (!planSnap.exists) {
      console.warn('[leagueLineupMotivation] match plan missing', { leagueId, fixtureId });
      tx.set(
        fixtureRef,
        {
          playerEffects: {
            lineupMotivationStatus: 'skipped_missing_match_plan',
            lineupMotivationVersion: LEAGUE_LINEUP_EFFECTS_VERSION,
            lineupMotivationUpdatedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      );
      return {
        status: 'skipped_missing_match_plan',
        starterConditionPenalties: 0,
        benchPenalties: 0,
        squadOutPenalties: 0,
      };
    }

    const plan = (planSnap.data() as Record<string, unknown>) ?? {};
    const sides = [
      {
        side: 'home',
        teamId: normalizeTeamId((plan.home as { teamId?: unknown } | undefined)?.teamId) ?? normalizeTeamId(fixture.homeTeamId),
        starters: asPlayerIdSet((plan.home as { starters?: unknown } | undefined)?.starters),
        subs: asPlayerIdSet((plan.home as { subs?: unknown } | undefined)?.subs),
      },
      {
        side: 'away',
        teamId: normalizeTeamId((plan.away as { teamId?: unknown } | undefined)?.teamId) ?? normalizeTeamId(fixture.awayTeamId),
        starters: asPlayerIdSet((plan.away as { starters?: unknown } | undefined)?.starters),
        subs: asPlayerIdSet((plan.away as { subs?: unknown } | undefined)?.subs),
      },
    ];

    let starterConditionPenalties = 0;
    let benchPenalties = 0;
    let squadOutPenalties = 0;
    let appliedToAnyTeam = false;

    for (const side of sides) {
      if (!side.teamId) {
        continue;
      }

      const teamRef = teamDoc(side.teamId);
      const teamSnap = await tx.get(teamRef);
      if (!teamSnap.exists) {
        console.warn('[leagueLineupMotivation] team missing', { leagueId, fixtureId, side: side.side, teamId: side.teamId });
        continue;
      }

      const teamData = (teamSnap.data() as { players?: unknown[] } | undefined) ?? undefined;
      const rawPlayers = Array.isArray(teamData?.players) ? teamData.players : [];
      const normalizedPlayers = normalizeRosterPlayers(rawPlayers);
      const summary = applyLeagueLineupEffectsToRoster(
        normalizedPlayers,
        side.starters,
        side.subs,
      );
      const rosterChanged =
        summary.changed || JSON.stringify(rawPlayers) !== JSON.stringify(summary.players);

      starterConditionPenalties += summary.starterConditionPenalties;
      benchPenalties += summary.benchPenalties;
      squadOutPenalties += summary.squadOutPenalties;

      if (rosterChanged) {
        tx.set(teamRef, { players: summary.players }, { merge: true });
        appliedToAnyTeam = true;
      }
    }

    tx.set(
      fixtureRef,
      {
        playerEffects: {
          lineupMotivationStatus: appliedToAnyTeam ? 'applied' : 'applied_no_changes',
          lineupMotivationVersion: LEAGUE_LINEUP_EFFECTS_VERSION,
          lineupMotivationUpdatedAt: FieldValue.serverTimestamp(),
          lineupMotivationStarterConditionCount: starterConditionPenalties,
          lineupMotivationStarterConditionLoss: LEAGUE_STARTER_CONDITION_LOSS,
          lineupMotivationBenchCount: benchPenalties,
          lineupMotivationSquadOutCount: squadOutPenalties,
        },
      },
      { merge: true },
    );

    return {
      status: appliedToAnyTeam ? 'applied' : 'applied_no_changes',
      starterConditionPenalties,
      benchPenalties,
      squadOutPenalties,
    };
  });
}
