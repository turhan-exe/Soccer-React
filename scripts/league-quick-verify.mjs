// Quick end-to-end verifier for league onboarding
// Usage examples:
//   node scripts/league-quick-verify.mjs --email you@example.com --password 123456 --teams 22
//   node scripts/league-quick-verify.mjs -e you@example.com -p 123456 -n 10 --cleanup
//
// What it does:
// - Signs in (or creates) a Firebase Auth user with given credentials
// - Ensures N team docs owned by that user exist (teams/{id})
// - Calls HTTP function assignTeamToLeagueHttp for each team to place them in leagues
// - Prints the target league, state, team count and fixture count
// - Optional --cleanup removes only the extra top-level team docs (safe cleanup)

import fs from 'node:fs';
import path from 'node:path';

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import {
  getFirestore,
  setDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  collection,
  collectionGroup,
  deleteDoc,
} from 'firebase/firestore';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { email: '', password: '', teams: 22, cleanup: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--email' || a === '-e') out.email = args[++i] || '';
    else if (a === '--password' || a === '-p') out.password = args[++i] || '';
    else if (a === '--teams' || a === '-n') out.teams = Number(args[++i] || '22');
    else if (a === '--cleanup') out.cleanup = true;
  }
  if (!out.email || !out.password) {
    console.error('Usage: node scripts/league-quick-verify.mjs --email <e> --password <p> [--teams 22] [--cleanup]');
    process.exit(1);
  }
  if (!Number.isFinite(out.teams) || out.teams < 1) out.teams = 1;
  return out;
}

function readEnvLocal() {
  const p = path.resolve('.env.local');
  const raw = fs.readFileSync(p, 'utf8');
  const obj = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const k = m[1];
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    obj[k] = v;
  }
  return obj;
}

async function ensureSignedIn(app, email, password) {
  const auth = getAuth(app);
  try {
    await signInWithEmailAndPassword(auth, email, password);
    return auth.currentUser;
  } catch (e) {
    // try create
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    return cred.user;
  }
}

async function ensureTeamDocs(db, ownerUid, count) {
  const ids = [];
  // Base team id = uid (first one)
  ids.push(ownerUid);
  for (let i = 1; i < count; i++) ids.push(`${ownerUid}-bot${i}`);
  // Create minimal team docs satisfying security rules
  for (const id of ids) {
    await setDoc(
      doc(db, 'teams', id),
      { name: `auto-${id.slice(0, 8)}`, ownerUid },
      { merge: true }
    );
  }
  return ids;
}

async function httpAssign(region, projectId, idToken, teamId) {
  const url = `https://${region}-${projectId}.cloudfunctions.net/assignTeamToLeagueHttp`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ teamId }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`assign(${teamId}) HTTP ${resp.status} ${text}`);
  }
}

async function findLeagueForTeam(db, teamId) {
  const q = query(collectionGroup(db, 'teams'), where('teamId', '==', teamId), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].ref.parent.parent; // leagues/{leagueId}
}

async function countFixtures(db, leagueId) {
  const col = collection(db, 'leagues', leagueId, 'fixtures');
  const snap = await getDocs(col);
  return snap.size;
}

async function run() {
  const { email, password, teams, cleanup } = parseArgs();
  const env = readEnvLocal();
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  const region = env.VITE_FUNCTIONS_REGION || 'europe-west1';
  if (!config.apiKey || !config.projectId) {
    console.error('Missing Firebase env. Ensure .env.local has VITE_FIREBASE_* keys.');
    process.exit(1);
  }

  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const user = await ensureSignedIn(app, email, password);
  const uid = user.uid;

  console.log(`[verify] signed in as ${uid}`);
  const ids = await ensureTeamDocs(db, uid, teams);
  console.log(`[verify] ensured ${ids.length} team docs`);

  const idToken = await user.getIdToken();
  for (const id of ids) {
    await httpAssign(region, config.projectId, idToken, id);
  }
  console.log(`[verify] assigned all teams`);

  const leagueRef = await findLeagueForTeam(db, ids[0]);
  if (!leagueRef) {
    console.log('[verify] team not found in any league');
    process.exit(2);
  }
  const leagueSnap = await getDoc(leagueRef);
  const league = leagueSnap.data();
  const fixtures = await countFixtures(db, leagueRef.id);

  console.log(JSON.stringify({
    ok: true,
    leagueId: leagueRef.id,
    state: league.state,
    teamCount: league.teamCount,
    fixtures,
  }, null, 2));

  if (cleanup) {
    // Safe cleanup: remove only extra top-level team docs (not league membership)
    for (let i = 1; i < ids.length; i++) {
      await deleteDoc(doc(db, 'teams', ids[i]));
    }
    console.log('[verify] cleanup: extra top-level team docs deleted');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
