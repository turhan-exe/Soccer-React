import { collection, getDocs } from 'firebase/firestore';

import type { ChampionsLeagueEntrantDoc, KnockoutMatchDoc, League } from '@/types';
import { isChampionsLeagueCompetition } from '@/lib/competition';
import { db } from './firebase';

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

function mapLeague(id: string, raw: Record<string, any>): League {
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

function mapKnockoutMatch(id: string, raw: Record<string, any>): KnockoutMatchDoc {
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

export async function getLatestChampionsLeagueOverview(): Promise<{
  league: League;
  entrants: ChampionsLeagueEntrantDoc[];
  matches: KnockoutMatchDoc[];
} | null> {
  const leaguesSnap = await getDocs(collection(db, 'leagues'));
  const competitions = leaguesSnap.docs
    .map((docSnap) => ({ id: docSnap.id, raw: docSnap.data() as Record<string, any> }))
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
    .map((docSnap) => mapKnockoutMatch(docSnap.id, docSnap.data() as Record<string, any>))
    .sort((left, right) => left.round - right.round || left.slot - right.slot);

  return { league, entrants, matches };
}
