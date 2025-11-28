import { Timestamp as FirestoreTimestamp } from 'firebase/firestore';

export interface RuntimePlayer {
  id: string;
  name: string;
  position: string;
  overall: number;
}

export interface RuntimeSquad {
  formation: string;
  players: RuntimePlayer[];
}

export interface MatchEvent {
  minute: number;
  type: 'goal' | 'yellow_card' | 'red_card' | 'shot' | 'foul' | 'other';
  club: 'home' | 'away';
  playerId?: string;
  description?: string;
}

export interface MatchResultSummary {
  homeGoals: number;
  awayGoals: number;
  events: MatchEvent[];
  stats: {
    shotsHome: number;
    shotsAway: number;
    possessionHome: number;
    possessionAway: number;
  };
}

export interface MatchReplayMeta {
  type: 'unity-json-v1';
  storagePath: string;
  durationMs: number;
  createdAt: FirestoreTimestamp;
}

export interface MatchDocument {
  seasonId: string;
  leagueId: string;
  round: number;
  matchId: string;
  kickoffAt: FirestoreTimestamp;
  status: 'scheduled' | 'in_progress' | 'finished';
  homeClubId: string;
  awayClubId: string;
  homeSquad: RuntimeSquad;
  awaySquad: RuntimeSquad;
  result?: MatchResultSummary;
  replay?: MatchReplayMeta;
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
  summary: {
    homeGoals: number;
    awayGoals: number;
    events: MatchEvent[];
  };
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
