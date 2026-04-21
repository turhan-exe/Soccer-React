import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { RevenueEligiblePlayer } from './leagueMatchRevenueModel.js';
import { getTeamStrengthForRevenue } from './leagueMatchRevenueModel.js';
import {
  applyLeagueLineupMotivationEffects,
  applyLeagueResultSideEffectsInTx,
  resolveFixtureRevenueTeamIds,
} from './leagueMatchFinalize.js';
import { hasCanonicalFixtureScore } from './fixtureScore.js';

const db = getFirestore();
const FALLBACK_VERSION = 1 as const;
const DEFAULT_TEAM_STRENGTH = 58;
const HOME_ADVANTAGE_STRENGTH = 3;

type FallbackRosterPlayer = RevenueEligiblePlayer & {
  id?: string | number | null;
};

type MatchPlanSide = {
  teamId?: unknown;
  clubId?: unknown;
  starters?: unknown;
  subs?: unknown;
};

export type FallbackScore = {
  home: number;
  away: number;
};

export type FallbackStrengths = {
  home: number;
  away: number;
};

export type DeterministicFallbackScoreInput = {
  leagueId: string;
  fixtureId: string;
  homeStrength: number;
  awayStrength: number;
};

export type DeterministicFallbackScoreResult = {
  score: FallbackScore;
  outcome: 'home' | 'away' | 'draw';
  probabilities: {
    draw: number;
    home: number;
    away: number;
  };
  strengthDiff: number;
};

export type EstimateFallbackStrengthInput = {
  players?: unknown[] | null;
  starters?: unknown;
  subs?: unknown;
};

export type FinalizeFixtureWithFallbackInput = {
  leagueId: string;
  fixtureId: string;
  reason: string;
  matchId?: string | null;
};

export type FinalizeFixtureWithFallbackResult =
  | {
      status: 'applied';
      score: FallbackScore;
      strengths: FallbackStrengths;
      reason: string;
    }
  | {
      status: 'skipped_already_played';
      reason: string;
    };

const clamp = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const asPlayerIdSet = (value: unknown): Set<string> =>
  new Set(
    Array.isArray(value)
      ? value
          .map((entry) => normalizeText(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
  );

const createSeededRandom = (seed: string) => {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  if (!value) value = 1;
  return () => {
    value = Math.imul(value, 1664525) + 1013904223;
    return ((value >>> 0) % 1_000_000) / 1_000_000;
  };
};

const pickScoreFromPool = (
  pool: ReadonlyArray<readonly [number, number]>,
  rand: () => number,
): FallbackScore => {
  const index = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
  const [home, away] = pool[index]!;
  return { home, away };
};

const normalizeReason = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/^fallback:/, '');
  return normalized || 'unknown';
};

const normalizeRosterPlayers = (players: unknown[] | null | undefined): FallbackRosterPlayer[] => {
  if (!Array.isArray(players)) {
    return [];
  }

  return players
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => {
      const player = entry as Record<string, unknown>;
      const squadRole = normalizeText(player.squadRole);
      return {
        ...(player as FallbackRosterPlayer),
        id: normalizeText(player.id),
        overall: typeof player.overall === 'number' ? player.overall : Number(player.overall ?? 0),
        injuryStatus: normalizeText(player.injuryStatus),
        squadRole:
          squadRole === 'starting' || squadRole === 'bench' || squadRole === 'reserve'
            ? squadRole
            : 'reserve',
        contract:
          player.contract && typeof player.contract === 'object' && !Array.isArray(player.contract)
            ? (player.contract as RevenueEligiblePlayer['contract'])
            : undefined,
      };
    });
};

function applyPlanRolesToRoster(
  players: FallbackRosterPlayer[],
  starters: Set<string>,
  subs: Set<string>,
): RevenueEligiblePlayer[] {
  if (players.length === 0) {
    return [];
  }

  return players.map((player) => {
    const playerId = normalizeText(player.id);
    if (playerId && starters.has(playerId)) {
      return {
        ...player,
        squadRole: 'starting',
      };
    }
    if (playerId && subs.has(playerId)) {
      return {
        ...player,
        squadRole: 'bench',
      };
    }
    return player;
  });
}

