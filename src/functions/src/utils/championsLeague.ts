import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

const DEFAULT_TIMEZONE = 'Europe/Istanbul';

export type ChampionsLeagueParticipantSeed = {
  teamId: string;
  teamName: string;
  leagueId: string;
  leagueName: string;
  leaguePosition: number;
  points: number;
  goalDifference: number;
  scored: number;
  ownerUid?: string | null;
  logo?: string | null;
  seed?: number;
};

export type ChampionsLeagueKnockoutMatchPlan = {
  id: string;
  round: number;
  slot: number;
  roundName: string;
  scheduledAt: Date;
  homeSeed: number | null;
  awaySeed: number | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  homeLeagueId: string | null;
  awayLeagueId: string | null;
  homeLeagueName: string | null;
  awayLeagueName: string | null;
  homeSourceMatchId: string | null;
  awaySourceMatchId: string | null;
  isBye: boolean;
  status: 'pending' | 'scheduled' | 'running' | 'completed' | 'failed';
  winnerTeamId: string | null;
  winnerTeamName: string | null;
  loserTeamId: string | null;
  decidedBy: 'bye' | 'normal' | 'penalties' | null;
  score: { home: number; away: number } | null;
  penalties: { home: number; away: number } | null;
  resolvedAt: Date | null;
};

type SeedEntry =
  | { type: 'seed'; seed: number }
  | { type: 'winner'; matchId: string };

export type BuildChampionsLeagueBracketOptions = {
  slug: string;
  startDate: Date;
  kickoffHour: number;
  roundSpacingDays: number;
  timezone?: string;
};

function buildSeedOrder(size: number): number[] {
  if (size < 1 || (size & (size - 1)) !== 0) {
    throw new Error('size must be a power of two');
  }
  if (size === 1) return [1];
  const previous = buildSeedOrder(size / 2);
  const ordered: number[] = [];
  for (const seed of previous) {
    ordered.push(seed);
    ordered.push(size + 1 - seed);
  }
  return ordered;
}

function kickoffForRound(
  baseDate: Date,
  timezone: string,
  kickoffHour: number,
  roundIndex: number,
  spacingDays: number,
) {
  const targetDate = addDays(baseDate, roundIndex * spacingDays);
  const dayString = formatInTimeZone(targetDate, timezone, 'yyyy-MM-dd');
  return fromZonedTime(`${dayString}T${String(kickoffHour).padStart(2, '0')}:00:00`, timezone);
}

export function seedChampionsLeagueParticipants(
  participants: ChampionsLeagueParticipantSeed[],
): ChampionsLeagueParticipantSeed[] {
  return [...participants]
    .sort((left, right) => {
      if (left.leaguePosition !== right.leaguePosition) {
        return left.leaguePosition - right.leaguePosition;
      }
      if (right.points !== left.points) {
        return right.points - left.points;
      }
      if (right.goalDifference !== left.goalDifference) {
        return right.goalDifference - left.goalDifference;
      }
      if (right.scored !== left.scored) {
        return right.scored - left.scored;
      }
      return left.teamName.localeCompare(right.teamName);
    })
    .map((participant, index) => ({
      ...participant,
      seed: index + 1,
    }));
}

function roundName(bracketSize: number, roundIndex: number) {
  const remaining = bracketSize / Math.pow(2, roundIndex);
  if (remaining === 2) return 'Final';
  if (remaining === 4) return 'Yari Final';
  if (remaining === 8) return 'Ceyrek Final';
  if (remaining === 16) return 'Son 16';
  return `Son ${remaining}`;
}

