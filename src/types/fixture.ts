import type { FirebaseTimestamp } from './common';
import type { MatchVideoMeta } from './matchReplay';

export type FixtureStatus = 'scheduled' | 'running' | 'played' | 'failed';
export type FixtureLiveStatus =
  | 'warm'
  | 'starting'
  | 'server_started'
  | 'running'
  | 'ended'
  | 'failed'
  | 'prepare_failed'
  | 'kickoff_failed'
  | string;

export interface FixtureLiveDoc {
  matchId?: string;
  nodeId?: string | null;
  serverIp?: string | null;
  serverPort?: number | null;
  state?: FixtureLiveStatus;
  prewarmedAt?: FirebaseTimestamp;
  kickoffAttemptedAt?: FirebaseTimestamp;
  startedAt?: FirebaseTimestamp;
  endedAt?: FirebaseTimestamp;
  lastLifecycleAt?: FirebaseTimestamp;
  homeUserId?: string | null;
  awayUserId?: string | null;
  retryCount?: number;
  resultMissing?: boolean;
  reason?: string;
}

export interface FixtureDoc {
  id: string;                 // matchId
  leagueId: string;           // copied from parent
  seasonId: string;           // copied from league
  round: number;              // 1..30 for 16-team double round-robin
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
  live?: FixtureLiveDoc | null;
}
