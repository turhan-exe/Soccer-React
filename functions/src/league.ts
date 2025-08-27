import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { generateRoundRobinFixtures, nextValid19TR } from './utils/schedule';

admin.initializeApp();
const db = admin.firestore();

/**
 * Core logic for assigning a team to a league. Ensures a team is only placed
 * into one league and that a new league is created when none are available.
 * When the league reaches 22 teams, it is scheduled and fixtures are created.
 */
async function assignTeam(teamId: string, teamName: string) {
  const leagueRef = await db.runTransaction(async (tx) => {
    const existing = await tx.get(
      db
        .collectionGroup('teams')
        .where('teamId', '==', teamId)
        .limit(1)
    );
    if (!existing.empty) {
      return existing.docs[0].ref.parent.parent!; // already in league
    }

    const forming = await tx.get(
      db
        .collection('leagues')
        .where('state', '==', 'forming')
        .orderBy('createdAt', 'asc')
        .limit(1)
    );
    let leagueRef: FirebaseFirestore.DocumentReference;
    if (forming.empty) {
      leagueRef = db.collection('leagues').doc();
      const last = await tx.get(
        db.collection('leagues').orderBy('season', 'desc').limit(1)
      );
      const nextSeason = last.empty
        ? 1
        : ((last.docs[0].data() as any).season || 0) + 1;
      tx.set(leagueRef, {
        name: `League ${nextSeason}`,
        season: nextSeason,
        capacity: 22,
        timezone: 'Europe/Istanbul',
        state: 'forming',
        rounds: 21,
        teamCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      leagueRef = forming.docs[0].ref;
    }

    const teamsCol = leagueRef.collection('teams');
    const teamsSnap = await tx.get(teamsCol);
    if (teamsSnap.docs.some((d) => d.id === teamId)) {
      return leagueRef;
    }
    tx.set(teamsCol.doc(teamId), {
      teamId,
      name: teamName,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const count = teamsSnap.size + 1;
    const updateData: FirebaseFirestore.UpdateData = { teamCount: count };
    if (count === 22) {
      const startDate = nextValid19TR();
      updateData.state = 'scheduled';
      updateData.startDate = admin.firestore.Timestamp.fromDate(startDate);
    }
    tx.update(leagueRef, updateData);

    return leagueRef;
  });

  const leagueSnap = await leagueRef.get();
  const leagueData = leagueSnap.data() as any;
  if (leagueData.state === 'scheduled') {
    const startDate: Date = leagueData.startDate.toDate();
    const fixturesSnap = await leagueRef.collection('fixtures').limit(1).get();
    if (fixturesSnap.empty) {
      await generateFixturesForLeague(leagueRef.id, startDate);
    }
  }
  return { leagueRef, state: leagueData.state };
}

export const assignTeamToLeague = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  }
  const teamId: string = data.teamId;
  if (!teamId) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId required');
  }
  const teamSnap = await db.collection('teams').doc(teamId).get();
  if (!teamSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Team not found');
  }
  const teamData = teamSnap.data() as any;
  if (teamData.ownerUid && teamData.ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not owner');
  }
  const { leagueRef, state } = await assignTeam(teamId, teamData.name || `Team ${teamId}`);
  return { leagueId: leagueRef.id, state };
});

export const assignAllTeamsToLeagues = functions.https.onRequest(async (_req, res) => {
  const snap = await db.collection('teams').get();
  const results: { teamId: string; leagueId: string; state: string }[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as any;
    const { leagueRef, state } = await assignTeam(doc.id, data.name || `Team ${doc.id}`);
    results.push({ teamId: doc.id, leagueId: leagueRef.id, state });
  }
  res.json({ assigned: results.length, details: results });
});

async function generateFixturesForLeague(leagueId: string, startDate: Date) {
  const leagueRef = db.collection('leagues').doc(leagueId);
  const teamsSnap = await leagueRef.collection('teams').get();
  const teamIds = teamsSnap.docs.map((d) => d.id);
  const fixtures = generateRoundRobinFixtures(teamIds);
  const batch = db.batch();
  fixtures.forEach((m) => {
    const date = new Date(startDate.getTime());
    date.setUTCDate(date.getUTCDate() + (m.round - 1));
    const ref = leagueRef.collection('fixtures').doc();
    batch.set(ref, {
      round: m.round,
      date: admin.firestore.Timestamp.fromDate(date),
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      participants: [m.homeTeamId, m.awayTeamId],
      status: 'scheduled',
      score: null,
    });
  });
  await batch.commit();
}

export const generateRoundRobinFixturesFn = functions.https.onCall(async (data) => {
  const leagueRef = db.collection('leagues').doc(data.leagueId);
  const leagueSnap = await leagueRef.get();
  const league = leagueSnap.data() as any;
  await generateFixturesForLeague(data.leagueId, league.startDate.toDate());
  return true;
});

