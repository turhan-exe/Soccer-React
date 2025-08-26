import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { generateRoundRobinFixtures, getNextStartDate } from './utils/schedule';

admin.initializeApp();
const db = admin.firestore();

export const assignTeamToLeague = functions.https.onCall(async (data, context) => {
  const teamId: string = data.teamId;
  if (!teamId) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId required');
  }
  const leagueSnap = await db.runTransaction(async (tx) => {
    // ensure team not already in a league
    const existing = await tx.get(
      db.collectionGroup('teams').where('teamId', '==', teamId).limit(1)
    );
    if (!existing.empty) {
      return existing.docs[0].ref.parent.parent!; // league ref
    }
    // find oldest forming league
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
      tx.set(leagueRef, {
        name: `League ${leagueRef.id}`,
        season: 1,
        capacity: 22,
        timezone: 'Europe/Istanbul',
        state: 'forming',
        rounds: 21,
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
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const count = teamsSnap.size + 1;
    if (count === 22) {
      const startDate = getNextStartDate();
      tx.update(leagueRef, {
        state: 'scheduled',
        startDate: admin.firestore.Timestamp.fromDate(startDate),
      });
    }
    return leagueRef;
  });

  // generate fixtures if scheduled
  const leagueData = (await leagueSnap.get()).data() as any;
  if (leagueData.state === 'scheduled') {
    await generateFixturesForLeague(leagueSnap.id);
  }
  return { leagueId: leagueSnap.id, state: leagueData.state };
});

async function generateFixturesForLeague(leagueId: string) {
  const leagueRef = db.collection('leagues').doc(leagueId);
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
