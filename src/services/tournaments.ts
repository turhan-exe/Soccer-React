import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { collection, getDocs, query, where } from 'firebase/firestore';

import type {
  KnockoutMatch,
  KnockoutMatchLeg,
  KnockoutResult,
  TournamentBracket,
  TournamentParticipant,
  TournamentRound,
  League,
  Standing,
} from '@/types';
import { db } from './firebase';

interface BuildBracketOptions {
  name: string;
  slug: string;
  kickoffHour: number;
  timezone?: string;
  startDate?: Date;
  roundSpacingDays?: number;
  legsPerTie?: number;
  legKickoffHours?: number[];
}

interface ConferenceOptions extends Omit<BuildBracketOptions, 'name' | 'slug' | 'kickoffHour'> {
  kickoffHour?: number;
  name?: string;
  slug?: string;
}

const DEFAULT_TIMEZONE = 'Europe/Istanbul';

function buildSeedOrder(size: number): number[] {
  if (size < 1 || (size & (size - 1)) !== 0) {
    throw new Error('size must be a power of two');
  }
  if (size === 1) return [1];
  const prev = buildSeedOrder(size / 2);
  const out: number[] = [];
  for (let i = 0; i < prev.length; i++) {
    out.push(prev[i]);
    out.push(size + 1 - prev[i]);
  }
  return out;
}

function sortParticipants(participants: TournamentParticipant[]): TournamentParticipant[] {
  return [...participants].sort((a, b) => {
    if (a.leaguePosition !== b.leaguePosition) return a.leaguePosition - b.leaguePosition;
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.scored !== a.scored) return b.scored - a.scored;
    return a.teamName.localeCompare(b.teamName);
  });
}

function roundName(bracketSize: number, roundIndex: number): string {
  const remaining = bracketSize / Math.pow(2, roundIndex);
  if (remaining === 2) return 'Final';
  if (remaining === 4) return 'Semi Final';
  if (remaining === 8) return 'Quarter Final';
  if (remaining === 16) return 'Round of 16';
  return `Round of ${remaining}`;
}

function kickoffForRound(
  baseDate: Date,
  timezone: string,
  hour: number,
  roundIndex: number,
  spacingDays: number
): Date {
  const targetDate = addDays(baseDate, roundIndex * spacingDays);
  const dayStr = formatInTimeZone(targetDate, timezone, 'yyyy-MM-dd');
  const hourStr = hour.toString().padStart(2, '0');
  return fromZonedTime(`${dayStr}T${hourStr}:00:00`, timezone);
}

type Entry =
  | { type: 'seed'; seed: number }
  | { type: 'winner'; matchId: string };

