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

export type InjuryStatus = 'healthy' | 'injured';

export type KitType = 'energy' | 'morale' | 'health';

export type TeamBadge = {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  contentType?: string;
};

export type TeamKitAsset = {
  textureUrl: string;
  normalMapUrl?: string | null;
  contentType?: string;
  width?: number;
  height?: number;
};

export type TeamKitAssets = {
  home?: TeamKitAsset | null;
  away?: TeamKitAsset | null;
  third?: TeamKitAsset | null;
};

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
  ageUpdatedAt?: string | null;
  height: number;
  weight: number;
  condition: number;
  motivation: number;
  injuryStatus?: InjuryStatus;
  squadRole: SquadRole | 'youth';
  avatar?: string;
  uniqueId?: string;
  order?: number;
  market?: {
    active: boolean;
    listingId?: string | null;
    locked?: boolean;
    lockReason?: string | null;
  } | null;
  contract?: {
    expiresAt: string;
    status?: 'active' | 'expired' | 'released';
    salary?: number;
    extensions?: number;
  } | null;
  rename?: {
    lastUpdatedAt?: string;
    lastMethod?: 'ad' | 'purchase';
    adAvailableAt?: string;
  } | null;
}

export type CustomFormationLayout = Record<
  string,
  {
    x: number;
    y: number;
    position: Position;
  }
>;

export type CustomFormationMap = Record<string, CustomFormationLayout>;

export interface ClubTeam {
  id: string;
  name: string;
  manager: string;
  kitHome: string;
  kitAway: string;
  logo?: string | null;
  /** Opsiyonel: Unity TeamSelection için logonun URL ve meta bilgisi */
  badge?: TeamBadge | null;
  /** Opsiyonel: Unity kit dokuları (home/away/third) */
  kit?: TeamKitAssets | null;
  leagueId?: string | null;
  /** @deprecated use transferBudget */
  budget?: number;
  transferBudget?: number;
  stadium?: {
    name: string;
    capacity?: number;
    updatedAt?: string;
  } | null;
  players: Player[];
  plan?: {
    formation: string;
    starters: string[];
    bench: string[];
    reserves: string[];
    shape?: string;
    updatedAt?: string;
    customFormations?: CustomFormationMap;
  };
  lineup?: {
    formation?: string;
    tactics?: Record<string, unknown>;
    starters?: string[];
    subs?: string[];
    reserves?: string[];
    shape?: string;
    updatedAt?: string;
    customFormations?: CustomFormationMap;
  };
}

export interface Match {
  id: string;
  opponent: string;
  opponentLogo: string;
  opponentLogoUrl?: string;
  date: string;
  time: string;
  venue: 'home' | 'away';
  status: 'scheduled' | 'completed' | 'live';
  score?: {
    home: number;
    away: number;
  };
  competition: string;
  venueName?: string;
  opponentStats?: {
    overall: number;
    form: Array<'W' | 'D' | 'L'>;
    keyPlayers: Array<{
      name: string;
      position: string;
      highlight: string;
      stats?: {
        matches?: number;
        goals?: number;
        assists?: number;
        rating?: number;
        cleanSheets?: number;
        minutes?: number;
      };
    }>;
  };
}

export interface MatchGoalEvent {
  minute: number;
  team: 'home' | 'away';
  type: 'goal';
  description?: string;
  homeScore: number;
  awayScore: number;
}

export interface MatchTimeline {
  matchId: string;
  leagueId: string | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  score?: { home: number; away: number } | null;
  goalTimeline: MatchGoalEvent[];
  date?: string | null;
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

// Firestore Timestamp type (client SDK)
type FirestoreTimestamp = import('firebase/firestore').Timestamp;

export interface League {
  id: string;
  name: string;
  season: number; // season number or identifier
  capacity: number;
  timezone: string; // e.g., 'Europe/Istanbul'
  // States used in the app. Plan suggests finished; code uses completed.
  state: 'forming' | 'scheduled' | 'active' | 'completed';
  // When fixtures start; stored as Firestore Timestamp
  startDate?: FirestoreTimestamp;
  // Metadata
  rounds: number; // total rounds (22 teams => 42)
  teamCount?: number;
  // Optional mirror array for quick reads (not authoritative)
  teams?: { id: string; name: string }[];
}

export interface Fixture {
  id: string;
  round: number;
  // Client uses concrete Date for display; services map Timestamp -> Date
  date: Date;
  homeTeamId: string;
  awayTeamId: string;
  // Always [homeTeamId, awayTeamId]
  participants: string[];
  status: 'scheduled' | 'running' | 'played' | 'failed';
  score: { home: number; away: number } | null;
  // Optional replay storage path (when Unity integration lands)
  replayPath?: string;
  goalTimeline?: MatchGoalEvent[];
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

export interface TransferListing {
  id: string;
  playerId: string;
  player: Player;
  playerPath?: string;
  price: number;
  sellerId: string;
  sellerUid?: string;
  teamId?: string;
  sellerTeamName: string;
  buyerId?: string;
  buyerUid?: string;
  buyerTeamName?: string;
  status: 'available' | 'active' | 'sold' | 'cancelled';
  playerName?: string;
  position?: Position;
  pos?: Position;
  overall?: number;
  createdAt?: FirestoreTimestamp;
  soldAt?: FirestoreTimestamp;
  cancelledAt?: FirestoreTimestamp;
}

export interface User {
  id: string;
  username: string;
  email: string;
  teamName: string;
  teamLogo: string | null;
  role?: 'admin' | 'user';
  connectedAccounts: {
    google?: boolean;
    apple?: boolean;
  };
  contactPhone: string | null;
  contactCrypto: string | null;
}

// Plan 2.1 schema exports (Firestore documents)
export type { FirebaseTimestamp } from './common';
export type { LeagueDoc, LeagueState } from './league';
export type { TeamDoc, Lineup } from './team';
export type { FixtureDoc, FixtureStatus } from './fixture';
export type { MatchPlanDoc } from './matchPlan';
export type {
  TournamentParticipant,
  KnockoutMatch,
  KnockoutMatchLeg,
  TournamentRound,
  TournamentBracket,
  KnockoutResult,
} from './tournament';

