// E2E happy path: seed -> lockWindowSnapshot -> orchestrate19TRT -> push live -> finalize via Storage
// Requires emulators running (firestore, functions, storage, database)
// Usage: node src/functions/scripts/e2e-lock-start-finalize.mjs [matchId]
// Env:
//   PROJECT_ID=demo-osm-react (default)
//   ORCH_SECRET=... (must match functions:config: set)
//   LEAGUE_ID=L-TR-1-2025a (default), SEASON_ID=2025a
//   FUNCTIONS_EMULATOR=http://127.0.0.1:5001 (default)

import admin from 'firebase-admin';

const PROJECT_ID = process.env.PROJECT_ID || 'demo-osm-react';
const MATCH_ID = process.argv[2] || 'M001';
const LEAGUE_ID = process.env.LEAGUE_ID || 'L-TR-1-2025a';
const SEASON_ID = process.env.SEASON_ID || '2025a';
const REGION = process.env.REGION || 'europe-west1';
const FNEMU = process.env.FUNCTIONS_EMULATOR || 'http://127.0.0.1:5001';
const ORCH_SECRET = process.env.ORCH_SECRET || process.env.SCHED_SECRET || '';

async function httpPost(path, body, headers = {}) {
  const url = `${FNEMU}/${PROJECT_ID}/${REGION}/${path}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body || {}),
  });
  const txt = await r.text();
  try { return { status: r.status, ok: r.ok, json: JSON.parse(txt) }; } catch { return { status: r.status, ok: r.ok, text: txt }; }
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.appspot.com` });
  }
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  // 1) Seed (idempotent)
  const { spawn } = await import('node:child_process');
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['src/functions/scripts/seed.mjs', MATCH_ID], { stdio: 'inherit' });
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error('seed failed')));
  });

  // 2) Lock window snapshot (auth via secret)
  if (!ORCH_SECRET) throw new Error('ORCH_SECRET missing for lock');
  await httpPost('lockWindowSnapshot', {}, { Authorization: `Bearer ${ORCH_SECRET}` });

  // Assert matchPlans exists
  const plan = await db.doc(`matchPlans/${MATCH_ID}`).get();
  if (!plan.exists) throw new Error('matchPlans missing after lock');

  // 3) Orchestrate 19TRT (auth)
  if (!ORCH_SECRET) throw new Error('ORCH_SECRET missing');
  const r = await httpPost('orchestrate19TRT', {}, { Authorization: `Bearer ${ORCH_SECRET}` });
  if (!r.ok) throw new Error(`orchestrate failed: ${r.status}`);

  await wait(200);

  // Ensure fixture is running
  const fxRef = db.doc(`leagues/${LEAGUE_ID}/fixtures/${MATCH_ID}`);
  const fx1 = (await fxRef.get()).data() || {};
  if (fx1.status !== 'running') throw new Error(`fixture not running (status=${fx1.status})`);

  // 4) Push sample live events
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['src/functions/scripts/push-live.mjs', MATCH_ID], { stdio: 'inherit' });
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error('push-live failed')));
  });

  // 5) Upload a results JSON to trigger onResultFinalize
  const resultsPath = `results/${SEASON_ID}/${LEAGUE_ID}/${MATCH_ID}.json`;
  const replayPath = `replays/${SEASON_ID}/${LEAGUE_ID}/${MATCH_ID}.json`;
  await bucket.file(resultsPath).save(JSON.stringify({ matchId: MATCH_ID, score: { h: 2, a: 1 }, replay: { path: replayPath } }), { contentType: 'application/json' });

  // Give trigger a moment
  await wait(350);

  const fx2Snap = await fxRef.get();
  const fx2 = fx2Snap.data() || {};
  if (fx2.status !== 'played') throw new Error(`fixture not played (status=${fx2.status})`);
  if (!fx2.replayPath) throw new Error('replayPath missing');

  console.log(JSON.stringify({ ok: true, leagueId: LEAGUE_ID, matchId: MATCH_ID, replayPath: fx2.replayPath }));
}

run().catch((e) => { console.error(e); process.exit(1); });