function resolvePlanTeamId(side: MatchPlanSide | null | undefined) {
  return normalizeText(side?.teamId) ?? normalizeText(side?.clubId);
}

export function estimateFallbackTeamStrength(input: EstimateFallbackStrengthInput): number {
  const starters = asPlayerIdSet(input.starters);
  const subs = asPlayerIdSet(input.subs);
  const normalizedPlayers = normalizeRosterPlayers(input.players ?? []);
  const players =
    starters.size > 0 || subs.size > 0
      ? applyPlanRolesToRoster(normalizedPlayers, starters, subs)
      : normalizedPlayers;

  return players.length > 0
    ? getTeamStrengthForRevenue(players)
    : DEFAULT_TEAM_STRENGTH;
}

export function resolveDeterministicFallbackScore(
  input: DeterministicFallbackScoreInput,
): DeterministicFallbackScoreResult {
  const rand = createSeededRandom(`${input.leagueId}:${input.fixtureId}:fallback:v1`);
  const strengthDiff = clamp(
    input.homeStrength + HOME_ADVANTAGE_STRENGTH - input.awayStrength,
    -24,
    24,
  );
  const drawProb = clamp(0.26 - Math.abs(strengthDiff) * 0.004, 0.08, 0.26);
  const homeWinProb = clamp(0.37 + strengthDiff * 0.012, 0.14, 0.78);
  const awayWinProb = Math.max(0, 1 - drawProb - homeWinProb);
  const scoreRoll = rand();

  if (scoreRoll < drawProb) {
    return {
      score: pickScoreFromPool(
        [
          [0, 0],
          [1, 1],
          [1, 1],
          [2, 2],
          [2, 2],
          [3, 3],
        ],
        rand,
      ),
      outcome: 'draw',
      probabilities: {
        draw: drawProb,
        home: homeWinProb,
        away: awayWinProb,
      },
      strengthDiff,
    };
  }

  const strongerPool =
    Math.abs(strengthDiff) >= 13
      ? ([
          [2, 0],
          [3, 0],
          [3, 1],
          [4, 0],
          [4, 1],
          [5, 1],
        ] as const)
      : Math.abs(strengthDiff) >= 6
        ? ([
            [1, 0],
            [2, 0],
            [2, 1],
            [3, 1],
            [3, 0],
            [4, 1],
          ] as const)
        : ([
            [1, 0],
            [2, 1],
            [2, 0],
            [1, 0],
            [3, 1],
          ] as const);

  const homeWins = scoreRoll < drawProb + homeWinProb;
  const selected = pickScoreFromPool(strongerPool, rand);

  return {
    score: homeWins ? selected : { home: selected.away, away: selected.home },
    outcome: homeWins ? 'home' : 'away',
    probabilities: {
      draw: drawProb,
      home: homeWinProb,
      away: awayWinProb,
    },
    strengthDiff,
  };
}

async function loadMatchPlan(planIds: unknown[]) {
  const candidates = Array.from(new Set(planIds.map((value) => normalizeText(value)).filter(Boolean))) as string[];
  if (candidates.length === 0) {
    return null;
  }

  const snapshots = await Promise.all(candidates.map((planId) => db.doc(`matchPlans/${planId}`).get()));
  const planSnap = snapshots.find((snapshot) => snapshot.exists);
  return planSnap?.data() as Record<string, unknown> | null | undefined;
}

async function loadTeamPlayers(teamId: string | null) {
  if (!teamId) {
    return [];
  }

  const teamSnap = await db.doc(`teams/${teamId}`).get();
  if (!teamSnap.exists) {
    return [];
  }

  const teamData = (teamSnap.data() as { players?: unknown[] } | undefined) ?? undefined;
  return Array.isArray(teamData?.players) ? teamData.players : [];
}

