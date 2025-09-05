import * as functions from 'firebase-functions/v1';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { betweenTR_19_to_2359, dayKeyTR, ts } from '../utils/schedule.js';
import { log } from '../logger.js';

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();
const REGION = 'europe-west1';
const LOCK_SECRET = (functions.config() as any)?.lock?.secret
  || (functions.config() as any)?.scheduler?.secret
  || (functions.config() as any)?.orchestrate?.secret
  || '';

/**
 * 18:30–19:00 TR penceresinde çağrılır: 19:00 maçları için immutable matchPlans/{matchId} oluşturur.
 */
export const lockWindowSnapshot = functions.region(REGION).https.onRequest(async (req, res) => {
  // Restrict to Scheduler/Operators via bearer secret
  const authz = (req.headers.authorization as string) || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!LOCK_SECRET || token !== LOCK_SECRET) {
    res.status(401).send('unauthorized');
    return;
  }
  const day = dayKeyTR();
  const { start, end } = betweenTR_19_to_2359(day);

  // leagues/*/fixtures/* scheduled between 19:00–23:59 TR
  const q = db.collectionGroup('fixtures')
    .where('date', '>=', ts(start))
    .where('date', '<=', ts(end))
    .where('status', '==', 'scheduled');

  const snap = await q.get();
  log.info('lockWindowSnapshot start', { day, count: snap.size });

  for (const d of snap.docs) {
    const fx = d.data() as any;
    const leagueId = d.ref.parent.parent?.id;
    if (!leagueId) continue;
    const matchId = d.id;

    const planRef = db.doc(`matchPlans/${matchId}`);
    const planDoc = await planRef.get();
    if (planDoc.exists) continue; // idempotent

    // Read lineup from top-level teams collection (source of truth)
    const homeRef = db.doc(`teams/${fx.homeTeamId}`);
    const awayRef = db.doc(`teams/${fx.awayTeamId}`);
    const [home, away] = await db.getAll(homeRef, awayRef);
    if (!home.exists || !away.exists) continue;
    const h = home.data() as any, a = away.data() as any;

    const snapshot = {
      matchId,
      leagueId,
      seasonId: fx.seasonId || 'S-2025a',
      createdAt: FieldValue.serverTimestamp(),
      rngSeed: fx.seed || Math.floor(Math.random() * 1e9),
      kickoffUtc: fx.date, // Firestore Timestamp
      home: {
        teamId: fx.homeTeamId,
        clubName: h?.clubName,
        formation: h?.lineup?.formation,
        tactics: h?.lineup?.tactics || {},
        starters: h?.lineup?.starters || [],
        subs: h?.lineup?.subs || []
      },
      away: {
        teamId: fx.awayTeamId,
        clubName: a?.clubName,
        formation: a?.lineup?.formation,
        tactics: a?.lineup?.tactics || {},
        starters: a?.lineup?.starters || [],
        subs: a?.lineup?.subs || []
      }
    };

    await planRef.create(snapshot);
  }

  log.info('lockWindowSnapshot done', { day });
  res.json({ ok: true, day, matches: snap.size });
});
