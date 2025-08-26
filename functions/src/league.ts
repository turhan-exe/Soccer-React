import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { generateRoundRobinFixtures, getNextStartDate } from './utils/schedule';

admin.initializeApp();
const db = admin.firestore();

/**
 * Core logic for assigning a team to a league. Ensures a team is only placed
 * into one league and that a new league is created when none are available.
 * When the league reaches 22 teams, it is scheduled and fixtures are created.
 */
async function assignTeam(teamId: string) {
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

    const leaguesCol = db.collection('lig');
    const forming = await tx.get(
      leaguesCol.where('state', '==', 'forming').orderBy('createdAt', 'asc').limit(1)
    );
    let leagueRef: FirebaseFirestore.DocumentReference;
    if (forming.empty) {
      const allLeagues = await tx.get(leaguesCol);
      const nextId = `lig${allLeagues.size + 1}`;
      leagueRef = leaguesCol.doc(nextId);
      tx.set(leagueRef, {
        name: `Lig ${nextId}`,
        season: 1,
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
    const teamDoc = await tx.get(db.collection('teams').doc(teamId));
    const teamName = (teamDoc.data() as any)?.name || `Team ${teamId}`;
    tx.set(teamsCol.doc(teamId), {
      teamId,
      name: teamName,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const count = teamsSnap.size + 1;
    const updateData: FirebaseFirestore.UpdateData = { teamCount: count };
    if (count === 22) {
      const startDate = getNextStartDate();
      updateData.state = 'scheduled';
      updateData.startDate = admin.firestore.Timestamp.fromDate(startDate);
    }
    tx.update(leagueRef, updateData);

    return leagueRef;
  });

  const leagueData = (await leagueRef.get()).data() as any;
  if (leagueData.state === 'scheduled') {
    await generateFixturesForLeague(leagueRef.id);
  }
  return { leagueRef, state: leagueData.state };
}

export const assignTeamToLeague = functions.https.onCall(async (data) => {
  const teamId: string = data.teamId;
  if (!teamId) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId required');
  }
  const { leagueRef, state } = await assignTeam(teamId);
  return { leagueId: leagueRef.id, state };
});

export const assignAllTeamsToLeagues = functions.https.onRequest(async (_req, res) => {
  const snap = await db.collection('teams').get();
  const results: { teamId: string; leagueId: string; state: string }[] = [];
  for (const doc of snap.docs) {
    const { leagueRef, state } = await assignTeam(doc.id);
    results.push({ teamId: doc.id, leagueId: leagueRef.id, state });
  }
  res.json({ assigned: results.length, details: results });
});

async function generateFixturesForLeague(leagueId: string) {
  const leagueRef = db.collection('lig').doc(leagueId);
  const leagueSnap = await leagueRef.get();
  const league = leagueSnap.data() as any;
  const teamsSnap = await leagueRef.collection('teams').get();
  const teamIds = teamsSnap.docs.map((d) => d.id);
  const fixtures = generateRoundRobinFixtures(teamIds);
  const batch = db.batch();
  fixtures.forEach((m) => {
    const date = new Date(league.startDate.toDate().getTime());
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
  await generateFixturesForLeague(data.leagueId);
  return true;
});

