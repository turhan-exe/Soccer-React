// Upload a sample results JSON to Storage results/.. to trigger onResultFinalize
// Usage: node src/functions/scripts/finalize-sample.mjs [matchId]
// Env: PROJECT_ID (default demo-osm-react), LEAGUE_ID, SEASON_ID

import admin from 'firebase-admin';

const PROJECT_ID = process.env.PROJECT_ID || 'demo-osm-react';
const MATCH_ID = process.argv[2] || 'M001';
const LEAGUE_ID = process.env.LEAGUE_ID || 'L-TR-1-2025a';
const SEASON_ID = process.env.SEASON_ID || '2025a';

async function run() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.appspot.com` });
  }
  const bucket = admin.storage().bucket();
  const resultsPath = `results/${SEASON_ID}/${LEAGUE_ID}/${MATCH_ID}.json`;
  const replayPath = `replays/${SEASON_ID}/${LEAGUE_ID}/${MATCH_ID}.json`;
  const content = {
    matchId: MATCH_ID,
    result: { homeGoals: 2, awayGoals: 1 },
    score: { h: 2, a: 1 },
    replay: { path: replayPath, hash: 'sha256:dummmy' },
  };
  await bucket.file(resultsPath).save(JSON.stringify(content), {
    contentType: 'application/json',
  });
  console.log(JSON.stringify({ ok: true, resultsPath }));
}

run().catch((e) => { console.error(e); process.exit(1); });

