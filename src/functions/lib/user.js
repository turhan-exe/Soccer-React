import * as functions from 'firebase-functions/v1';
import { assignIntoRandomBotSlot } from './assign.js';
import './_firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureBotTeamDoc } from './utils/bots.js';
const db = getFirestore();
// When a user signs up, assign their team to the first available league.
export const assignTeamOnUserCreate = functions
    .region('europe-west1')
    .auth.user()
    .onCreate(async (user) => {
    const uid = user.uid;
    try {
        // Ensure a team doc exists with a stable name; prefer displayName, then email local-part
        const teamRef = db.collection('teams').doc(uid);
        const teamSnap = await teamRef.get();
        let teamNameBase = user.displayName || (user.email ? user.email.split('@')[0] : '') || `Team ${uid.slice(0, 6)}`;
        if (!teamSnap.exists) {
            await teamRef.set({
                ownerUid: uid,
                name: teamNameBase,
                createdAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        else {
            const data = teamSnap.data();
            if (!data?.name) {
                await teamRef.set({ name: teamNameBase }, { merge: true });
            }
            else {
                teamNameBase = data.name;
            }
        }
        await assignIntoRandomBotSlot(uid, teamNameBase);
    }
    catch (err) {
        console.error('Failed to auto-assign team to league on signup', { uid, err });
    }
});
// Keep league mirrors (leagues/{leagueId}/teams/{teamId} and standings) in sync with team name
export const syncTeamName = functions
    .region('europe-west1')
    .firestore.document('teams/{teamId}')
    .onWrite(async (change, ctx) => {
    const teamId = ctx.params.teamId;
    if (!change.after.exists)
        return;
    const after = change.after.data();
    const newName = after?.name || after?.clubName || `Team ${teamId.slice(0, 6)}`;
    // Find league memberships via collectionGroup('teams') where teamId == teamId
    const memberships = await db
        .collectionGroup('teams')
        .where('teamId', '==', teamId)
        .get();
    if (memberships.empty)
        return;
    let batch = db.batch();
    let ops = 0;
    for (const d of memberships.docs) {
        // Update mirrored team name under league
        batch.set(d.ref, { name: newName, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        const leagueRef = d.ref.parent.parent;
        // Update standings name as well
        const standingRef = leagueRef.collection('standings').doc(teamId);
        batch.set(standingRef, { name: newName, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        ops++;
        if (ops >= 450) {
            await batch.commit();
            batch = db.batch();
            ops = 0;
        }
    }
    if (ops > 0) {
        await batch.commit();
    }
});
const INACTIVITY_MONTHS = 6;
const MAX_DELETES_PER_RUN = 25;
const BATCH_WRITE_LIMIT = 450;
const PROTECTED_CUSTOM_CLAIMS = ['admin', 'staff', 'moderator', 'superadmin', 'superAdmin'];
const authAdmin = getAuth();
const parseTimestamp = (value) => {
    if (!value)
        return null;
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
};
const shouldSkipCleanup = (user) => {
    const claims = user.customClaims;
    if (!claims) {
        return false;
    }
    for (const key of PROTECTED_CUSTOM_CLAIMS) {
        if (claims[key]) {
            return true;
        }
    }
    if (claims['skipCleanup']) {
        return true;
    }
    return false;
};
const cleanupTransferListings = async (uid) => {
    const listingsRef = db.collection('transferListings');
    const [sellerSnap, teamSnap] = await Promise.all([
        listingsRef.where('sellerUid', '==', uid).get(),
        listingsRef.where('teamId', '==', uid).get(),
    ]);
    const refs = new Map();
    for (const doc of sellerSnap.docs)
        refs.set(doc.id, doc.ref);
    for (const doc of teamSnap.docs)
        refs.set(doc.id, doc.ref);
    if (refs.size === 0)
        return 0;
    let batch = db.batch();
    let ops = 0;
    for (const ref of refs.values()) {
        batch.delete(ref);
        ops++;
        if (ops >= BATCH_WRITE_LIMIT) {
            await batch.commit();
            batch = db.batch();
            ops = 0;
        }
    }
    if (ops > 0) {
        await batch.commit();
    }
    return refs.size;
};
const clearFixturesForTeam = async (leagueId, teamId) => {
    const leagueRef = db.collection('leagues').doc(leagueId);
    const fixturesRef = leagueRef.collection('fixtures');
    const slotsSnap = await leagueRef.collection('slots').get();
    const botTeamBySlot = new Map();
    for (const slot of slotsSnap.docs) {
        const data = slot.data();
        const rawIndex = data['slotIndex'];
        const slotIndex = typeof rawIndex === 'number' ? rawIndex : Number(slot.id) || 0;
        if (!slotIndex)
            continue;
        const slotTeamId = typeof data['teamId'] === 'string' ? data['teamId'] : null;
        const slotBotId = typeof data['botId'] === 'string' ? data['botId'] : null;
        if (!slotTeamId && slotBotId) {
            const botTeamId = await ensureBotTeamDoc({ botId: slotBotId, slotIndex });
            botTeamBySlot.set(slotIndex, botTeamId || null);
        }
        else {
            botTeamBySlot.set(slotIndex, null);
        }
    }
    const [homeSnap, awaySnap] = await Promise.all([
        fixturesRef.where('homeTeamId', '==', teamId).get(),
        fixturesRef.where('awayTeamId', '==', teamId).get(),
    ]);
    let batch = db.batch();
    let ops = 0;
    let updated = 0;
    const apply = async (snap, field) => {
        for (const doc of snap.docs) {
            const data = doc.data();
            let home = data['homeTeamId'] ?? null;
            let away = data['awayTeamId'] ?? null;
            if (field === 'homeTeamId') {
                const slotIndex = Number(data['homeSlot'] ?? 0);
                home = botTeamBySlot.get(slotIndex) ?? null;
            }
            else {
                const slotIndex = Number(data['awaySlot'] ?? 0);
                away = botTeamBySlot.get(slotIndex) ?? null;
            }
            batch.update(doc.ref, {
                [field]: null,
                participants: [home, away].filter(Boolean),
            });
            ops++;
            updated++;
            if (ops >= BATCH_WRITE_LIMIT) {
                await batch.commit();
                batch = db.batch();
                ops = 0;
            }
        }
    };
    await apply(homeSnap, 'homeTeamId');
    await apply(awaySnap, 'awayTeamId');
    if (ops > 0) {
        await batch.commit();
    }
    return updated;
};
const cleanupLeagueMirrors = async (teamId, preferredLeagueId) => {
    const memberships = await db
        .collectionGroup('teams')
        .where('teamId', '==', teamId)
        .get();
    const leagueIds = new Set();
    let removed = 0;
    if (!memberships.empty) {
        let batch = db.batch();
        let ops = 0;
        for (const doc of memberships.docs) {
            batch.delete(doc.ref);
            ops++;
            removed++;
            const parent = doc.ref.parent.parent;
            if (parent) {
                leagueIds.add(parent.id);
            }
            if (ops >= BATCH_WRITE_LIMIT) {
                await batch.commit();
                batch = db.batch();
                ops = 0;
            }
        }
        if (ops > 0) {
            await batch.commit();
        }
    }
    if (preferredLeagueId) {
        leagueIds.add(preferredLeagueId);
    }
    for (const leagueId of leagueIds) {
        const standingsSnap = await db
            .collection('leagues')
            .doc(leagueId)
            .collection('standings')
            .where('teamId', '==', teamId)
            .get();
        if (standingsSnap.empty) {
            continue;
        }
        let batch = db.batch();
        let ops = 0;
        for (const st of standingsSnap.docs) {
            batch.set(st.ref, { teamId: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
            ops++;
            if (ops >= BATCH_WRITE_LIMIT) {
                await batch.commit();
                batch = db.batch();
                ops = 0;
            }
        }
        if (ops > 0) {
            await batch.commit();
        }
    }
    return removed;
};
const cleanupUserData = async (uid) => {
    const result = await db.runTransaction(async (tx) => {
        const teamRef = db.collection('teams').doc(uid);
        const teamSnap = await tx.get(teamRef);
        if (!teamSnap.exists) {
            return { hadTeam: false };
        }
        const teamData = teamSnap.data();
        const leagueId = teamData['leagueId'] ?? null;
        tx.delete(teamRef);
        if (!leagueId) {
            return { hadTeam: true };
        }
        const leagueRef = db.collection('leagues').doc(leagueId);
        const leagueSnap = await tx.get(leagueRef);
        let slotIndex = null;
        const slotQuery = leagueRef
            .collection('slots')
            .where('teamId', '==', uid)
            .limit(1);
        const slotSnap = await tx.get(slotQuery);
        if (!slotSnap.empty) {
            const slotDoc = slotSnap.docs[0];
            const slotData = slotDoc.data();
            const rawIndex = slotData['slotIndex'];
            slotIndex = typeof rawIndex === 'number' ? rawIndex : Number(slotDoc.id) || null;
            const rawBotId = slotData['botId'];
            const fallbackBotId = typeof rawBotId === 'string' && rawBotId.trim()
                ? rawBotId
                : `cleanup-bot-${slotDoc.id}`;
            tx.update(slotDoc.ref, {
                type: 'bot',
                teamId: null,
                botId: fallbackBotId,
                lockedAt: FieldValue.serverTimestamp(),
            });
        }
        const standingsQuery = leagueRef
            .collection('standings')
            .where('teamId', '==', uid);
        const standingsSnap = await tx.get(standingsQuery);
        const fallbackName = slotIndex != null ? `Bot ${slotIndex}` : 'Bos Slot';
        for (const st of standingsSnap.docs) {
            const current = st.data();
            const name = current['name'] || fallbackName;
            tx.set(st.ref, {
                teamId: null,
                name,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        tx.delete(leagueRef.collection('standings').doc(uid));
        const leagueTeamsQuery = leagueRef
            .collection('teams')
            .where('teamId', '==', uid);
        const leagueTeamsSnap = await tx.get(leagueTeamsQuery);
        for (const lt of leagueTeamsSnap.docs) {
            tx.delete(lt.ref);
        }
        tx.delete(leagueRef.collection('teams').doc(uid));
        if (leagueSnap.exists) {
            const leagueData = leagueSnap.data();
            const rawTeams = Array.isArray(leagueData['teams'])
                ? leagueData['teams']
                : [];
            const filteredTeams = rawTeams.filter(entry => entry?.id !== uid);
            const sanitizedTeams = filteredTeams
                .map(entry => ({
                id: entry?.id,
                name: entry?.name,
            }))
                .filter(entry => typeof entry.id === 'string');
            tx.set(leagueRef, {
                teams: sanitizedTeams,
                teamCount: sanitizedTeams.length,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        return { hadTeam: true, leagueId, slotIndex };
    });
    if (result.leagueId) {
        await clearFixturesForTeam(result.leagueId, uid);
    }
    await cleanupTransferListings(uid);
    await cleanupLeagueMirrors(uid, result.leagueId ?? null);
    return result;
};
export const cleanupInactiveUsers = functions
    .region('europe-west1')
    .pubsub.schedule('0 4 * * *')
    .timeZone('Europe/Istanbul')
    .onRun(async () => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - INACTIVITY_MONTHS);
    const cutoffMs = cutoff.getTime();
    let nextPageToken;
    const inactive = [];
    do {
        const page = await authAdmin.listUsers(1000, nextPageToken);
        for (const user of page.users) {
            if (shouldSkipCleanup(user)) {
                continue;
            }
            const activityMs = parseTimestamp(user.metadata.lastSignInTime) ??
                parseTimestamp(user.metadata.creationTime);
            if (activityMs == null) {
                continue;
            }
            if (activityMs < cutoffMs) {
                inactive.push(user);
                if (inactive.length >= MAX_DELETES_PER_RUN * 2) {
                    break;
                }
            }
        }
        nextPageToken = page.pageToken;
        if (inactive.length >= MAX_DELETES_PER_RUN * 2) {
            break;
        }
    } while (nextPageToken);
    if (inactive.length === 0) {
        functions.logger.info('[CLEANUP] Inaktif kullanici bulunamadi', {
            cutoff: cutoff.toISOString(),
        });
        return null;
    }
    const toProcess = inactive.slice(0, MAX_DELETES_PER_RUN);
    let deleted = 0;
    let errors = 0;
    for (const user of toProcess) {
        try {
            const result = await cleanupUserData(user.uid);
            await authAdmin.deleteUser(user.uid);
            deleted++;
            functions.logger.info('[CLEANUP] Inaktif kullanici silindi', {
                uid: user.uid,
                leagueId: result.leagueId ?? null,
                slotIndex: result.slotIndex ?? null,
                hadTeam: result.hadTeam,
            });
        }
        catch (error) {
            errors++;
            functions.logger.error('[CLEANUP] Inaktif kullanici silinemedi', {
                uid: user.uid,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    functions.logger.info('[CLEANUP] Temizlik tamamlandi', {
        scanned: inactive.length,
        processed: toProcess.length,
        deleted,
        errors,
        cutoff: cutoff.toISOString(),
    });
    return null;
});