export async function finalizeFixtureWithFallbackResult(
  input: FinalizeFixtureWithFallbackInput,
): Promise<FinalizeFixtureWithFallbackResult> {
  const normalizedReason = normalizeReason(input.reason);
  const fixtureRef = db.doc(`leagues/${input.leagueId}/fixtures/${input.fixtureId}`);
  const fixtureBeforeSnap = await fixtureRef.get();
  if (!fixtureBeforeSnap.exists) {
    throw new Error('fixture_not_found');
  }

  const fixtureBefore = (fixtureBeforeSnap.data() as Record<string, unknown>) ?? {};
  if (
    String(fixtureBefore.status || '').trim().toLowerCase() === 'played' &&
    hasCanonicalFixtureScore(fixtureBefore.score)
  ) {
    return {
      status: 'skipped_already_played',
      reason: normalizedReason,
    };
  }

  const resolvedTeamIds = await resolveFixtureRevenueTeamIds(input.leagueId, fixtureBefore);
  const plan = await loadMatchPlan([input.fixtureId, input.matchId]);
  const homePlan = ((plan?.home as MatchPlanSide | undefined) ?? undefined);
  const awayPlan = ((plan?.away as MatchPlanSide | undefined) ?? undefined);
  const homeTeamId =
    normalizeText(resolvedTeamIds.home) ??
    resolvePlanTeamId(homePlan) ??
    normalizeText(fixtureBefore.homeTeamId);
  const awayTeamId =
    normalizeText(resolvedTeamIds.away) ??
    resolvePlanTeamId(awayPlan) ??
    normalizeText(fixtureBefore.awayTeamId);

  const [homePlayers, awayPlayers] = await Promise.all([
    loadTeamPlayers(homeTeamId),
    loadTeamPlayers(awayTeamId),
  ]);

  const strengths = {
    home: estimateFallbackTeamStrength({
      players: homePlayers,
      starters: homePlan?.starters,
      subs: homePlan?.subs,
    }),
    away: estimateFallbackTeamStrength({
      players: awayPlayers,
      starters: awayPlan?.starters,
      subs: awayPlan?.subs,
    }),
  };
  const fallback = resolveDeterministicFallbackScore({
    leagueId: input.leagueId,
    fixtureId: input.fixtureId,
    homeStrength: strengths.home,
    awayStrength: strengths.away,
  });

  let applied = false;
  await db.runTransaction(async (tx) => {
    const currentSnap = await tx.get(fixtureRef);
    if (!currentSnap.exists) {
      throw new Error('fixture_not_found');
    }

    const currentFixture = (currentSnap.data() as Record<string, unknown>) ?? {};
    const currentStatus = String(currentFixture.status || '').trim().toLowerCase();
    if (currentStatus === 'played' && hasCanonicalFixtureScore(currentFixture.score)) {
      return;
    }

    const updatePatch: Record<string, unknown> = {
      status: 'played',
      score: fallback.score,
      playedAt: FieldValue.serverTimestamp(),
      endedAt: FieldValue.serverTimestamp(),
      failedAt: FieldValue.delete(),
      failReason: FieldValue.delete(),
      replayPath: FieldValue.delete(),
      video: FieldValue.delete(),
      videoMissing: false,
      videoError: FieldValue.delete(),
      'live.state': 'ended',
      'live.endedAt': FieldValue.serverTimestamp(),
      'live.lastLifecycleAt': FieldValue.serverTimestamp(),
      'live.resultMissing': false,
      'live.reason': `fallback:${normalizedReason}`,
      'live.resultSource': 'fallback',
      'live.fallbackReason': normalizedReason,
      'live.fallbackStrength': strengths,
      'live.fallbackAppliedAt': FieldValue.serverTimestamp(),
      'live.fallbackVersion': FALLBACK_VERSION,
    };

    await applyLeagueResultSideEffectsInTx(tx, fixtureRef, currentFixture, {
      score: fallback.score,
      resolvedTeamIds,
    });
    tx.set(fixtureRef, updatePatch, { merge: true });
    applied = true;
  });

  if (!applied) {
    return {
      status: 'skipped_already_played',
      reason: normalizedReason,
    };
  }

  try {
    await applyLeagueLineupMotivationEffects(input.leagueId, input.fixtureId);
  } catch (error: any) {
    console.warn('[matchResultFallback] lineup motivation skipped', {
      leagueId: input.leagueId,
      fixtureId: input.fixtureId,
      error: error?.message || String(error),
    });
  }

  return {
    status: 'applied',
    score: fallback.score,
    strengths,
    reason: normalizedReason,
  };
}
