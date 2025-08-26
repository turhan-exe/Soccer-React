export type SquadRole = 'starting' | 'bench' | 'reserve';

export type Position =
  | 'GK'
  | 'CB'
  | 'LB'
  | 'RB'
  | 'CM'
  | 'LM'
  | 'RM'
  | 'CAM'
  | 'LW'
  | 'RW'
  | 'ST';

export interface Player {
  id: string;
  name: string;
  position: Position;
  roles: Position[];
  overall: number;
  potential: number;
  attributes: {
    strength: number;
    acceleration: number;
    topSpeed: number;
    dribbleSpeed: number;
    jump: number;
    tackling: number;
    ballKeeping: number;
    passing: number;
    longBall: number;
    agility: number;
    shooting: number;
    shootPower: number;
    positioning: number;
    reaction: number;
    ballControl: number;
  };
  age: number;
  height: number;
  weight: number;
  squadRole: SquadRole | 'youth';
  avatar?: string;
  uniqueId?: string;
  order?: number;
}

export interface ClubTeam {
  id: string;
  name: string;
  manager: string;
  kitHome: string;
  kitAway: string;
  players: Player[];
}

export interface Match {
  id: string;
  opponent: string;
  opponentLogo: string;
  date: string;
  time: string;
  venue: 'home' | 'away';
  status: 'scheduled' | 'completed' | 'live';
  score?: {
    home: number;
    away: number;
  };
  competition: string;
}

export interface Team {
  name: string;
  logo: string;
  overall: number;
  form: string;
  position: number;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalDifference: number;
}

export interface League {
  id: string;
  name: string;
  season: number;
  capacity: number;
  timezone: string;
  state: 'forming' | 'scheduled' | 'active' | 'completed';
  startDate?: unknown;
  rounds: number;
  teamCount?: number;
}

export interface Fixture {
  id: string;
  round: number;
  date: unknown;
  homeTeamId: string;
  awayTeamId: string;
  participants: string[];
  status: 'scheduled' | 'in_progress' | 'played';
  score: { home: number; away: number } | null;
}

export interface Standing {
  id: string;
  teamId: string;
  name: string;
  P: number; W: number; D: number; L: number; GF: number; GA: number; GD: number; Pts: number;
}

export interface Training {
  id: string;
  name: string;
  type: keyof Player['attributes'];
  description: string;
  duration: number;
}

export interface FinanceRecord {
  id: string;
  type: 'income' | 'expense';
  category: string;
  amount: number;
  date: string;
  description: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  teamName: string;
  teamLogo: string;
  connectedAccounts: {
    google?: boolean;
    apple?: boolean;
  };
}