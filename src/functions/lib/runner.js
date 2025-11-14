import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
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
    const offset = new Date(local.toLocaleString('en-US', { timeZone: tz })).getTime() -
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
async function processMatch(leagueRef, doc) {
    const data = doc.data();
    const homeRef = leagueRef.collection('standings').doc(data.homeTeamId);
    const awayRef = leagueRef.collection('standings').doc(data.awayTeamId);
    const homeScore = Math.floor(Math.random() * 5);
    const awayScore = Math.floor(Math.random() * 5);
    const goalTimeline = buildGoalTimeline(homeScore, awayScore, `${doc.id}-${data.homeTeamId || 'home'}-${data.awayTeamId || 'away'}`);
    await doc.ref.update({ status: 'in_progress' });
    await db.runTransaction(async (tx) => {
        const homeSnap = await tx.get(homeRef);
        const awaySnap = await tx.get(awayRef);
        const hs = homeSnap.exists
            ? homeSnap.data()
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
            ? awaySnap.data()
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
        }
        else if (homeScore < awayScore) {
            as.W++;
            hs.L++;
            as.Pts += 3;
        }
        else {
            hs.D++;
            as.D++;
            hs.Pts++;
            as.Pts++;
        }
        tx.update(doc.ref, {
            status: 'played',
            score: { home: homeScore, away: awayScore },
            goalTimeline,
        });
        tx.set(homeRef, hs, { merge: true });
        tx.set(awayRef, as, { merge: true });
    });
}
// Slot-based variant for monthly leagues with 15 teams (double round-robin)
export const runDailyMatchesAt19TR = functions
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
    const offset = new Date(local.toLocaleString('en-US', { timeZone: tz })).getTime() - local.getTime();
    const target = new Date(local.getTime() - offset);
    const matchTs = Timestamp.fromDate(target);
    const leaguesSnap = await db.collection('leagues').where('state', 'in', ['scheduled', 'active']).get();
    for (const leagueDoc of leaguesSnap.docs) {
        const leagueRef = leagueDoc.ref;
        const fixturesSnap = await leagueRef
            .collection('fixtures')
            .where('status', '==', 'scheduled')
            .where('date', '==', matchTs)
            .get();
        for (const matchDoc of fixturesSnap.docs) {
            await processSlotMatch(leagueRef, matchDoc);
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
async function processSlotMatch(leagueRef, doc) {
    const data = doc.data();
    const homeRef = leagueRef.collection('standings').doc(String(data.homeSlot));
    const awayRef = leagueRef.collection('standings').doc(String(data.awaySlot));
    const homeScore = Math.floor(Math.random() * 5);
    const awayScore = Math.floor(Math.random() * 5);
    const goalTimeline = buildGoalTimeline(homeScore, awayScore, `${doc.id}-${data.homeSlot}-${data.awaySlot}`);
    await doc.ref.update({ status: 'in_progress' });
    await db.runTransaction(async (tx) => {
        const homeSnap = await tx.get(homeRef);
        const awaySnap = await tx.get(awayRef);
        const hs = homeSnap.exists
            ? homeSnap.data()
            : { slotIndex: data.homeSlot, teamId: data.homeTeamId || null, name: '', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
        const as = awaySnap.exists
            ? awaySnap.data()
            : { slotIndex: data.awaySlot, teamId: data.awayTeamId || null, name: '', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
        hs.P++;
        as.P++;
        hs.GF += homeScore;
        hs.GA += awayScore;
        hs.GD = hs.GF - hs.GA;
        as.GF += awayScore;
        as.GA += homeScore;
        as.GD = as.GF - as.GA;
        if (homeScore > awayScore) {
            hs.W++;
            as.L++;
            hs.Pts += 3;
        }
        else if (homeScore < awayScore) {
            as.W++;
            hs.L++;
            as.Pts += 3;
        }
        else {
            hs.D++;
            as.D++;
            hs.Pts++;
            as.Pts++;
        }
        tx.update(doc.ref, {
            status: 'played',
            score: { home: homeScore, away: awayScore },
            goalTimeline,
        });
        tx.set(homeRef, hs, { merge: true });
        tx.set(awayRef, as, { merge: true });
    });
}
function buildGoalTimeline(homeScore, awayScore, seed) {
    const totalGoals = homeScore + awayScore;
    if (totalGoals === 0)
        return [];
    const prng = createSeededRandom(seed);
    const minutes = new Set();
    while (minutes.size < totalGoals) {
        minutes.add(Math.floor(prng() * 89) + 1);
    }
    const sortedMinutes = [...minutes].sort((a, b) => a - b);
    const teams = [];
    teams.push(...Array(homeScore).fill('home'));
    teams.push(...Array(awayScore).fill('away'));
    shuffle(teams, prng);
    let homeGoals = 0;
    let awayGoals = 0;
    return sortedMinutes.map((minute, index) => {
        const team = teams[index] || 'home';
        if (team === 'home')
            homeGoals += 1;
        else
            awayGoals += 1;
        return {
            minute,
            team,
            type: 'goal',
            homeScore: homeGoals,
            awayScore: awayGoals,
            description: team === 'home' ? 'Ev golü' : 'Deplasman golü',
        };
    });
}
function createSeededRandom(seed) {
    let value = 0;
    for (let i = 0; i < seed.length; i += 1) {
        value = (value * 31 + seed.charCodeAt(i)) >>> 0;
    }
    if (value === 0)
        value = 1;
    return () => {
        value = (Math.imul(value, 48271) + 1) % 2147483647;
        return value / 2147483647;
    };
}
function shuffle(array, rand) {
    for (let i = array.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}
