import type { FirebaseTimestamp } from './common';
import type { MatchVideoMeta } from './matchReplay';

export type FixtureStatus = 'scheduled' | 'running' | 'played' | 'failed';

export interface FixtureDoc {
  id: string;                 // matchId
  leagueId: string;           // copied from parent
  seasonId: string;           // copied from league
  round: number;              // 1..21
  homeTeamId: string;
  awayTeamId: string;
  participants: string[];     // [home, away]
  date: FirebaseTimestamp;    // each round at 19:00 TRT (stored as Timestamp)
  status: FixtureStatus;
  score?: { h: number; a: number };
  replayPath?: string;        // replays/{season}/{league}/{match}.json
  video?: MatchVideoMeta;
  videoMissing?: boolean;
  videoError?: string;
}
