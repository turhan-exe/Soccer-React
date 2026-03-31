import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = path.resolve(__dirname, '..');
const ENV_PROD_PATH = path.join(FUNCTIONS_DIR, '.env.prod');

loadEnvFile(ENV_PROD_PATH);

const MATCH_CONTROL_BASE_URL = String(process.env.MATCH_CONTROL_BASE_URL || '').replace(/\/$/, '');
const MATCH_CONTROL_SECRET = String(process.env.MATCH_CONTROL_SECRET || '').trim();
const LEAGUE_LIFECYCLE_SECRET = String(process.env.LEAGUE_LIFECYCLE_SECRET || '').trim();
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.PROJECT_ID || 'osm-react';
const FUNCTIONS_BASE_URL =
  process.env.FUNCTIONS_BASE_URL || `https://europe-west1-${PROJECT_ID}.cloudfunctions.net`;

if (!MATCH_CONTROL_BASE_URL || !MATCH_CONTROL_SECRET || !LEAGUE_LIFECYCLE_SECRET) {
  throw new Error('MATCH_CONTROL_BASE_URL, MATCH_CONTROL_SECRET ve LEAGUE_LIFECYCLE_SECRET gerekli.');
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.appspot.com` });
}

const db = admin.firestore();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function getInternalMatch(matchId) {
  const response = await fetch(
    `${MATCH_CONTROL_BASE_URL}/v1/internal/matches/${encodeURIComponent(matchId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${MATCH_CONTROL_SECRET}`,
      },
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`internal_match_fetch_failed:${response.status}:${text || '<empty>'}`);
  }

  const payload = await response.json();
  return payload?.match ?? null;
}

async function replayEndedLifecycle(match) {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/ingestLeagueMatchLifecycleHttp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LEAGUE_LIFECYCLE_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      matchId: match.id,
      leagueId: match.leagueId,
      fixtureId: match.fixtureId,
      state: 'ended',
      reason: match.endedReason || 'final_snapshot_sent',
      minute: Number.isFinite(match.liveMinute) ? Number(match.liveMinute) : 90,
      minuteUpdatedAt: match.liveMinuteAt || null,
      homeScore: Number.isFinite(match.homeScore) ? Number(match.homeScore) : null,
      awayScore: Number.isFinite(match.awayScore) ? Number(match.awayScore) : null,
      result: match.resultPayload || null,
      endedAt: match.endedAt || null,
      updatedAt: match.updatedAt || null,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`lifecycle_replay_failed:${response.status}:${text || '<empty>'}`);
  }

  return response.json();
}

async function main() {
  const report = {
    scanned: 0,
    finalized: 0,
    skippedNoMatchId: 0,
    skippedNotEnded: 0,
    skippedNoResult: 0,
    missingInternalMatch: 0,
    errors: [],
  };

  const leaguesSnap = await db
    .collection('leagues')
    .where('state', 'in', ['scheduled', 'active', 'completed'])
    .get();

  for (const leagueDoc of leaguesSnap.docs) {
    const fixturesSnap = await leagueDoc.ref
      .collection('fixtures')
      .where('live.reason', '==', 'manual_backlog_replay')
      .get();

    for (const fixtureDoc of fixturesSnap.docs) {
      const fixture = fixtureDoc.data() || {};
      const fixtureStatus = String(fixture.status || '').trim().toLowerCase();
      const nestedLiveState = String(fixture?.live?.state || '').trim().toLowerCase();
      const needsRecovery =
        fixtureStatus !== 'played' ||
        nestedLiveState !== 'ended' ||
        fixture?.live?.resultMissing === true;

      if (!needsRecovery) {
        continue;
      }

      const matchId =
        String(fixture?.live?.manualReplayMatchId || '').trim() ||
        String(fixture?.live?.matchId || '').trim();

      report.scanned += 1;

      if (!matchId) {
        report.skippedNoMatchId += 1;
        continue;
      }

      try {
        const match = await getInternalMatch(matchId);
        if (!match) {
          report.missingInternalMatch += 1;
          continue;
        }

        if (String(match.status || '').trim().toLowerCase() !== 'ended') {
          report.skippedNotEnded += 1;
          continue;
        }

        if (!match.resultPayload) {
          report.skippedNoResult += 1;
          continue;
        }

        await replayEndedLifecycle(match);
        report.finalized += 1;
      } catch (error) {
        report.errors.push({
          leagueId: leagueDoc.id,
          fixtureId: fixtureDoc.id,
          matchId,
          message: String(error?.message || error),
        });
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
