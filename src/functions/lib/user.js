import * as functions from 'firebase-functions/v1';
import { assignTeam as assignTeamInternal } from './league.js';
import { getFirestore } from 'firebase-admin/firestore';
const db = getFirestore();
// When a user signs up, assign their team to the first available league.
export const assignTeamOnUserCreate = functions.auth.user().onCreate(async (user) => {
    const uid = user.uid;
    const teamName = user.displayName || `Team ${uid.slice(0, 6)}`;
    try {
        // Assign to a forming league (or open a new one). Idempotent across retries.
        await assignTeamInternal(uid, teamName);
    }
    catch (err) {
        console.error('Failed to auto-assign team to league on signup', { uid, err });
    }
});
