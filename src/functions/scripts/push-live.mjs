// Push a couple of live events into RTDB for a match
// Usage: node src/functions/scripts/push-live.mjs [matchId]
// Env: PROJECT_ID (default demo-osm-react)

import admin from 'firebase-admin';

const PROJECT_ID = process.env.PROJECT_ID || 'demo-osm-react';
const MATCH_ID = process.argv[2] || 'M001';

async function run() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID, databaseURL: `http://localhost:9000?ns=${PROJECT_ID}` });
  }
  const rtdb = admin.database();
  const base = rtdb.ref(`live/${MATCH_ID}`);
  await base.child('meta').set({ startedAt: Date.now() });
  await base.child('events').push({ ts: Date.now(), type: 'kickoff', payload: {} });
  await base.child('events').push({ ts: Date.now() + 500, type: 'goal', payload: { team: 'home' } });
  console.log(JSON.stringify({ ok: true, matchId: MATCH_ID }));
}

run().catch((e) => { console.error(e); process.exit(1); });

