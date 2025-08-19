export interface Player {
  id: string;
  name: string;
  position: 'GK' | 'CB' | 'LB' | 'RB' | 'CM' | 'LM' | 'RM' | 'CAM' | 'LW' | 'RW' | 'ST';
  overall: number;
  stats: {
    speed: number;
    acceleration: number;
    agility: number;
    shooting: number;
    passing: number;
    defending: number;
    dribbling: number;
    stamina: number;
    physical: number;
  };
  age: number;
  category: 'starting' | 'bench' | 'reserve' | 'youth';
  avatar?: string;
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

export interface Training {
  id: string;
  name: string;
  type: 'speed' | 'shooting' | 'passing' | 'defending' | 'dribbling' | 'physical';
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