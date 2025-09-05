import * as functions from 'firebase-functions/v1';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as pubsub from 'firebase-functions/v1/pubsub';

const db = getFirestore();

export const runDailyMatches = functions
  .region('europe-west1')
  .pubsub.schedule('0 19 * * *')
  .timeZone('Europe/Istanbul')
  .onRun(async () => {
    const tz = 'Europe/Istanbul';
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(now);
    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    const local = new Date(Date.UTC(year, month - 1, day, 19, 0, 0));
    const offset =
      new Date(local.toLocaleString('en-US', { timeZone: tz })).getTime() -
      local.getTime();
    const target = new Date(local.getTime() - offset);
    const matchTs = Timestamp.fromDate(target);

    const leaguesSnap = await db
      .collection('leagues')
      .where('state', 'in', ['scheduled', 'active'])
      .get();

    for (const leagueDoc of leaguesSnap.docs) {
      const leagueRef = leagueDoc.ref;
      const fixturesSnap = await leagueRef
        .collection('fixtures')
        .where('status', '==', 'scheduled')
        .where('date', '==', matchTs)
        .get();
      for (const matchDoc of fixturesSnap.docs) {
        await processMatch(leagueRef, matchDoc);
      }
      if (!fixturesSnap.empty && leagueDoc.data().state === 'scheduled') {
        await leagueRef.update({ state: 'active' });
      }
      const remaining = await leagueRef
        .collection('fixtures')
        .where('status', '==', 'scheduled')
        .limit(1)
        .get();
      if (remaining.empty) {
        await leagueRef.update({ state: 'completed' });
      }
    }
  });

async function processMatch(
  leagueRef: FirebaseFirestore.DocumentReference,
  doc: FirebaseFirestore.QueryDocumentSnapshot,
) {
  const data = doc.data() as any;
  const homeRef = leagueRef.collection('standings').doc(data.homeTeamId);
  const awayRef = leagueRef.collection('standings').doc(data.awayTeamId);
  const homeScore = Math.floor(Math.random() * 5);
  const awayScore = Math.floor(Math.random() * 5);
  await doc.ref.update({ status: 'in_progress' });
  await db.runTransaction(async (tx) => {
    const homeSnap = await tx.get(homeRef);
    const awaySnap = await tx.get(awayRef);
    const hs = homeSnap.exists
      ? (homeSnap.data() as any)
      : {
          teamId: data.homeTeamId,
          name: '',
          P: 0,
          W: 0,
          D: 0,
          L: 0,
          GF: 0,
          GA: 0,
          GD: 0,
          Pts: 0,
        };
    const as = awaySnap.exists
      ? (awaySnap.data() as any)
      : {
          teamId: data.awayTeamId,
          name: '',
          P: 0,
          W: 0,
          D: 0,
          L: 0,
          GF: 0,
          GA: 0,
          GD: 0,
          Pts: 0,
        };
    hs.P++;
    as.P++;
    hs.GF += homeScore;
    hs.GA += awayScore;
    as.GF += awayScore;
    as.GA += homeScore;
    hs.GD = hs.GF - hs.GA;
    as.GD = as.GF - as.GA;
    if (homeScore > awayScore) {
      hs.W++;
      as.L++;
      hs.Pts += 3;
    } else if (homeScore < awayScore) {
      as.W++;
      hs.L++;
      as.Pts += 3;
    } else {
      hs.D++;
      as.D++;
      hs.Pts++;
      as.Pts++;
    }
    tx.update(doc.ref, {
      status: 'played',
      score: { home: homeScore, away: awayScore },
    });
    tx.set(homeRef, hs, { merge: true });
    tx.set(awayRef, as, { merge: true });
  });
}
