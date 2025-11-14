import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import { requireAppCheck, requireAuth } from './mw/auth.js';

const db = getFirestore();

export const getMatchTimeline = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
    requireAuth(context);
    requireAppCheck(context);
    const matchId = typeof data?.matchId === 'string' ? data.matchId.trim() : '';
    if (!matchId) {
      throw new functions.https.HttpsError('invalid-argument', 'matchId is required');
    }

    const fixtures = await db
      .collectionGroup('fixtures')
      .where(FieldPath.documentId(), '==', matchId)
      .limit(1)
      .get();
    if (fixtures.empty) {
      throw new functions.https.HttpsError('not-found', 'Fixture not found');
    }

    const fixture = fixtures.docs[0];
    const raw = fixture.data() as Record<string, any>;
    const timeline = Array.isArray(raw.goalTimeline) ? raw.goalTimeline : [];

    return {
      matchId,
      leagueId: fixture.ref.parent.parent?.id ?? null,
      homeTeamId: raw.homeTeamId ?? null,
      awayTeamId: raw.awayTeamId ?? null,
      score: raw.score ?? null,
      goalTimeline: timeline,
      date: raw.date?.toDate ? raw.date.toDate().toISOString() : null,
    };
  });
