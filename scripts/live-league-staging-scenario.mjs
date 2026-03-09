import fs from 'node:fs';
import path from 'node:path';
import { initializeApp } from 'firebase/app';
import {
  applicationDefault,
  cert,
  getApps as getAdminApps,
  initializeApp as initializeAdminApp,
} from 'firebase-admin/app';
import {
  Timestamp,
  collection,
  collectionGroup,
  getDocs,
  getFirestore,
  query,
  where,
} from 'firebase/firestore';
import {
  Timestamp as AdminTimestamp,
  getFirestore as getAdminFirestore,
} from 'firebase-admin/firestore';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    date: '',
    mode: 'report',
    timezone: 'Europe/Istanbul',
    kickoffHourTr: 19,
    matchControlBaseUrl: process.env.MATCH_CONTROL_BASE_URL || '',
    matchControlSecret: process.env.MATCH_CONTROL_SECRET || '',
    outputFile: '',
    serviceAccount: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--date') out.date = args[++i] || '';
    else if (arg === '--mode') out.mode = args[++i] || 'report';
    else if (arg === '--kickoff-hour-tr') out.kickoffHourTr = Number(args[++i] || '19');
    else if (arg === '--match-control-base-url') out.matchControlBaseUrl = args[++i] || '';
    else if (arg === '--match-control-secret') out.matchControlSecret = args[++i] || '';
    else if (arg === '--out') out.outputFile = args[++i] || '';
    else if (arg === '--service-account') out.serviceAccount = args[++i] || '';
  }

  if (!Number.isInteger(out.kickoffHourTr) || out.kickoffHourTr < 0 || out.kickoffHourTr > 23) {
    throw new Error('--kickoff-hour-tr must be an integer between 0 and 23');
  }

  return out;
}

function readEnvFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function buildKickoffDate(dateValue, kickoffHourTr) {
  if (!dateValue) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    dateValue = `${year}-${month}-${day}`;
  }
  const hh = String(kickoffHourTr).padStart(2, '0');
  return new Date(`${dateValue}T${hh}:00:00+03:00`);
}

function loadServiceAccountCredential(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = JSON.parse(raw);
  return cert(parsed);
}

function buildFirestoreAccess(env, args) {
  const serviceAccountPath = args.serviceAccount || '';
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';

  if (serviceAccountPath || serviceAccountJson) {
    if (!getAdminApps().length) {
      const options = serviceAccountPath
        ? { credential: loadServiceAccountCredential(serviceAccountPath) }
        : { credential: cert(JSON.parse(serviceAccountJson)) };
      initializeAdminApp(options);
    }
    return {
      kind: 'admin',
      db: getAdminFirestore(),
      makeTimestamp(date) {
        return AdminTimestamp.fromDate(date);
      },
    };
  }

  if (!getAdminApps().length && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeAdminApp({ credential: applicationDefault() });
    return {
      kind: 'admin',
      db: getAdminFirestore(),
      makeTimestamp(date) {
        return AdminTimestamp.fromDate(date);
      },
    };
  }

  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });

  return {
    kind: 'client',
    db: getFirestore(app),
    makeTimestamp(date) {
      return Timestamp.fromDate(date);
    },
  };
}

