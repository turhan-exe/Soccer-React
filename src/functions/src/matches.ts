import * as functions from 'firebase-functions/v1';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { today19TR } from './utils/schedule.js';

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

type FixtureDoc = QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;

async function collectScheduledFixturesAt(targetUtc: Date): Promise<FixtureDoc[]> {
  const ts = Timestamp.fromDate(targetUtc);
  // Prefer efficient collectionGroup query; fall back per-league if index is missing
  try {
    const snap = await db
      .collectionGroup('fixtures')
      .where('status', '==', 'scheduled')
      .where('date', '==', ts)
      .get();
    return snap.docs as FixtureDoc[];
  } catch (e: any) {
    functions.logger.warn('[MATCHES] collectionGroup index missing; falling back per-league', {
      error: e?.message,
    });
    const leagues = await db.collection('leagues').get();
    const results: FixtureDoc[] = [];
    for (const league of leagues.docs) {
      const fs = await league.ref
        .collection('fixtures')
        .where('status', '==', 'scheduled')
        .where('date', '==', ts)
        .get();
      results.push(...(fs.docs as FixtureDoc[]));
    }
    return results;
  }
}

export async function queueMatchesForTarget(targetUtc: Date) {
  const fixtures = await collectScheduledFixturesAt(targetUtc);
  let enqueued = 0;
  let already = 0;
  for (const doc of fixtures) {
    const leagueId = doc.ref.parent.parent?.id ?? 'unknown';
    const matchId = doc.id;
    const queueId = `L_${leagueId}__M_${matchId}`;
    const queueRef = db.collection('matchQueue').doc(queueId);
    const payload = {
      matchPath: doc.ref.path,
      leagueId,
      matchId,
      scheduledAt: (doc.data() as any).date,
      status: 'queued' as const,
      enqueuedAt: FieldValue.serverTimestamp(),
    };
    try {
      // Create only if not exists (idempotent)
      await queueRef.create(payload as any);
      enqueued++;
    } catch (e: any) {
      // Already exists (ALREADY_EXISTS)
      already++;
    }
  }
  return { totalFound: fixtures.length, enqueued, alreadyQueued: already };
}

export async function queueTodayScheduledMatches(baseDate: Date = new Date()) {
  const target = today19TR(baseDate);
  functions.logger.info('[MATCHES] Queueing today\'s 19:00 TRT fixtures', { targetUtc: target.toISOString() });
  const res = await queueMatchesForTarget(target);
  functions.logger.info('[MATCHES] Queue result', res);
  return res;
}


