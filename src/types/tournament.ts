export interface TournamentParticipant {
  teamId: string;
  teamName: string;
  leagueId: string;
  leagueName: string;
  leaguePosition: number;
  points: number;
  goalDifference: number;
  scored: number;
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

export interface KnockoutMatch {
  id: string;
  round: number;
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