async function getMatchControlState(baseUrl, secret, matchId) {
  if (!baseUrl || !secret || !matchId) {
    return null;
  }

  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}/v1/matches/${encodeURIComponent(matchId)}/status`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    },
  );

  if (!response.ok) {
    return { state: 'status_error', statusCode: response.status };
  }

  return response.json();
}

async function loadFixturesForKickoff(db, kickoffTimestamp, firestoreKind) {
  if (firestoreKind === 'admin') {
    try {
      const snap = await db.collectionGroup('fixtures').where('date', '==', kickoffTimestamp).get();
      return snap.docs;
    } catch {
      const leaguesSnap = await db.collection('leagues').get();
      const docs = [];
      for (const leagueDoc of leaguesSnap.docs) {
        const fixturesSnap = await leagueDoc.ref
          .collection('fixtures')
          .where('date', '==', kickoffTimestamp)
          .get();
        docs.push(...fixturesSnap.docs);
      }
      return docs;
    }
  }

  try {
    const snap = await getDocs(
      query(collectionGroup(db, 'fixtures'), where('date', '==', kickoffTimestamp)),
    );
    return snap.docs;
  } catch {
    const leaguesSnap = await getDocs(collectionGroupFallbackRoot(db));
    const docs = [];
    for (const leagueDoc of leaguesSnap.docs) {
      const fixturesSnap = await getDocs(
        query(collection(leagueDoc.ref, 'fixtures'), where('date', '==', kickoffTimestamp)),
      );
      docs.push(...fixturesSnap.docs);
    }
    return docs;
  }
}

function collectionGroupFallbackRoot(db) {
  return collection(db, 'leagues');
}

function summarizeFixtures(fixtures) {
  const summary = {
    total: fixtures.length,
    scheduled: 0,
    running: 0,
    played: 0,
    failed: 0,
    withLiveMatchId: 0,
    liveStates: {},
    missingVideo: 0,
    missingScore: 0,
  };

  for (const fixture of fixtures) {
    const status = String(fixture.status || 'unknown');
    const liveState = String(fixture.live?.state || 'none');
    summary[status] = (summary[status] || 0) + 1;
    summary.liveStates[liveState] = (summary.liveStates[liveState] || 0) + 1;
    if (fixture.live?.matchId) summary.withLiveMatchId += 1;
    if (fixture.videoMissing) summary.missingVideo += 1;
    if (fixture.status === 'played' && !fixture.score) summary.missingScore += 1;
  }

  return summary;
}

function evaluate(summary, mode) {
  if (mode === 'report') {
    return { ok: true, failures: [] };
  }

  const failures = [];
  if (mode === 'prewarm') {
    if (summary.withLiveMatchId !== summary.total) {
      failures.push('Not every fixture has live.matchId before kickoff.');
    }
    const warmCount = Number(summary.liveStates.warm || 0);
    if (warmCount !== summary.total) {
      failures.push(`Expected all fixtures to be warm; got warm=${warmCount}, total=${summary.total}.`);
    }
  }

  if (mode === 'kickoff') {
    const good = Number(summary.liveStates.running || 0) + Number(summary.liveStates.server_started || 0);
    const failed = Number(summary.liveStates.failed || 0) + Number(summary.liveStates.kickoff_failed || 0);
    if (good + failed !== summary.total) {
      failures.push('Some fixtures are neither running nor failed after kickoff window.');
    }
  }

  if (mode === 'final') {
    if (summary.played !== summary.total) {
      failures.push(`Expected all fixtures to be played; got played=${summary.played}, total=${summary.total}.`);
    }
    if (summary.missingScore > 0) {
      failures.push(`Played fixtures missing score: ${summary.missingScore}.`);
    }
  }

  return { ok: failures.length === 0, failures };
}

async function run() {
  const args = parseArgs();
  const env = readEnvFile(path.resolve('.env.local'));
  const firestoreAccess = buildFirestoreAccess(env, args);
  const db = firestoreAccess.db;
  const kickoffAt = buildKickoffDate(args.date, args.kickoffHourTr);
  const kickoffTimestamp = firestoreAccess.makeTimestamp(kickoffAt);

  const docs = await loadFixturesForKickoff(db, kickoffTimestamp, firestoreAccess.kind);

  const fixtures = docs.map((docSnap) => {
    const data = docSnap.data();
    const leagueId = docSnap.ref.parent.parent?.id || null;
    return {
      id: docSnap.id,
      leagueId,
      status: data.status || 'unknown',
      live: data.live || null,
      videoMissing: Boolean(data.videoMissing),
      score: data.score || null,
    };
  });

  const sampleStatuses = [];
  for (const fixture of fixtures.slice(0, 10)) {
    if (!fixture.live?.matchId) continue;
    const status = await getMatchControlState(
      args.matchControlBaseUrl,
      args.matchControlSecret,
      fixture.live.matchId,
    );
    sampleStatuses.push({
      fixtureId: fixture.id,
      matchId: fixture.live.matchId,
      firestoreState: fixture.live.state || null,
      matchControlState: status?.state || null,
    });
  }

  const summary = summarizeFixtures(fixtures);
  const evaluation = evaluate(summary, args.mode);

  const output = {
        mode: args.mode,
        firestoreMode: firestoreAccess.kind,
        kickoffHourTR: args.kickoffHourTr,
        kickoffAt: kickoffAt.toISOString(),
        summary,
        sampleStatuses,
    failures: evaluation.failures,
  };

  if (args.outputFile) {
    fs.writeFileSync(path.resolve(args.outputFile), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify(output, null, 2));

  if (!evaluation.ok) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
