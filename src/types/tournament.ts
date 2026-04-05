export interface TournamentParticipant {
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
}

export interface SlotSourceSeed {
  type: 'seed';
  seed: number;
}

export interface SlotSourceWinner {
  type: 'winner';
  matchId: string;
}

export type SlotSource = SlotSourceSeed | SlotSourceWinner;

export interface KnockoutMatchLeg {
  leg: number;
  scheduledAt: Date;
  homeSeed: number | null;
  awaySeed: number | null;
  homeParticipant: TournamentParticipant | null;
  awayParticipant: TournamentParticipant | null;
}

export interface KnockoutMatch {
  id: string;
  round: number;
  slot?: number;
  roundName: string;
  scheduledAt: Date;
  homeSeed: number | null;
  awaySeed: number | null;
  homeParticipant: TournamentParticipant | null;
  awayParticipant: TournamentParticipant | null;
  homeSource?: SlotSourceWinner;
  awaySource?: SlotSourceWinner;
  isBye: boolean;
  autoAdvanceSeed: number | null;
  legs: KnockoutMatchLeg[];
}

export type KnockoutDecision = 'bye' | 'normal' | 'penalties' | null;
export type KnockoutMatchStatus = 'pending' | 'scheduled' | 'running' | 'completed' | 'failed';

export interface ChampionsLeagueEntrantDoc extends TournamentParticipant {
  sourceMonth?: string;
}

export interface KnockoutMatchDoc {
  id: string;
  round: number;
  slot: number;
  roundName: string;
  scheduledAt: Date;
  homeSeed: number | null;
  awaySeed: number | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  homeLeagueId?: string | null;
  awayLeagueId?: string | null;
  homeLeagueName?: string | null;
  awayLeagueName?: string | null;
  homeSourceMatchId?: string | null;
  awaySourceMatchId?: string | null;
  fixtureId?: string | null;
  status: KnockoutMatchStatus;
  winnerTeamId?: string | null;
  winnerTeamName?: string | null;
  loserTeamId?: string | null;
  decidedBy?: KnockoutDecision;
  penalties?: { home: number; away: number } | null;
  score?: { home: number; away: number } | null;
  isBye?: boolean;
  resolvedAt?: Date | null;
}

export interface TournamentRound {
  round: number;
  name: string;
  matches: KnockoutMatch[];
}

export interface TournamentBracket {
  name: string;
  slug: string;
  timezone: string;
  kickoffHour: number;
  participants: TournamentParticipant[];
  rounds: TournamentRound[];
}

export interface KnockoutResult {
  matchId: string;
  winnerTeamId: string;
  loserTeamId: string;
}