export function buildKnockoutBracket(
  participants: TournamentParticipant[],
  options: BuildBracketOptions
): TournamentBracket {
  if (participants.length < 2) {
    throw new Error('At least two participants required to build bracket');
  }

  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const startDate = options.startDate ?? new Date();
  const roundSpacingDays = options.roundSpacingDays ?? 2;
  const seeded = sortParticipants(participants).map((p, idx) => ({ ...p, seed: idx + 1 }));
  const participantBySeed = new Map<number, TournamentParticipant>();
  seeded.forEach((p) => {
    participantBySeed.set(p.seed!, p);
  });

  const bracketSize = 1 << Math.ceil(Math.log2(seeded.length));
  const seedOrder = buildSeedOrder(bracketSize);
  const legsPerTie = Math.max(1, options.legsPerTie ?? 1);
  const resolvedLegHours: number[] = [];
  for (let legIndex = 0; legIndex < legsPerTie; legIndex++) {
    if (options.legKickoffHours && options.legKickoffHours[legIndex] != null) {
      resolvedLegHours.push(options.legKickoffHours[legIndex]!);
    } else if (legIndex === 0) {
      resolvedLegHours.push(options.kickoffHour);
    } else {
      const previous = resolvedLegHours[legIndex - 1];
      const nextHour = previous + 6;
      resolvedLegHours.push(nextHour > 23 ? 23 : nextHour);
    }
  }

  const rounds: TournamentRound[] = [];
  let currentEntries: Entry[] = seedOrder.map((seed) => ({ type: 'seed', seed }));

  for (let roundIdx = 0; roundIdx < Math.log2(bracketSize); roundIdx++) {
    const matches: KnockoutMatch[] = [];
    const matchCount = currentEntries.length / 2;
    const kickoff = kickoffForRound(startDate, timezone, options.kickoffHour, roundIdx, roundSpacingDays);

    for (let i = 0; i < matchCount; i++) {
      const homeEntry = currentEntries[i * 2];
      const awayEntry = currentEntries[i * 2 + 1];
      const id = `${options.slug}-R${roundIdx + 1}-M${i + 1}`;
      const homeSeed = homeEntry.type === 'seed' ? homeEntry.seed : null;
      const awaySeed = awayEntry.type === 'seed' ? awayEntry.seed : null;
      const homeParticipant = homeSeed ? participantBySeed.get(homeSeed) ?? null : null;
      const awayParticipant = awaySeed ? participantBySeed.get(awaySeed) ?? null : null;
      const homeSource = homeEntry.type === 'winner' ? { type: 'winner', matchId: homeEntry.matchId } : undefined;
      const awaySource = awayEntry.type === 'winner' ? { type: 'winner', matchId: awayEntry.matchId } : undefined;
      const hasHome = !!homeParticipant || !!homeSource;
      const hasAway = !!awayParticipant || !!awaySource;
      const isBye = hasHome && !hasAway || hasAway && !hasHome;
      const autoAdvanceSeed = isBye ? homeParticipant?.seed ?? awayParticipant?.seed ?? null : null;
      let legs: KnockoutMatchLeg[] = [];
      if (!isBye) {
        legs = Array.from({ length: legsPerTie }, (_, legIndex) => {
          const swapHome = legsPerTie > 1 && legIndex % 2 === 0;
          const legHomeSeed = swapHome ? awaySeed : homeSeed;
          const legAwaySeed = swapHome ? homeSeed : awaySeed;
          const legHomeParticipant = swapHome ? awayParticipant : homeParticipant;
          const legAwayParticipant = swapHome ? homeParticipant : awayParticipant;
          const legHour =
            resolvedLegHours[legIndex] ?? resolvedLegHours[resolvedLegHours.length - 1] ?? options.kickoffHour;
          const legKickoff = kickoffForRound(startDate, timezone, legHour, roundIdx, roundSpacingDays);
          return {
            leg: legIndex + 1,
            scheduledAt: legKickoff,
            homeSeed: legHomeSeed ?? null,
            awaySeed: legAwaySeed ?? null,
            homeParticipant: legHomeParticipant ?? null,
            awayParticipant: legAwayParticipant ?? null,
          };
        });
      }

      matches.push({
        id,
        round: roundIdx + 1,
        roundName: roundName(bracketSize, roundIdx),
        scheduledAt: legs[0]?.scheduledAt ?? kickoff,
        homeSeed,
        awaySeed,
        homeParticipant: homeParticipant ?? null,
        awayParticipant: awayParticipant ?? null,
        homeSource,
        awaySource,
        isBye,
        autoAdvanceSeed,
        legs,
      });
    }

    rounds.push({
      round: roundIdx + 1,
      name: roundName(bracketSize, roundIdx),
      matches,
    });

    currentEntries = matches.map((match) => {
      if (match.autoAdvanceSeed) {
        return { type: 'seed', seed: match.autoAdvanceSeed } as Entry;
      }
      return { type: 'winner', matchId: match.id } as Entry;
    });
  }

  return {
    name: options.name,
    slug: options.slug,
    timezone,
    kickoffHour: options.kickoffHour,
    participants: seeded,
    rounds,
  };
}

