import type { FirebaseTimestamp } from './common';

export type LeagueState = 'forming' | 'scheduled' | 'finished';

export interface LeagueDoc {
  id: string;
  seasonId: string;
  state: LeagueState;
  createdAt: FirebaseTimestamp;
  lockedAt?: FirebaseTimestamp;
  startDate?: FirebaseTimestamp; // 1. turun 19:00 TRT
  rounds: number; // 21
}

