import admin from '../src/functions/node_modules/firebase-admin/lib/index.js';

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'osm-react',
    storageBucket: 'osm-react.firebasestorage.app',
  });
}

const db = admin.firestore();
const NOW = Date.now();
const FROM_DATE = new Date(process.env.FROM_DATE || '2026-04-01T00:00:00.000Z').getTime();
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY || 6), 12));
const { finalizeFixtureWithFallbackResult } = await import('../src/functions/lib/utils/matchResultFallback.js');
const { hasCanonicalFixtureScore } = await import('../src/functions/lib/utils/fixtureScore.js');

function toMillis(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value?.toDate === 'function') {
    const resolved = value.toDate();
    return resolved instanceof Date && !Number.isNaN(resolved.getTime()) ? resolved.getTime() : null;
  }
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1_000_000);
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function isPastFixture(fixture) {
  const fixtureDateMs = toMillis(fixture?.date);
  if (fixtureDateMs == null) return false;
  return fixtureDateMs < NOW && fixtureDateMs >= FROM_DATE;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function shouldFallbackRepair(fixture) {
  if (!isPastFixture(fixture)) return false;

  const status = normalizeText(fixture?.status);
  const hasScore = hasCanonicalFixtureScore(fixture?.score);
  const liveState = normalizeText(fixture?.live?.state);
  const recoveryState = normalizeText(fixture?.recovery?.state);
  const hasMatchId = String(fixture?.live?.matchId || '').trim().length > 0;
  const resultMissing = fixture?.live?.resultMissing === true;

  if (status === 'played') {
    return !hasScore || resultMissing;
  }

  if (status === 'scheduled') {
    return !hasScore && !hasMatchId && liveState === 'recovery_queued' && recoveryState === 'retry_wait';
  }

  return false;
}

async function collectTargets() {
  const leagueSnap = await db.collection('leagues').get();
  const targets = [];
  let scanned = 0;

  for (const league of leagueSnap.docs) {
    const fixturesSnap = await league.ref.collection('fixtures').where('status', 'in', ['played', 'scheduled']).get();
    for (const fixtureDoc of fixturesSnap.docs) {
      scanned += 1;
      const fixture = fixtureDoc.data() || {};
      if (!shouldFallbackRepair(fixture)) continue;
      targets.push({
        leagueId: league.id,
        fixtureId: fixtureDoc.id,
        reason: normalizeText(fixture?.live?.reason) || normalizeText(fixture?.recovery?.lastError) || 'manual_scoreless_cleanup',
      });
    }
  }

  return { scanned, targets };
}

async function countRemaining() {
  const leagueSnap = await db.collection('leagues').get();
  let playedMissingScore = 0;
  let retryQueued = 0;

  for (const league of leagueSnap.docs) {
    const fixturesSnap = await league.ref.collection('fixtures').where('status', 'in', ['played', 'scheduled']).get();
    for (const fixtureDoc of fixturesSnap.docs) {
      const fixture = fixtureDoc.data() || {};
      const status = normalizeText(fixture?.status);
      const hasScore = hasCanonicalFixtureScore(fixture?.score);
      if (status === 'played' && !hasScore) {
        playedMissingScore += 1;
      }
      if (
        status === 'scheduled' &&
        normalizeText(fixture?.recovery?.state) === 'retry_wait' &&
        normalizeText(fixture?.live?.state) === 'recovery_queued' &&
        String(fixture?.live?.matchId || '').trim().length === 0
      ) {
        retryQueued += 1;
      }
    }
  }

  return { playedMissingScore, retryQueued };
}

async function main() {
  const startedAt = Date.now();
  const { scanned, targets } = await collectTargets();
  const stats = {
    scanned,
    targeted: targets.length,
    applied: 0,
    skipped: 0,
    failed: 0,
  };

  console.log(JSON.stringify({ phase: 'collected', scanned, targeted: targets.length, concurrency: CONCURRENCY }, null, 2));

  const queue = [...targets];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      try {
        const result = await finalizeFixtureWithFallbackResult({
          leagueId: item.leagueId,
          fixtureId: item.fixtureId,
          matchId: item.fixtureId,
          reason: item.reason,
        });
        if (result.status === 'applied') {
          stats.applied += 1;
        } else {
          stats.skipped += 1;
        }
      } catch (error) {
        stats.failed += 1;
        console.error(JSON.stringify({
          phase: 'repair_failed',
          leagueId: item.leagueId,
          fixtureId: item.fixtureId,
          error: error?.message || String(error),
        }));
      }

      const processed = stats.applied + stats.skipped + stats.failed;
      if (processed > 0 && processed % 25 === 0) {
        console.log(JSON.stringify({ phase: 'progress', processed, remaining: queue.length }, null, 2));
      }
    }
  });

  await Promise.all(workers);
  const remaining = await countRemaining();

  console.log(JSON.stringify({
    phase: 'done',
    ...stats,
    remaining,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
