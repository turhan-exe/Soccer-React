// src/services/jobs.ts
import { callFn } from './api';

export interface BatchMatchItem {
  matchId: string;
  leagueId: string;
  seasonId: string | number;
  homeTeamId: string;
  awayTeamId: string;
  seed: number;
  replayUploadUrl: string;
  resultUploadUrl: string;
}

export interface CreateDailyBatchResponse {
  ok: boolean;
  day: string; // yyyy-MM-dd (Europe/Istanbul)
  count: number; // matches length
  batchPath: string; // jobs/<day>/batch_<day>.json
  batchReadUrl?: string; // signed read URL, when available
  meta?: { day: string; tz: string; count: number; generatedAt: string };
  matches?: BatchMatchItem[];
}

/**
 * Plan 2.2 — Günlük batch üretimi (Unity girişi)
 * createDailyBatch (callable) çağırır ve geri dönen özet bilgisini verir.
 *
 * Not: Cloud Functions tarafında bölge europe-west1 olarak tanımlı.
 */
export async function createDailyBatch(day?: string): Promise<CreateDailyBatchResponse> {
  const payload = day ? { date: day } : undefined;
  const res = await callFn<typeof payload, CreateDailyBatchResponse>('createDailyBatch', payload);
  return res;
}

