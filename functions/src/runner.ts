import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export const runDailyMatches = functions.pubsub
  .schedule('0 19 * * *')
  .timeZone('Europe/Istanbul')
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const snap = await db
      .collectionGroup('fixtures')
      .where('status', '==', 'scheduled')
      .where('date', '<=', now)
      .get();
    await Promise.all(snap.docs.map(processMatch));
  });

async function processMatch(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = doc.data() as any;
  const leagueRef = doc.ref.parent.parent!;
  const homeRef = leagueRef.collection('standings').doc(data.homeTeamId);
  const awayRef = leagueRef.collection('standings').doc(data.awayTeamId);
  const homeScore = Math.floor(Math.random() * 5);
  const awayScore = Math.floor(Math.random() * 5);
  await db.runTransaction(async (tx) => {
    tx.update(doc.ref, {
      status: 'played',
      score: { home: homeScore, away: awayScore },
    });
    const homeSnap = await tx.get(homeRef);
    const awaySnap = await tx.get(awayRef);
    const hs = homeSnap.exists ? (homeSnap.data() as any) : {
      teamId: data.homeTeamId,
      name: '',
      P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0,
    };
    const as = awaySnap.exists ? (awaySnap.data() as any) : {
      teamId: data.awayTeamId,
      name: '',
      P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0,
    };
    hs.P++; as.P++;
    hs.GF += homeScore; hs.GA += awayScore;
    as.GF += awayScore; as.GA += homeScore;
    hs.GD = hs.GF - hs.GA; as.GD = as.GF - as.GA;
    if (homeScore > awayScore) { hs.W++; as.L++; hs.Pts += 3; }
    else if (homeScore < awayScore) { as.W++; hs.L++; as.Pts += 3; }
    else { hs.D++; as.D++; hs.Pts++; as.Pts++; }
    tx.set(homeRef, hs, { merge: true });
    tx.set(awayRef, as, { merge: true });
  });
}
