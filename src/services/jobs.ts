// src/services/jobs.ts
import { callFn, httpPost } from './api';

export interface BatchMatchItem {
  matchId: string;
  leagueId: string;
  seasonId: string | number;
  homeTeamId: string;
  awayTeamId: string;
  seed: number;
  requestToken: string;
  replayUploadUrl: string;
  resultUploadUrl: string;
  videoUploadUrl: string;
  videoPath: string;
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
  const httpFirst = (import.meta as any).env?.VITE_USE_HTTP_FUNCTIONS === '1' || import.meta.env.DEV;
  const callCallable = () =>
    callFn<typeof payload, CreateDailyBatchResponse>('createDailyBatch', payload);
  const callHttp = () =>
    httpPost<CreateDailyBatchResponse>('createDailyBatchHttp', payload);

  if (httpFirst) {
    try {
      return await callHttp();
    } catch (err: any) {
      const message = String(err?.message || '');
      const permissionLike =
        message.includes('PERMISSION_DENIED') ||
        message.includes('Auth required') ||
        message.includes('unauthorized');
      if (permissionLike) {
        throw err;
      }
      return await callCallable();
    }
  }

  try {
    return await callCallable();
  } catch (err: any) {
    const code = err?.code as string | undefined;
    const message = String(err?.message || '');
    const appCheckRelated =
      code === 'functions/failed-precondition' ||
      message.toLowerCase().includes('appcheck');
    if (appCheckRelated) {
      return await callHttp();
    }
    throw err;
  }
}
