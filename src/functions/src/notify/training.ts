import * as functions from 'firebase-functions/v1';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { resolveTrainingDefinitions, runTrainingSimulation } from './trainingRuntime.js';
import { sendPushToUser } from './push.js';

const db = getFirestore();
const REGION = 'europe-west1';
const TZ = 'Europe/Istanbul';
const FINALIZE_LOCK_WINDOW_MS = 2 * 60 * 1000;

const resolveEndsAtMs = (data: any) => {
  if (data?.endsAt && typeof data.endsAt.toMillis === 'function') {
    return data.endsAt.toMillis();
  }
  if (data?.startAt && typeof data.startAt.toMillis === 'function' && Number.isFinite(data?.durationSeconds)) {
    return data.startAt.toMillis() + Number(data.durationSeconds) * 1000;
  }
  return 0;
};

async function claimTrainingForFinalize(
  ref: FirebaseFirestore.DocumentReference,
  nowMs: number,
) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return null;
    }
    const data = snap.data() as any;
    const endsAtMs = resolveEndsAtMs(data);
    if (!endsAtMs || endsAtMs > nowMs) {
      return null;
    }

    const lockedAtMs =
      data?.serverFinalizingAt && typeof data.serverFinalizingAt.toMillis === 'function'
        ? data.serverFinalizingAt.toMillis()
        : 0;
    if (lockedAtMs && nowMs - lockedAtMs < FINALIZE_LOCK_WINDOW_MS) {
      return null;
    }

    tx.set(
      ref,
      {
        endsAt: data?.endsAt || Timestamp.fromMillis(endsAtMs),
        serverFinalizingAt: Timestamp.fromMillis(nowMs),
      },
      { merge: true },
    );

    return {
      ...data,
      endsAtMs,
    };
  });
}

export const finalizeDueTrainingSessions = functions
  .region(REGION)
  .pubsub.schedule('* * * * *')
  .timeZone(TZ)
  .onRun(async () => {
    const now = Date.now();
    const activeSessions = await db
      .collectionGroup('training')
      .where('endsAt', '<=', Timestamp.fromMillis(now))
      .get();

    let finalized = 0;
    let skipped = 0;
    let failed = 0;

    for (const sessionDoc of activeSessions.docs) {
      const uid = sessionDoc.ref.parent.parent?.id;
      if (!uid) {
        skipped += 1;
        continue;
      }

      try {
        const claimed = await claimTrainingForFinalize(sessionDoc.ref, now);
        if (!claimed) {
          skipped += 1;
          continue;
        }

        const playerIds = Array.isArray(claimed.playerIds) ? claimed.playerIds.map(String) : [];
        const trainingIds = Array.isArray(claimed.trainingIds) ? claimed.trainingIds.map(String) : [];
        const trainingDefs = resolveTrainingDefinitions(trainingIds);
        const teamRef = db.doc(`teams/${uid}`);
        const teamSnap = await teamRef.get();

        if (!teamSnap.exists || playerIds.length === 0 || trainingDefs.length === 0) {
          await sessionDoc.ref.delete().catch(() => undefined);
          skipped += 1;
          continue;
        }

        const teamData = teamSnap.data() as any;
        const teamPlayers = Array.isArray(teamData?.players) ? teamData.players : [];
        const sessionPlayers = playerIds
          .map((playerId: string) =>
            teamPlayers.find((player: any) => String(player?.id) === playerId),
          )
          .filter(Boolean);

        if (sessionPlayers.length === 0) {
          await sessionDoc.ref.delete().catch(() => undefined);
          skipped += 1;
          continue;
        }

        const { updatedPlayers, records } = runTrainingSimulation(sessionPlayers, trainingDefs);
        const completedAt = Timestamp.fromMillis(now);
        const completionIso = completedAt.toDate().toISOString();
        const trainedPlayerIds = new Set(
          sessionPlayers.map((player: any) => String(player?.id)),
        );
        const mergedPlayers = teamPlayers.map((player: any) => {
          const updated = updatedPlayers.find((candidate) => String(candidate.id) === String(player?.id));
          const nextPlayer = updated ?? player;
          return trainedPlayerIds.has(String(player?.id))
            ? {
                ...nextPlayer,
                lastTrainedAt: completionIso,
              }
            : nextPlayer;
        });

        const batch = db.batch();
        batch.set(teamRef, { players: mergedPlayers }, { merge: true });

        for (const record of records) {
          const historyRef = db.collection('users').doc(uid).collection('trainingHistory').doc();
          batch.set(historyRef, {
            ...record,
            completedAt,
            viewed: false,
          });
        }

        batch.delete(sessionDoc.ref);
        await batch.commit();

        await sendPushToUser(
          uid,
          {
            type: 'training-complete',
            title: 'Antrenman tamamlandi',
            body: 'Sonuclar hazir. Antrenman merkezi tekrar musait.',
            path: '/training',
            data: {
              endsAtMs: claimed.endsAtMs,
              recordsCount: records.length,
            },
          },
          `training-complete:${uid}:${claimed.endsAtMs}`,
        );

        finalized += 1;
      } catch (error: any) {
        failed += 1;
        functions.logger.error('[notify.finalizeDueTrainingSessions] failed', {
          path: sessionDoc.ref.path,
          error: error?.message || String(error),
        });
      }
    }

    return { ok: true, finalized, skipped, failed };
  });
