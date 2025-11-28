import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type {
  MatchReplayMeta,
  MatchReplayPayload,
  MatchResultSummary,
  MatchEvent,
} from '../types/matches.js';

const REGION = 'europe-west1';
const db = getFirestore();
const bucket = getStorage().bucket();

export const reportMatchResultWithReplay = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).send('POST only');
        return;
      }

      const payload = (req.body || {}) as MatchReplayPayload;
      if (!payload.matchId || !payload.seasonId) {
        res.status(400).json({ error: 'missing matchId or seasonId' });
        return;
      }

      const seasonId = payload.seasonId;
      const matchId = payload.matchId;
      const storagePath = `replays/${seasonId}/${matchId}.json`;

      await bucket.file(storagePath).save(JSON.stringify(payload), {
        contentType: 'application/json',
        gzip: true,
      });

      const result = buildMatchResultSummary(payload);
      const replayMeta: MatchReplayMeta = {
        type: 'unity-json-v1',
        storagePath,
        durationMs: payload.durationMs || 0,
        createdAt: FieldValue.serverTimestamp() as any,
      };

      const matchRef = db.doc(`seasons/${seasonId}/matches/${matchId}`);
      await matchRef.set(
        {
          status: 'finished',
          result,
          replay: replayMeta,
        },
        { merge: true }
      );

      res.json({ ok: true, storagePath });
    } catch (err: any) {
      functions.logger.error('[reportMatchResultWithReplay] failed', { err: err?.message });
      res.status(500).json({ error: 'internal', detail: err?.message || 'unknown' });
    }
  });

function buildMatchResultSummary(payload: MatchReplayPayload): MatchResultSummary {
  const summary = payload.summary;
  const events: MatchEvent[] = Array.isArray(summary?.events) ? summary.events : [];
  let homeGoals = typeof summary?.homeGoals === 'number' ? summary.homeGoals : 0;
  let awayGoals = typeof summary?.awayGoals === 'number' ? summary.awayGoals : 0;

  if (!homeGoals && !awayGoals) {
    for (const ev of events) {
      if (ev.type === 'goal') {
        if (ev.club === 'home') homeGoals++;
        if (ev.club === 'away') awayGoals++;
      }
    }
  }

  return {
    homeGoals,
    awayGoals,
    events,
    stats: {
      shotsHome: 0,
      shotsAway: 0,
      possessionHome: 50,
      possessionAway: 50,
    },
  };
}
