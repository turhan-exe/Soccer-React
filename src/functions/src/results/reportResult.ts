import * as functions from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp();
}

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

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(fixtureRef);
      if (!snap.exists) throw new Error('fixture not found');
      const cur = snap.data() as any;
      if (cur.status === 'played') return; // idempotent

      tx.update(fixtureRef, {
        status: 'played',
        score,
        replayPath,
        playedAt: FieldValue.serverTimestamp(),
      });

      const homeId = cur.homeTeamId;
      const awayId = cur.awayTeamId;
      const leagueRef = fixtureRef.parent.parent!;
      const homeRef = leagueRef.collection('standings').doc(homeId);
      const awayRef = leagueRef.collection('standings').doc(awayId);

      const [homeSnap, awaySnap] = await Promise.all([tx.get(homeRef), tx.get(awayRef)]);
      const hs = homeSnap.exists
        ? (homeSnap.data() as any)
        : { teamId: homeId, name: '', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
      const as = awaySnap.exists
        ? (awaySnap.data() as any)
        : { teamId: awayId, name: '', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };

      const h = score.home;
      const a = score.away;
      hs.P++;
      as.P++;
      hs.GF += h;
      hs.GA += a;
      as.GF += a;
      as.GA += h;
      hs.GD = hs.GF - hs.GA;
      as.GD = as.GF - as.GA;
      if (h > a) {
        hs.W++;
        as.L++;
        hs.Pts += 3;
      } else if (h < a) {
        as.W++;
        hs.L++;
        as.Pts += 3;
      } else {
        hs.D++;
        as.D++;
        hs.Pts++;
        as.Pts++;
      }
      tx.set(homeRef, hs, { merge: true });
      tx.set(awayRef, as, { merge: true });
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
