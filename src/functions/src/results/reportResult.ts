import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  applyLeagueMatchRevenueInTx,
  applyStandingResultInTx,
  resolveFixtureRevenueTeamIds,
} from '../utils/leagueMatchFinalize.js';


const db = getFirestore();

const SECRET = functions.config().results?.secret || '';

export const reportResult = functions.region('europe-west1').https.onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).send('POST only');
      return;
    }

    // Simple bearer auth
    const authz = req.headers.authorization || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!SECRET || token !== SECRET) {
      res.status(401).send('Unauthorized');
      return;
    }

    const body: any = req.body || {};
    const leagueId: string | undefined = body.leagueId;
    const matchId: string | undefined = body.matchId;
    const seasonId: string | undefined = body.seasonId;
    if (!leagueId || !matchId || !seasonId) {
      res.status(400).send('missing fields: leagueId, matchId, seasonId');
      return;
    }

    const fixtureRef = db.doc(`leagues/${leagueId}/fixtures/${matchId}`);
    const replayPath: string = body?.replay?.path || `replays/${seasonId}/${leagueId}/${matchId}.json`;
    const score = normalizeScore(body);
    const fixtureBeforeSnap = await fixtureRef.get();
    if (!fixtureBeforeSnap.exists) {
      throw new Error('fixture not found');
    }
    const resolvedTeamIds = await resolveFixtureRevenueTeamIds(
      leagueId,
      (fixtureBeforeSnap.data() as Record<string, unknown>) ?? {},
    );

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(fixtureRef);
      if (!snap.exists) throw new Error('fixture not found');
      const cur = (snap.data() as Record<string, unknown>) ?? {};
      const currentStatus = String(cur.status || 'scheduled');

      const updatePatch: Record<string, unknown> = {
        status: 'played',
        score,
        replayPath,
        'live.state': 'ended',
        'live.endedAt': FieldValue.serverTimestamp(),
        'live.lastLifecycleAt': FieldValue.serverTimestamp(),
        'live.resultMissing': false,
        'live.reason': FieldValue.delete(),
      };
      if (currentStatus !== 'played') {
        updatePatch.playedAt = FieldValue.serverTimestamp();
        updatePatch.endedAt = FieldValue.serverTimestamp();
      }
      tx.update(fixtureRef, updatePatch);

      if (currentStatus !== 'played') {
        await applyStandingResultInTx(tx, fixtureRef, cur, score);
      }
      await applyLeagueMatchRevenueInTx(tx, fixtureRef, cur, resolvedTeamIds);
    });

    functions.logger.info('[RESULT] Finalized via HTTP', { leagueId, matchId, score, replayPath });
    res.json({ ok: true });
    return;
  } catch (e: any) {
    functions.logger.error('[RESULT] reportResult failed', { error: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'unknown' });
    return;
  }
});

function normalizeScore(obj: any): { home: number; away: number } {
  const s = obj?.score || {};
  if (typeof s.home === 'number' && typeof s.away === 'number') {
    return { home: s.home, away: s.away };
  }
  if (typeof s.h === 'number' && typeof s.a === 'number') {
    return { home: s.h, away: s.a };
  }
  const r = obj?.result || {};
  if (typeof r.homeGoals === 'number' && typeof r.awayGoals === 'number') {
    return { home: r.homeGoals, away: r.awayGoals };
  }
  return { home: 0, away: 0 };
}

