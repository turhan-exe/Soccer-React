import type { FirebaseTimestamp } from './common';

export interface MatchPlanDoc {
  matchId: string;            // doc id
  leagueId: string;
  seasonId: string;
  createdAt: FirebaseTimestamp;
  kickoffUtc: FirebaseTimestamp; // Firestore Timestamp
  rngSeed: number;
  home: {
    teamId: string;
    clubName?: string;
    formation?: string;
    tactics?: Record<string, any>;
    starters: string[];       // 11 player ids
    subs: string[];           // 0..12 player ids
  };
  away: {
    teamId: string;
    clubName?: string;
    formation?: string;
    tactics?: Record<string, any>;
    starters: string[];
    subs: string[];
  };
}