export function buildChampionsLeagueKnockoutPlan(
  participants: ChampionsLeagueParticipantSeed[],
  options: BuildChampionsLeagueBracketOptions,
) {
  if (participants.length < 2) {
    throw new Error('At least two participants are required');
  }

  const seeded = seedChampionsLeagueParticipants(participants);
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const bracketSize = 1 << Math.ceil(Math.log2(seeded.length));
  const seedOrder = buildSeedOrder(bracketSize);
  const participantBySeed = new Map<number, ChampionsLeagueParticipantSeed>();
  seeded.forEach((participant) => {
    participantBySeed.set(participant.seed!, participant);
  });

  const rounds: ChampionsLeagueKnockoutMatchPlan[][] = [];
  let currentEntries: SeedEntry[] = seedOrder.map((seed) => ({ type: 'seed', seed }));

  for (let roundIndex = 0; roundIndex < Math.log2(bracketSize); roundIndex += 1) {
    const matches: ChampionsLeagueKnockoutMatchPlan[] = [];
    const kickoffAt = kickoffForRound(
      options.startDate,
      timezone,
      options.kickoffHour,
      roundIndex,
      options.roundSpacingDays,
    );
    const matchCount = currentEntries.length / 2;

    for (let slot = 0; slot < matchCount; slot += 1) {
      const homeEntry = currentEntries[slot * 2]!;
      const awayEntry = currentEntries[slot * 2 + 1]!;
      const homeSeed = homeEntry.type === 'seed' ? homeEntry.seed : null;
      const awaySeed = awayEntry.type === 'seed' ? awayEntry.seed : null;
      const homeParticipant = homeSeed ? participantBySeed.get(homeSeed) ?? null : null;
      const awayParticipant = awaySeed ? participantBySeed.get(awaySeed) ?? null : null;
      const hasHome = Boolean(homeParticipant) || homeEntry.type === 'winner';
      const hasAway = Boolean(awayParticipant) || awayEntry.type === 'winner';
      const isBye = (hasHome && !hasAway) || (!hasHome && hasAway);
      const winner = isBye ? (homeParticipant ?? awayParticipant) : null;
      const matchId = `${options.slug}-R${roundIndex + 1}-M${slot + 1}`;

      matches.push({
        id: matchId,
        round: roundIndex + 1,
        slot: slot + 1,
        roundName: roundName(bracketSize, roundIndex),
        scheduledAt: kickoffAt,
        homeSeed,
        awaySeed,
        homeTeamId: homeParticipant?.teamId ?? null,
        awayTeamId: awayParticipant?.teamId ?? null,
        homeTeamName: homeParticipant?.teamName ?? null,
        awayTeamName: awayParticipant?.teamName ?? null,
        homeLeagueId: homeParticipant?.leagueId ?? null,
        awayLeagueId: awayParticipant?.leagueId ?? null,
        homeLeagueName: homeParticipant?.leagueName ?? null,
        awayLeagueName: awayParticipant?.leagueName ?? null,
        homeSourceMatchId: homeEntry.type === 'winner' ? homeEntry.matchId : null,
        awaySourceMatchId: awayEntry.type === 'winner' ? awayEntry.matchId : null,
        isBye,
        status: isBye ? 'completed' : (homeParticipant && awayParticipant ? 'scheduled' : 'pending'),
        winnerTeamId: winner?.teamId ?? null,
        winnerTeamName: winner?.teamName ?? null,
        loserTeamId: null,
        decidedBy: isBye ? 'bye' : null,
        score: null,
        penalties: null,
        resolvedAt: isBye ? kickoffAt : null,
      });
    }

    rounds.push(matches);
    currentEntries = matches.map((match) =>
      match.winnerTeamId && match.decidedBy === 'bye'
        ? ({ type: 'seed', seed: match.homeSeed ?? match.awaySeed ?? 0 } as SeedEntry)
        : ({ type: 'winner', matchId: match.id } as SeedEntry),
    );
  }

  return {
    participants: seeded,
    bracketSize,
    rounds,
    totalRounds: rounds.length,
  };
}

function createSeededRandom(seed: string) {
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
}

export function estimatePlanSideStrength(side: Record<string, any> | null | undefined) {
  const lineup = Array.isArray(side?.lineup) ? side!.lineup : [];
  if (lineup.length === 0) {
    return 50;
  }

  const total = lineup.reduce((sum: number, player: Record<string, any>) => {
    const attributes = player?.attributes && typeof player.attributes === 'object'
      ? Object.entries(player.attributes as Record<string, unknown>)
      : [];
    const values = attributes
      .filter(([key, value]) => key !== 'height' && key !== 'weight' && Number.isFinite(Number(value)))
      .map(([, value]) => Number(value));
    if (values.length === 0) {
      return sum + 50;
    }
    return sum + (values.reduce((acc, current) => acc + current, 0) / values.length);
  }, 0);

  return total / lineup.length;
}

export function resolveDeterministicPenaltyShootout(input: {
  matchId: string;
  homeOverall: number;
  awayOverall: number;
}) {
  const rand = createSeededRandom(input.matchId);
  const diff = Math.max(-18, Math.min(18, input.homeOverall - input.awayOverall));
  const baseHomeChance = Math.max(0.62, Math.min(0.84, 0.74 + diff / 200));
  const baseAwayChance = Math.max(0.62, Math.min(0.84, 0.74 - diff / 200));

  let home = 0;
  let away = 0;

  for (let kick = 0; kick < 5; kick += 1) {
    if (rand() < baseHomeChance) home += 1;
    if (rand() < baseAwayChance) away += 1;
  }

  let suddenDeathRounds = 0;
  while (home === away && suddenDeathRounds < 10) {
    suddenDeathRounds += 1;
    const homeScored = rand() < baseHomeChance;
    const awayScored = rand() < baseAwayChance;
    if (homeScored) home += 1;
    if (awayScored) away += 1;
    if (home !== away) break;
  }

  if (home === away) {
    if (rand() >= 0.5) {
      home += 1;
    } else {
      away += 1;
    }
  }

  return {
    penalties: { home, away },
    winner: home > away ? 'home' as const : 'away' as const,
  };
}

export function resolveScheduledAtFromSources(input: {
  nominalScheduledAt: Date;
  latestResolvedAt: Date | null;
  kickoffHour: number;
  roundSpacingDays: number;
  timezone?: string;
}) {
  if (!input.latestResolvedAt) {
    return input.nominalScheduledAt;
  }

  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const minDate = addDays(input.latestResolvedAt, input.roundSpacingDays);
  const minDayString = formatInTimeZone(minDate, timezone, 'yyyy-MM-dd');
  const minKickoff = fromZonedTime(
    `${minDayString}T${String(input.kickoffHour).padStart(2, '0')}:00:00`,
    timezone,
  );

  return minKickoff.getTime() > input.nominalScheduledAt.getTime()
    ? minKickoff
    : input.nominalScheduledAt;
}
