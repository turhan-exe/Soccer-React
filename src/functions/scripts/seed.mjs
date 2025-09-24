// Seed minimal league, teams and a fixture for emulator E2E
// Usage: node src/functions/scripts/seed.mjs [matchId]
// Env:
//   PROJECT_ID=demo-osm-react (default)
//   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 (optional)
//   FIRESTORE_EMULATOR_HOST=localhost:8080
//   FIREBASE_DATABASE_EMULATOR_HOST=localhost:9000
//   FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199
// Notes: Run under functions package (has firebase-admin dep)

import admin from 'firebase-admin';
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'Europe/Istanbul';
const PROJECT_ID = process.env.PROJECT_ID || 'demo-osm-react';
const MATCH_ID = process.argv[2] || 'M001';
const LEAGUE_ID = process.env.LEAGUE_ID || 'L-TR-1-2025a';
const SEASON_ID = process.env.SEASON_ID || '2025a';

function todayTR(d = new Date()) {
  return formatInTimeZone(d, TZ, 'yyyy-MM-dd');
}

function trAt(d, hh, mm = 0) {
  const iso = formatInTimeZone(d, TZ, "yyyy-MM-dd'T'00:00:00XXX");
  const base = new Date(iso);
  base.setUTCHours(hh - base.getTimezoneOffset() / 60, mm, 0, 0);
  return base;
}

async function run() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  const db = admin.firestore();

  // League
  await db.doc(`leagues/${LEAGUE_ID}`).set({
    id: LEAGUE_ID,
    seasonId: SEASON_ID,
    state: 'scheduled',
    rounds: 21,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Two teams with simple 11 starters + 7 bench
  const makeTeam = (id, idx) => ({
    id,
    ownerUid: `U${idx}`,
    clubName: `Kulüp ${idx}`,
    leagueId: LEAGUE_ID,
    players: [
      // 11 starters
      ...Array.from({ length: 11 }, (_, i) => ({
        id: `${id}-${i + 1}`,
        name: `P${idx}-${i + 1}`,
        position: i === 0 ? 'GK' : i < 5 ? 'DEF' : i < 9 ? 'MID' : 'FW',
        overall: 60 + ((i + idx) % 20),
        squadRole: 'starting',
        condition: 0.82,
        motivation: 0.8,
      })),
      // 7 bench
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `${id}-b${i + 1}`,
        name: `B${idx}-${i + 1}`,
        position: i < 3 ? 'DEF' : i < 5 ? 'MID' : 'FW',
        overall: 55 + ((i + idx) % 15),
        squadRole: 'bench',
        condition: 0.76,
        motivation: 0.74,
      })),
    ],
  });

  const team1 = makeTeam('T001', 1);
  const team2 = makeTeam('T002', 2);

  await db.doc(`teams/${team1.id}`).set(team1, { merge: true });
  await db.doc(`teams/${team2.id}`).set(team2, { merge: true });

  // Put into league teams subcollection (optional mirror)
  await db.doc(`leagues/${LEAGUE_ID}/teams/${team1.id}`).set({ id: team1.id, ownerUid: team1.ownerUid, clubName: team1.clubName }, { merge: true });
  await db.doc(`leagues/${LEAGUE_ID}/teams/${team2.id}`).set({ id: team2.id, ownerUid: team2.ownerUid, clubName: team2.clubName }, { merge: true });

  // Fixture at today 19:00 TR
  const kickoff = trAt(new Date(), 19, 0);
  await db.doc(`leagues/${LEAGUE_ID}/fixtures/${MATCH_ID}`).set({
    id: MATCH_ID,
    leagueId: LEAGUE_ID,
    seasonId: SEASON_ID,
    round: 1,
    homeTeamId: team1.id,
    awayTeamId: team2.id,
    participants: [team1.id, team2.id],
    date: admin.firestore.Timestamp.fromDate(kickoff),
    status: 'scheduled',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log(JSON.stringify({ ok: true, leagueId: LEAGUE_ID, seasonId: SEASON_ID, matchId: MATCH_ID, kickoff: kickoff.toISOString() }));
}

run().catch((e) => { console.error(e); process.exit(1); });

