import { collection, getDocs } from 'firebase/firestore';

import type { ChampionsLeagueEntrantDoc, KnockoutMatchDoc, League } from '@/types';
import { isChampionsLeagueCompetition } from '@/lib/competition';
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

function mapLeague(id: string, raw: Record<string, unknown>): League {
  return {
    id,
    name: raw.name || 'Şampiyonlar Ligi',
    season: Number(raw.season || 1),
    capacity: Number(raw.capacity || 0),
    timezone: raw.timezone || 'Europe/Istanbul',
    state: raw.state || 'scheduled',
    startDate: raw.startDate,
    rounds: Number(raw.rounds || 0),
    teamCount: Number(raw.teamCount || 0),
    teams: Array.isArray(raw.teams) ? raw.teams : [],
    competitionType: raw.competitionType,
    competitionFormat: raw.competitionFormat,
    hiddenFromLeagueList: raw.hiddenFromLeagueList,
    sourceMonth: raw.sourceMonth,
    snapshotAt: raw.snapshotAt,
    roundSpacingDays: raw.roundSpacingDays,
    championTeamId: raw.championTeamId ?? null,
  };
}

function mapKnockoutMatch(id: string, raw: Record<string, unknown>): KnockoutMatchDoc {
  return {
    id,
    round: Number(raw.round || 0),
    slot: Number(raw.slot || 0),
    roundName: raw.roundName || `Tur ${raw.round || 0}`,
    scheduledAt: toDate(raw.scheduledAt) || new Date(),
    homeSeed: raw.homeSeed ?? null,
    awaySeed: raw.awaySeed ?? null,
    homeTeamId: raw.homeTeamId ?? null,
    awayTeamId: raw.awayTeamId ?? null,
    homeTeamName: raw.homeTeamName ?? null,
    awayTeamName: raw.awayTeamName ?? null,
    homeLeagueId: raw.homeLeagueId ?? null,
    awayLeagueId: raw.awayLeagueId ?? null,
    homeLeagueName: raw.homeLeagueName ?? null,
    awayLeagueName: raw.awayLeagueName ?? null,
    homeSourceMatchId: raw.homeSourceMatchId ?? null,
    awaySourceMatchId: raw.awaySourceMatchId ?? null,
    fixtureId: raw.fixtureId ?? null,
    status: raw.status || 'pending',
    winnerTeamId: raw.winnerTeamId ?? null,
    winnerTeamName: raw.winnerTeamName ?? null,
    loserTeamId: raw.loserTeamId ?? null,
    decidedBy: raw.decidedBy ?? null,
    penalties: raw.penalties ?? null,
    score: raw.score ?? null,
    isBye: raw.isBye ?? false,
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
      const monthCompare = compareMonthKey(right.raw.sourceMonth, left.raw.sourceMonth);
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
