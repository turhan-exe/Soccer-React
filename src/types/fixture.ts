import type { FirebaseTimestamp } from './common';
import type { MatchVideoMeta } from './matchReplay';
import type { CompetitionType, KnockoutDecision } from './tournament';

export type FixtureStatus = 'scheduled' | 'running' | 'played' | 'failed';
export type FixtureLiveStatus =
  | 'warm'
  | 'starting'
  | 'server_started'
  | 'running'
  | 'ended'
  | 'result_pending'
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
  resultSource?: 'simulation' | 'fallback';
  resultPayload?: Record<string, unknown> | null;
  fallbackReason?: string;
  fallbackStrength?: { home: number; away: number };
  fallbackAppliedAt?: FirebaseTimestamp;
  fallbackVersion?: 1;
}

export interface FixtureDoc {
  id: string;                 // matchId
  leagueId: string;           // copied from parent
  seasonId: string;           // copied from league
  round: number;              // 1..N for the configured double round-robin capacity
  homeTeamId: string;
  awayTeamId: string;
  participants: string[];     // [home, away]
  date: FirebaseTimestamp;    // each round at 19:00 TRT (stored as Timestamp)
  status: FixtureStatus;
  score?: { home: number; away: number } | { h: number; a: number } | null;
  replayPath?: string;        // replays/{season}/{league}/{match}.json
  video?: MatchVideoMeta;
  videoMissing?: boolean;
  videoError?: string;
  live?: FixtureLiveDoc | null;
  competitionType?: CompetitionType;
  competitionName?: string;
  competitionMatchId?: string;
  competitionRound?: number;
  knockoutResult?: {
    winnerTeamId?: string | null;
    loserTeamId?: string | null;
    decidedBy?: KnockoutDecision;
    penalties?: { home: number; away: number } | null;
  } | null;
}
