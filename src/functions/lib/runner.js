import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { dayKeyTR, dayRangeTR } from './utils/schedule.js';
import { requireAppCheck, requireAuth } from './mw/auth.js';
const db = getFirestore();
const REGION = 'europe-west1';
const LEGACY_RUNNER_DISABLED = (process.env.LEGACY_RUNNER_DISABLED ?? functions.config()?.runner?.disabled ?? '1') !== '0';
async function acquireRunLock(dayKey, runner) {
    const ref = db.collection('ops_locks').doc(`runDaily_${dayKey}`);
    try {
        await ref.create({ runner, startedAt: FieldValue.serverTimestamp() });
        return true;
    }
    catch {
        return false;
    }
}
async function runScheduledMatchesForDay(dayKey) {
    const { start, end } = dayRangeTR(dayKey);
    const startTs = Timestamp.fromDate(start);
    const endTs = Timestamp.fromDate(end);
    const leaguesSnap = await db
        .collection('leagues')
        .where('state', 'in', ['scheduled', 'active'])
        .get();
    let totalScheduled = 0;
    for (const leagueDoc of leaguesSnap.docs) {
        const leagueRef = leagueDoc.ref;
        const fixturesSnap = await leagueRef
            .collection('fixtures')
            .where('date', '>=', startTs)
            .where('date', '<=', endTs)
            .get();
        const scheduledDocs = fixturesSnap.docs.filter((d) => d.data()?.status === 'scheduled');
        totalScheduled += scheduledDocs.length;
        for (const matchDoc of scheduledDocs) {
            const data = matchDoc.data();
            const hasSlots = Number.isFinite(data.homeSlot) || Number.isFinite(data.awaySlot);
            if (hasSlots) {
                await processSlotMatch(leagueRef, matchDoc);
            }
            else {
                await processMatch(leagueRef, matchDoc);
            }
        }
        if (scheduledDocs.length > 0 && leagueDoc.data().state === 'scheduled') {
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
    functions.logger.info('[RUN] daily matches processed', {
        dayKey,
        leagues: leaguesSnap.size,
        totalScheduled,
    });
}
export const runDailyMatches = functions
    .region(REGION)
    .pubsub.schedule('0 19 * * *')
    .timeZone('Europe/Istanbul')
    .onRun(async () => {
    if (LEGACY_RUNNER_DISABLED) {
        functions.logger.info('[RUN] runDailyMatches disabled (Unity batch mode)');
        return;
    }
    const dayKey = dayKeyTR();
    const locked = await acquireRunLock(dayKey, 'runDailyMatches');
    if (!locked) {
        functions.logger.info('[RUN] runDailyMatches skipped (lock exists)', { dayKey });
        return;
    }
    await runScheduledMatchesForDay(dayKey);
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
    .region(REGION)
    .pubsub.schedule('0 19 * * *')
    .timeZone('Europe/Istanbul')
    .onRun(async () => {
    if (LEGACY_RUNNER_DISABLED) {
        functions.logger.info('[RUN] runDailyMatchesAt19TR disabled (Unity batch mode)');
        return;
    }
    const dayKey = dayKeyTR();
    const locked = await acquireRunLock(dayKey, 'runDailyMatchesAt19TR');
    if (!locked) {
        functions.logger.info('[RUN] runDailyMatchesAt19TR skipped (lock exists)', { dayKey });
        return;
    }
    await runScheduledMatchesForDay(dayKey);
});
function resolveBackfillEnd(input) {
    if (input && typeof input.endDayKey === 'string') {
        const { end } = dayRangeTR(input.endDayKey);
        return { end, endDayKey: input.endDayKey };
    }
    if (input && Number.isFinite(input.endDateMs)) {
        const end = new Date(input.endDateMs);
        return { end, endDayKey: dayKeyTR(end) };
    }
    if (input && typeof input.endIso === 'string') {
        const end = new Date(input.endIso);
        if (!Number.isNaN(end.getTime())) {
            return { end, endDayKey: dayKeyTR(end) };
        }
    }
    const end = new Date();
    return { end, endDayKey: dayKeyTR(end) };
}
async function collectScheduledFixturesUpTo(end, limit) {
    try {
        const snap = await db
            .collectionGroup('fixtures')
            .where('status', '==', 'scheduled')
            .where('date', '<=', Timestamp.fromDate(end))
            .orderBy('date', 'asc')
            .limit(limit)
            .get();
        return { docs: snap.docs, usedFallback: false };
    }
    catch (e) {
        functions.logger.warn('[backfill] collectionGroup failed, fallback to per-league', {
            error: e?.message || String(e),
        });
    }
    const leagues = await db.collection('leagues').get();
    const all = [];
    for (const lg of leagues.docs) {
        const snap = await lg.ref.collection('fixtures').where('status', '==', 'scheduled').get();
        for (const doc of snap.docs) {
            const at = doc.data()?.date?.toDate?.();
            if (at && at <= end) {
                all.push({ doc, at });
            }
        }
    }
    all.sort((a, b) => a.at.getTime() - b.at.getTime());
    return { docs: all.slice(0, limit).map((d) => d.doc), usedFallback: true };
}
async function backfillScheduledMatchesInternal(end, maxMatches, dryRun) {
    const { docs, usedFallback } = await collectScheduledFixturesUpTo(end, maxMatches);
    if (dryRun) {
        return {
            processed: 0,
            total: docs.length,
            usedFallback,
            hasMore: docs.length >= maxMatches,
        };
    }
    let processed = 0;
    const touched = new Map();
    for (const matchDoc of docs) {
        const data = matchDoc.data();
        if (!data || data.status !== 'scheduled') {
            continue;
        }
        const leagueRef = matchDoc.ref.parent.parent;
        if (!leagueRef) {
            continue;
        }
        touched.set(leagueRef.id, leagueRef);
        const hasSlots = Number.isFinite(data.homeSlot) || Number.isFinite(data.awaySlot);
        try {
            if (hasSlots) {
                await processSlotMatch(leagueRef, matchDoc);
            }
            else {
                await processMatch(leagueRef, matchDoc);
            }
            processed++;
        }
        catch (e) {
            functions.logger.error('[backfill] match failed', {
                matchId: matchDoc.id,
                leagueId: leagueRef.id,
                error: e?.message || String(e),
            });
        }
    }
    for (const leagueRef of touched.values()) {
        try {
            const leagueSnap = await leagueRef.get();
            if (leagueSnap.exists && leagueSnap.data()?.state === 'scheduled') {
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
        catch (e) {
            functions.logger.warn('[backfill] league update failed', {
                leagueId: leagueRef.id,
                error: e?.message || String(e),
            });
        }
    }
    functions.logger.info('[backfill] done', {
        processed,
        total: docs.length,
        usedFallback,
    });
    return {
        processed,
        total: docs.length,
        usedFallback,
        hasMore: docs.length >= maxMatches,
    };
}
export const backfillScheduledMatches = functions
    .region(REGION)
    .https.onCall(async (request) => {
    const cfg = functions.config() || {};
    const APP_CHECK_OPTIONAL = (process.env.APP_CHECK_OPTIONAL ?? cfg?.app?.check_optional ?? '1') !== '0';
    const ALLOW_ANY_OPERATOR = (process.env.ALLOW_ANY_OPERATOR ?? cfg?.auth?.allow_operator_any ?? '0') === '1';
    if (!APP_CHECK_OPTIONAL) {
        requireAppCheck(request);
    }
    requireAuth(request);
    const claims = request.auth?.token || {};
    const isOperator = !!(claims.admin || claims.operator);
    if (!isOperator && !ALLOW_ANY_OPERATOR) {
        throw new functions.https.HttpsError('permission-denied', 'Operator permission required');
    }
    const data = request.data || {};
    const { end, endDayKey } = resolveBackfillEnd(data);
    const maxMatchesRaw = Number(data.maxMatches ?? 200);
    const maxMatches = Math.max(1, Math.min(500, Number.isFinite(maxMatchesRaw) ? maxMatchesRaw : 200));
    const dryRun = !!data.dryRun;
    const result = await backfillScheduledMatchesInternal(end, maxMatches, dryRun);
    return { ok: true, endDayKey, maxMatches, dryRun, ...result };
});
export const backfillScheduledMatchesHttp = functions
    .region(REGION)
    .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-admin-secret');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const cfg = functions.config() || {};
    const ALLOW_ANY_OPERATOR = (process.env.ALLOW_ANY_OPERATOR ?? cfg?.auth?.allow_operator_any ?? '0') === '1';
    const adminSecret = process.env.ADMIN_SECRET ?? cfg?.admin?.secret;
    const providedSecret = req.header('x-admin-secret');
    let claims = null;
    if (adminSecret && providedSecret && providedSecret === adminSecret) {
        claims = { admin: true, operator: true };
    }
    else {
        const authz = req.headers.authorization || '';
        const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
        if (!token) {
            res.status(401).json({ error: 'Auth required' });
            return;
        }
        try {
            const { getAuth } = await import('firebase-admin/auth');
            claims = await getAuth().verifyIdToken(token);
        }
        catch {
            res.status(401).json({ error: 'Invalid token' });
            return;
        }
    }
    const isOperator = !!(claims && (claims.admin || claims.operator));
    if (!isOperator && !ALLOW_ANY_OPERATOR) {
        res.status(403).json({ error: 'Operator permission required' });
        return;
    }
    let body = {};
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    }
    catch {
        body = {};
    }
    const { end, endDayKey } = resolveBackfillEnd(body);
    const maxMatchesRaw = Number(body.maxMatches ?? 200);
    const maxMatches = Math.max(1, Math.min(500, Number.isFinite(maxMatchesRaw) ? maxMatchesRaw : 200));
    const dryRun = !!body.dryRun;
    try {
        const result = await backfillScheduledMatchesInternal(end, maxMatches, dryRun);
        res.json({ ok: true, endDayKey, maxMatches, dryRun, ...result });
    }
    catch (e) {
        functions.logger.error('[backfillScheduledMatchesHttp] failed', { error: e?.message || String(e) });
        res.status(500).json({ error: e?.message || 'error' });
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
