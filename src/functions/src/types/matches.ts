import { Timestamp } from 'firebase-admin/firestore';

export interface MatchDocument {
  seasonId: string;
  leagueId: string;
  round: number;
  matchId: string;
  kickoffAt: Timestamp;
  status: 'scheduled' | 'in_progress' | 'finished';
  homeClubId: string;
  awayClubId: string;
  homeSquad: RuntimeSquad;
  awaySquad: RuntimeSquad;
  result?: MatchResultSummary;
  replay?: MatchReplayMeta;
  video?: MatchVideoMeta;
  videoMissing?: boolean;
  videoError?: string;
}

export interface RuntimeSquad {
  formation: string;
  players: RuntimePlayer[];
}

export interface RuntimePlayer {
  id: string;
  name: string;
  position: string;
  overall: number;
}

export interface MatchResultSummary {
  homeGoals: number;
  awayGoals: number;
  events: MatchEvent[];
  stats: MatchSummaryStats;
  playerStatsHome?: MatchPlayerRuntimeStat[];
  playerStatsAway?: MatchPlayerRuntimeStat[];
}

export interface MatchPlayerVitalSnapshot {
  health: number;
  condition: number;
  motivation: number;
}

export interface MatchPlayerFoulSeverityHits {
  light: number;
  medium: number;
  hard: number;
}

export interface MatchPlayerConsumableUsage {
  kitType: 'energy' | 'morale' | 'health';
  minute?: number;
  healthDelta?: number;
  conditionDelta?: number;
  motivationDelta?: number;
}

export interface MatchPlayerRuntimeStat {
  playerId: string;
  minutesPlayed: number;
  distanceMeters: number;
  squadRole?: 'starting' | 'bench' | 'reserve';
  participationState?: 'starter' | 'sub_used' | 'bench_unused' | 'squad_out' | string;
  foulSeverityHits?: MatchPlayerFoulSeverityHits;
  startingVitals: MatchPlayerVitalSnapshot;
  finalVitals: MatchPlayerVitalSnapshot;
  kitsUsed?: MatchPlayerConsumableUsage[];
  speedPenaltyPeak?: number;
  forcedInjurySubTriggered?: boolean;
}

export interface MatchEvent {
  minute: number;
  type: 'goal' | 'yellow_card' | 'red_card' | 'shot' | 'foul' | 'corner' | 'offside' | 'penalty' | 'other';
  club: 'home' | 'away';
  playerId?: string;
  description?: string;
}

export interface MatchSummaryStats {
  shotsHome: number;
  shotsAway: number;
  possessionHome: number;
  possessionAway: number;
  cornersHome: number;
  cornersAway: number;
  foulsHome: number;
  foulsAway: number;
  offsidesHome: number;
  offsidesAway: number;
  penaltiesHome: number;
  penaltiesAway: number;
}

export interface MatchReplayMeta {
  type: 'unity-json-v1';
  storagePath: string;
  durationMs: number;
  createdAt: Timestamp;
}

export interface MatchVideoMeta {
  type: 'mp4-v1';
  storagePath: string;
  durationMs?: number;
  createdAt?: Timestamp;
  uploaded?: boolean;
  error?: string;
  updatedAt?: Timestamp;
}

export interface MatchReplayPayload {
  version: number;
  matchId: string;
  seasonId: string;
  durationMs: number;
  startedAtUnixMs: number;
  home: RuntimeTeamState;
  away: RuntimeTeamState;
  frames: ReplayFrame[];
  summary: ReplayResultSummary;
}

export interface RuntimeTeamState {
  clubId: string;
  clubName: string;
  formation: string;
  players: RuntimePlayerState[];
}

export interface RuntimePlayerState {
  id: string;
  name: string;
  position: string;
  rating: number;
}

export interface ReplayFrame {
  t: number;
  ball: BallState;
  players: PlayerFrameState[];
  frameEvent?: FrameEvent | null;
}

export interface BallState {
  x: number;
  y: number;
  z: number;
}

export interface PlayerFrameState {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface FrameEvent {
  type: string;
  club: 'home' | 'away';
  playerId?: string;
  extra?: string;
}

export interface ReplayResultSummary {
  homeGoals: number;
  awayGoals: number;
  events: MatchEvent[];
  stats?: MatchSummaryStats;
  playerStatsHome?: MatchPlayerRuntimeStat[];
  playerStatsAway?: MatchPlayerRuntimeStat[];
}
