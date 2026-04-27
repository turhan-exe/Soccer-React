import { collection, getDocs, type Timestamp } from 'firebase/firestore';

import type {
  ChampionsLeagueEntrantDoc,
  CompetitionFormat,
  CompetitionType,
  KnockoutDecision,
  KnockoutMatchDoc,
  KnockoutMatchStatus,
  League,
} from '@/types';
import { isChampionsLeagueCompetition } from '@/lib/competition';
import { normalizeFixtureScore } from '@/lib/fixtureScore';
import { db } from './firebase';
import { resolveLiveTeamIdentities, type LiveTeamIdentity } from './teamIdentity';

function toDate(value: unknown): Date | null {
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  return null;
}

function compareMonthKey(left: string | undefined, right: string | undefined) {
  return String(left || '').localeCompare(String(right || ''));
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function stringOr(value: unknown, fallback: string): string {
  return stringOrNull(value) ?? fallback;
}

function numberOr(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function booleanOr(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function timestampOrUndefined(value: unknown): Timestamp | undefined {
  return value && typeof (value as { toDate?: () => Date }).toDate === 'function'
    ? value as Timestamp
    : undefined;
}

function competitionTypeOrUndefined(value: unknown): CompetitionType | undefined {
  return value === 'domestic' || value === 'champions_league' ? value : undefined;
}

function competitionFormatOrUndefined(value: unknown): CompetitionFormat | undefined {
  return value === 'round_robin' || value === 'knockout' ? value : undefined;
}

function leagueStateOr(value: unknown): League['state'] {
  return value === 'forming' || value === 'scheduled' || value === 'active' || value === 'completed'
    ? value
    : 'scheduled';
}

function knockoutStatusOr(value: unknown): KnockoutMatchStatus {
  return value === 'pending'
    || value === 'scheduled'
    || value === 'running'
    || value === 'completed'
    || value === 'failed'
    ? value
    : 'pending';
}

function knockoutDecisionOrNull(value: unknown): KnockoutDecision {
  return value === 'bye' || value === 'normal' || value === 'penalties' ? value : null;
}

function seedOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function scoreOrNull(value: unknown): { home: number; away: number } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const home = numberOr(record.home, Number.NaN);
  const away = numberOr(record.away, Number.NaN);
  return Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null;
}

function mapLeague(id: string, raw: Record<string, unknown>): League {
  return {
    id,
    name: raw.name || 'Şampiyonlar Ligi',
    season: numberOr(raw.season, 1),
    capacity: numberOr(raw.capacity),
    timezone: stringOr(raw.timezone, 'Europe/Istanbul'),
    state: leagueStateOr(raw.state),
    startDate: timestampOrUndefined(raw.startDate),
    rounds: numberOr(raw.rounds),
    teamCount: numberOr(raw.teamCount),
    teams: Array.isArray(raw.teams) ? raw.teams : [],
    competitionType: competitionTypeOrUndefined(raw.competitionType),
    competitionFormat: competitionFormatOrUndefined(raw.competitionFormat),
    hiddenFromLeagueList: booleanOr(raw.hiddenFromLeagueList),
    sourceMonth: stringOrNull(raw.sourceMonth) ?? undefined,
    snapshotAt: timestampOrUndefined(raw.snapshotAt),
    roundSpacingDays: numberOr(raw.roundSpacingDays),
    championTeamId: stringOrNull(raw.championTeamId),
  } as League;
}

function mapKnockoutMatch(id: string, raw: Record<string, unknown>): KnockoutMatchDoc {
  return {
    id,
    round: numberOr(raw.round),
    slot: numberOr(raw.slot),
    roundName: stringOr(raw.roundName, `Tur ${numberOr(raw.round)}`),
    scheduledAt: toDate(raw.scheduledAt) || new Date(),
    homeSeed: seedOrNull(raw.homeSeed),
    awaySeed: seedOrNull(raw.awaySeed),
    homeTeamId: stringOrNull(raw.homeTeamId),
    awayTeamId: stringOrNull(raw.awayTeamId),
    homeTeamName: stringOrNull(raw.homeTeamName),
    awayTeamName: stringOrNull(raw.awayTeamName),
    homeLeagueId: stringOrNull(raw.homeLeagueId),
    awayLeagueId: stringOrNull(raw.awayLeagueId),
    homeLeagueName: stringOrNull(raw.homeLeagueName),
    awayLeagueName: stringOrNull(raw.awayLeagueName),
    homeSourceMatchId: stringOrNull(raw.homeSourceMatchId),
    awaySourceMatchId: stringOrNull(raw.awaySourceMatchId),
    fixtureId: stringOrNull(raw.fixtureId),
    status: knockoutStatusOr(raw.status),
    winnerTeamId: stringOrNull(raw.winnerTeamId),
    winnerTeamName: stringOrNull(raw.winnerTeamName),
    loserTeamId: stringOrNull(raw.loserTeamId),
    decidedBy: knockoutDecisionOrNull(raw.decidedBy),
    penalties: scoreOrNull(raw.penalties),
    score: normalizeFixtureScore(raw.score),
    isBye: booleanOr(raw.isBye),
    resolvedAt: toDate(raw.resolvedAt),
  };
}

function hydrateLeagueTeams(league: League, liveNames: Map<string, LiveTeamIdentity>): League {
  if (!Array.isArray(league.teams) || league.teams.length === 0) {
    return league;
  }

  let changed = false;
  const teams = league.teams.map((team) => {
    const resolvedName = liveNames.get(team.id)?.teamName;
    if (!resolvedName || resolvedName === team.name) {
      return team;
    }

    changed = true;
    return {
      ...team,
      name: resolvedName,
    };
  });

  return changed ? { ...league, teams } : league;
}

export async function getLatestChampionsLeagueOverview(): Promise<{
  league: League;
  entrants: ChampionsLeagueEntrantDoc[];
  matches: KnockoutMatchDoc[];
} | null> {
  const leaguesSnap = await getDocs(collection(db, 'leagues'));
  const competitions = leaguesSnap.docs
    .map((docSnap) => ({ id: docSnap.id, raw: docSnap.data() as Record<string, unknown> }))
    .filter((entry) => isChampionsLeagueCompetition(entry.raw))
    .sort((left, right) => {
      const monthCompare = compareMonthKey(
        stringOrNull(right.raw.sourceMonth) ?? undefined,
        stringOrNull(left.raw.sourceMonth) ?? undefined,
      );
      if (monthCompare !== 0) return monthCompare;
      const leftStart = toDate(left.raw.startDate)?.getTime() || 0;
      const rightStart = toDate(right.raw.startDate)?.getTime() || 0;
      return rightStart - leftStart;
    });

  if (competitions.length === 0) {
    return null;
  }

  const latest = competitions[0]!;
  const league = mapLeague(latest.id, latest.raw);
  const [entrantsSnap, matchesSnap] = await Promise.all([
    getDocs(collection(db, 'leagues', latest.id, 'entrants')),
    getDocs(collection(db, 'leagues', latest.id, 'knockoutMatches')),
  ]);

  const entrants = entrantsSnap.docs
    .map((docSnap) => ({
      teamId: docSnap.id,
      ...(docSnap.data() as Omit<ChampionsLeagueEntrantDoc, 'teamId'>),
    }))
    .sort((left, right) => Number(left.seed || 0) - Number(right.seed || 0));

  const matches = matchesSnap.docs
    .map((docSnap) => mapKnockoutMatch(docSnap.id, docSnap.data() as Record<string, unknown>))
    .sort((left, right) => left.round - right.round || left.slot - right.slot);

  const liveIdentities = await resolveLiveTeamIdentities([
    ...entrants.map((entrant) => entrant.teamId),
    ...matches.flatMap((match) => [
      match.homeTeamId ?? '',
      match.awayTeamId ?? '',
      match.winnerTeamId ?? '',
    ]),
    ...((league.teams ?? []).map((team) => team.id)),
  ]);

  const hydratedEntrants = entrants.map((entrant) => {
    const identity = liveIdentities.get(entrant.teamId);
    if (!identity?.teamName || identity.teamName === entrant.teamName) {
      return entrant;
    }

    return {
      ...entrant,
      teamName: identity.teamName,
    };
  });

  const hydratedMatches = matches.map((match) => {
    const homeIdentity = match.homeTeamId ? liveIdentities.get(match.homeTeamId) : undefined;
    const awayIdentity = match.awayTeamId ? liveIdentities.get(match.awayTeamId) : undefined;
    const winnerIdentity = match.winnerTeamId ? liveIdentities.get(match.winnerTeamId) : undefined;
    const nextHomeTeamName = homeIdentity?.teamName || match.homeTeamName || null;
    const nextAwayTeamName = awayIdentity?.teamName || match.awayTeamName || null;
    const nextWinnerTeamName =
      winnerIdentity?.teamName
      || (match.winnerTeamId && match.winnerTeamId === match.homeTeamId ? nextHomeTeamName : null)
      || (match.winnerTeamId && match.winnerTeamId === match.awayTeamId ? nextAwayTeamName : null)
      || match.winnerTeamName
      || null;

    if (
      nextHomeTeamName === (match.homeTeamName || null)
      && nextAwayTeamName === (match.awayTeamName || null)
      && nextWinnerTeamName === (match.winnerTeamName || null)
    ) {
      return match;
    }

    return {
      ...match,
      homeTeamName: nextHomeTeamName,
      awayTeamName: nextAwayTeamName,
      winnerTeamName: nextWinnerTeamName,
    };
  });

  return {
    league: hydrateLeagueTeams(league, liveIdentities),
    entrants: hydratedEntrants,
    matches: hydratedMatches,
  };
}
