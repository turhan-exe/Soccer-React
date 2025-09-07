import * as functions from 'firebase-functions/v1';
import { assignTeam as assignTeamInternal } from './league.js';
import './_firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db =getFirestore();

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
      } else {
        const data = teamSnap.data() as any;
        if (!data?.name) {
          await teamRef.set({ name: teamNameBase }, { merge: true });
        } else {
          teamNameBase = data.name;
        }
      }
      await assignTeamInternal(uid, teamNameBase, uid);
    } catch (err) {
      console.error('Failed to auto-assign team to league on signup', { uid, err });
    }
  });

// Keep league mirrors (leagues/{leagueId}/teams/{teamId} and standings) in sync with team name
export const syncTeamName = functions
  .region('europe-west1')
  .firestore.document('teams/{teamId}')
  .onWrite(async (change, ctx) => {
    const teamId = ctx.params.teamId as string;
    if (!change.after.exists) return;
    const after = change.after.data() as any;
    const newName: string = after?.name || after?.clubName || `Team ${teamId.slice(0, 6)}`;

    // Find league memberships via collectionGroup('teams') where teamId == teamId
    const memberships = await db
      .collectionGroup('teams')
      .where('teamId', '==', teamId)
      .get();

    if (memberships.empty) return;

    let batch = db.batch();
    let ops = 0;
    for (const d of memberships.docs) {
      // Update mirrored team name under league
      batch.set(d.ref, { name: newName, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      const leagueRef = d.ref.parent.parent!;
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
