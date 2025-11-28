import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const REGION = 'europe-west1';
const db = getFirestore();

export const scheduleDailyMatches = functions
  .region(REGION)
  .pubsub.schedule('55 18 * * *')
  .timeZone('Europe/Istanbul')
  .onRun(async () => {
    const now = new Date();
    const windowStart = new Date(now.getTime());
    const windowEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const startTs = Timestamp.fromDate(windowStart);
    const endTs = Timestamp.fromDate(windowEnd);

    const snap = await db
      .collectionGroup('matches')
      .where('kickoffAt', '>=', startTs)
      .where('kickoffAt', '<', endTs)
      .get();

    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.set(
        doc.ref,
        {
          status: 'scheduled',
        },
        { merge: true }
      );
    });
    if (snap.size > 0) {
      await batch.commit();
    }
    functions.logger.info('[scheduleDailyMatches] scheduled matches', { count: snap.size });
    return null;
  });
