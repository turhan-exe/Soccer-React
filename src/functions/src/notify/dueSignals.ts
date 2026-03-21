import * as functions from 'firebase-functions/v1';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { sendPushToUser } from './push.js';

const db = getFirestore();
const REGION = 'europe-west1';
const TZ = 'Europe/Istanbul';

const toMillis = (value: any) =>
  value && typeof value.toMillis === 'function' ? value.toMillis() : 0;

export const notifyDueSignals = functions
  .region(REGION)
  .pubsub.schedule('* * * * *')
  .timeZone(TZ)
  .onRun(async () => {
    const now = Timestamp.now();
    const [youthSnap, academySnap] = await Promise.all([
      db.collection('users').where('youth.nextGenerateAt', '<=', now).get(),
      db.collection('users').where('academy.nextPullAt', '<=', now).get(),
    ]);

    let youthSent = 0;
    let academySent = 0;

    for (const doc of youthSnap.docs) {
      const uid = doc.id;
      const data = doc.data() as any;
      const nextGenerateAtMs = toMillis(data?.youth?.nextGenerateAt);
      if (!nextGenerateAtMs) continue;
      const result = await sendPushToUser(
        uid,
        {
          type: 'youth-ready',
          title: 'Altyapi hazir',
          body: 'Yeni altyapi oyuncusu uretebilirsin.',
          path: '/youth',
          data: { nextGenerateAtMs },
        },
        `youth-ready:${uid}:${nextGenerateAtMs}`,
      );
      if (result.status === 'sent') youthSent += 1;
    }

    for (const doc of academySnap.docs) {
      const uid = doc.id;
      const data = doc.data() as any;
      const nextPullAtMs = toMillis(data?.academy?.nextPullAt);
      if (!nextPullAtMs) continue;
      const result = await sendPushToUser(
        uid,
        {
          type: 'academy-ready',
          title: 'Akademi hazir',
          body: 'Akademiden yeni aday cekebilirsin.',
          path: '/academy',
          data: { nextPullAtMs },
        },
        `academy-ready:${uid}:${nextPullAtMs}`,
      );
      if (result.status === 'sent') academySent += 1;
    }

    return { ok: true, youthSent, academySent };
  });