export async function fetchChampionsLeagueParticipants(): Promise<TournamentParticipant[]> {
  const q = query(collection(db, 'leagues'), where('state', '==', 'completed'));
  const leaguesSnap = await getDocs(q);
  const participants: TournamentParticipant[] = [];

  await Promise.all(
    leaguesSnap.docs.map(async (leagueDoc) => {
      const leagueData = leagueDoc.data() as League;
      const standingsSnap = await getDocs(collection(leagueDoc.ref, 'standings'));
      if (standingsSnap.empty) return;
      const standings = standingsSnap.docs
        .map((d) => d.data() as Standing)
        .filter((row) => !!row.teamId);
      standings.sort((a, b) => {
        if (b.Pts !== a.Pts) return b.Pts - a.Pts;
        if (b.GD !== a.GD) return b.GD - a.GD;
        if (b.GF !== a.GF) return b.GF - a.GF;
        return (a.name || a.teamId).localeCompare(b.name || b.teamId);
      });
      standings.slice(0, 2).forEach((row, index) => {
        if (!row.teamId) return;
        participants.push({
          teamId: row.teamId,
          teamName: row.name || row.teamId,
          leagueId: leagueDoc.id,
          leagueName: leagueData.name || leagueDoc.id,
          leaguePosition: index + 1,
          points: row.Pts ?? 0,
          goalDifference: row.GD ?? 0,
          scored: row.GF ?? 0,
        });
      });
    })
  );

  return sortParticipants(participants);
}

export async function buildChampionsLeagueTournament(options?: Partial<BuildBracketOptions>): Promise<TournamentBracket> {
  const participants = await fetchChampionsLeagueParticipants();
  const legsPerTie = options?.legsPerTie ?? 2;
  const kickoffHour = options?.legKickoffHours?.[0] ?? options?.kickoffHour ?? 11;
  const name = options?.name ?? 'Şampiyonlar Ligi';
  const slug = options?.slug ?? 'champions-league';
  const timezone = options?.timezone ?? DEFAULT_TIMEZONE;
  const startDate = options?.startDate ?? new Date();
  const roundSpacingDays = options?.roundSpacingDays ?? 2;
  const legKickoffHours = options?.legKickoffHours ? [...options.legKickoffHours] : [kickoffHour, 20];
  if (legKickoffHours.length === 0) {
    legKickoffHours.push(kickoffHour);
  }
  while (legKickoffHours.length < legsPerTie) {
    const prev = legKickoffHours[legKickoffHours.length - 1];
    legKickoffHours.push(prev >= 23 ? 23 : prev + 6);
  }

  return buildKnockoutBracket(participants, {
    name,
    slug,
    kickoffHour,
    timezone,
    startDate,
    roundSpacingDays,
    legsPerTie,
    legKickoffHours,
  });
}

export function buildConferenceLeagueTournament(
  champions: TournamentBracket,
  roundOneResults: KnockoutResult[],
  options?: ConferenceOptions
): TournamentBracket {
  const losers = new Map<string, TournamentParticipant>();
  const participantsByTeamId = new Map<string, TournamentParticipant>();
  champions.participants.forEach((p) => {
    if (p.teamId) participantsByTeamId.set(p.teamId, p);
  });

  roundOneResults.forEach((result) => {
    const loser = participantsByTeamId.get(result.loserTeamId);
    if (loser) {
      losers.set(loser.teamId, { ...loser });
    }
  });

  if (losers.size === 0) {
    throw new Error('No eligible teams found for Conference League');
  }

  const kickoffHour = options?.kickoffHour ?? 12;
  const name = options?.name ?? 'Konferans Ligi';
  const slug = options?.slug ?? 'conference-league';
  const timezone = options?.timezone ?? champions.timezone ?? DEFAULT_TIMEZONE;
  const startDate = options?.startDate ?? addDays(new Date(), 1);
  const roundSpacingDays = options?.roundSpacingDays ?? 2;

  return buildKnockoutBracket(Array.from(losers.values()), {
    name,
    slug,
    kickoffHour,
    timezone,
    startDate,
    roundSpacingDays,
  });
}
