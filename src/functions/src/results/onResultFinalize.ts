import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { log } from '../logger.js';
import { sendSlack } from '../notify/slack.js';


const db = getFirestore();
const REGION = 'europe-west1';

async function resolveReplayPath(
  bucketName: string,
  seasonId: string,
  leagueId: string,
  matchId: string,
  resultJson: any
) {
  // Prefer explicit path from result JSON if provided
  const explicit: string | undefined = resultJson?.replay?.path || resultJson?.replayPath;
  if (explicit) return explicit;

  const bucket = getStorage().bucket(bucketName);
  const jsonPath = `replays/${seasonId}/${leagueId}/${matchId}.json`;
  const gzPath = `${jsonPath}.gz`;

  try {
    const [hasGz] = await bucket.file(gzPath).exists();
    if (hasGz) return gzPath;
  } catch {}

  // Fallback to .json (even if not found yet)
  return jsonPath;
}

export const onResultFinalize = functions
  .region(REGION)
  .storage.object().onFinalize(async (obj) => {
    try {
      if (!obj.name) return;
      const path = obj.name; // results/{season}/{league}/{matchId}.json
      if (!path.startsWith('results/')) return;

      const parts = path.split('/');
      if (parts.length < 4) return;
      const seasonId = parts[1];
      const leagueId = parts[2];
      const matchId = parts[3].replace('.json', '');

      const fileRef = getStorage().bucket(obj.bucket).file(path);
      const [buf] = await fileRef.download();
      const result = JSON.parse(buf.toString());

      const scoreAny = result?.score || result?.result || null;
      // Normalize score shape to { home, away }
      const score = typeof scoreAny?.home === 'number' && typeof scoreAny?.away === 'number'
        ? { home: scoreAny.home, away: scoreAny.away }
        : (typeof scoreAny?.h === 'number' && typeof scoreAny?.a === 'number'
            ? { home: scoreAny.h, away: scoreAny.a }
            : null);

      const replayPath = await resolveReplayPath(obj.bucket!, seasonId, leagueId, matchId, result);

      const fxRef = db.doc(`leagues/${leagueId}/fixtures/${matchId}`);
      // Update fixture and standings atomically
      await db.runTransaction(async (tx) => {
        const fxSnap = await tx.get(fxRef);
        if (!fxSnap.exists) return;
        const cur = fxSnap.data() as any;
        if (cur.status === 'played') return; // idempotent
        tx.update(fxRef, {
          status: 'played',
          score,
          replayPath,
          endedAt: FieldValue.serverTimestamp(),
        });
        if (!score) return;
        const homeId = cur.homeTeamId;
        const awayId = cur.awayTeamId;
        const leagueRef = fxRef.parent.parent!;
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
        hs.GF += h; hs.GA += a; hs.GD = hs.GF - hs.GA;
        as.GF += a; as.GA += h; as.GD = as.GF - as.GA;
        if (h > a) { hs.W++; as.L++; hs.Pts += 3; }
        else if (h < a) { as.W++; hs.L++; as.Pts += 3; }
        else { hs.D++; as.D++; hs.Pts++; as.Pts++; }
        tx.set(homeRef, hs, { merge: true });
        tx.set(awayRef, as, { merge: true });
      });

      // Log sim duration metrics (if startedAt exists)
      try {
        const fxAfter = await db.doc(`leagues/${leagueId}/fixtures/${matchId}`).get();
        const fxd = (fxAfter.data() as any) || {};
        const startedAt = fxd?.startedAt?.toDate?.() as Date | undefined;
        const endedAt = fxd?.endedAt?.toDate?.() as Date | undefined;
        const simDurationMs = startedAt && endedAt ? (endedAt.getTime() - startedAt.getTime()) : undefined;
        log.info('result finalized', { leagueId, matchId, replayPath, simDurationMs });
      } catch {
        log.info('result finalized', { leagueId, matchId, replayPath });
      }

      // If no more scheduled/running fixtures remain, mark league completed
      try {
        const remaining = await db
          .collection('leagues')
          .doc(leagueId)
          .collection('fixtures')
          .where('status', 'in', ['scheduled', 'running'])
          .limit(1)
          .get();
        if (remaining.empty) {
          await db.doc(`leagues/${leagueId}`).set(
            { state: 'completed', completedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
      } catch {}
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      log.error('onResultFinalize error', { errorClass: e?.code || e?.name || 'FinalizeError', ok: false, err: String(errMsg) });
      try { await sendSlack(`❌ onResultFinalize hata: ${errMsg}`); } catch {}
    }
  });
