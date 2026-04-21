import * as functions from 'firebase-functions/v1';
import {
  FieldPath,
  FieldValue,
  getFirestore,
} from 'firebase-admin/firestore';
import {
  applyScheduledConditionRecovery,
  parseConditionRecoveryIsoMs,
  resolveConditionRecoveryDueAt,
  type ConditionRecoveryPendingToast,
} from '../utils/teamConditionRecovery.js';

const db = getFirestore();
const REGION = 'europe-west1';
const TZ = 'Europe/Istanbul';
const MAX_DUE_TEAMS_PER_RUN = 200;
const MAX_MIGRATION_TEAMS_PER_RUN = 100;
const CRON_STATE_PATH = 'system/conditionRecoveryCron';

type TeamConditionRecoveryDoc = {
  players?: Record<string, unknown>[];
  conditionRecoveryDueAt?: string | null;
  conditionRecoveryPendingToast?: ConditionRecoveryPendingToast | null;
  conditionRecoveryAt?: string | null;
};

type ProcessTeamConditionRecoveryResult =
  | {
      status: 'missing' | 'skipped_not_due' | 'seeded_only';
      source: 'due' | 'legacy' | 'seeded';
    }
  | {
      status: 'applied';
      source: 'due' | 'legacy' | 'seeded';
      conditionGain: number;
      motivationGain: number;
      healthGain: number;
      totalPlayers: number;
      affectedPlayers: number;
      appliedTicks: number;
    };

const teamCollection = db.collection('teams');
const cronStateRef = db.doc(CRON_STATE_PATH);

const hasValidDueAt = (value: unknown): boolean =>
  parseConditionRecoveryIsoMs(value) !== null;

const processTeamConditionRecovery = async (
  teamRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  nowMs: number,
): Promise<ProcessTeamConditionRecoveryResult> =>
  db.runTransaction(async (tx) => {
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists) {
      return { status: 'missing', source: 'seeded' };
    }

    const teamData = (teamSnap.data() as TeamConditionRecoveryDoc | undefined) ?? undefined;
    const dueResolution = resolveConditionRecoveryDueAt({
      dueAt: teamData?.conditionRecoveryDueAt,
      legacyRecoveryAt: teamData?.conditionRecoveryAt,
      nowMs,
    });
    const recovery = applyScheduledConditionRecovery({
      players: Array.isArray(teamData?.players) ? teamData.players : [],
      dueAt: dueResolution.dueAt,
      nowMs,
      pendingToast: teamData?.conditionRecoveryPendingToast ?? null,
    });

    const payload: FirebaseFirestore.DocumentData = {};
    let shouldWrite = false;

    if (
      dueResolution.source !== 'due' ||
      recovery.appliedTicks > 0 ||
      recovery.changed
    ) {
      payload.conditionRecoveryDueAt = recovery.nextDueAt;
      shouldWrite = true;
    }

    if (recovery.changed) {
      payload.players = recovery.players;
      shouldWrite = true;
    }

    if (recovery.pendingToast !== teamData?.conditionRecoveryPendingToast) {
      payload.conditionRecoveryPendingToast = recovery.pendingToast;
      shouldWrite = true;
    }

    if (dueResolution.source !== 'due' || teamData?.conditionRecoveryAt != null) {
      payload.conditionRecoveryAt = FieldValue.delete();
      shouldWrite = true;
    }

    if (!shouldWrite) {
      return {
        status: 'skipped_not_due',
        source: dueResolution.source,
      };
    }

    tx.set(teamRef, payload, { merge: true });

    if (recovery.appliedTicks <= 0) {
      return {
        status: 'seeded_only',
        source: dueResolution.source,
      };
    }

    return {
      status: 'applied',
      source: dueResolution.source,
      conditionGain: recovery.conditionGain,
      motivationGain: recovery.motivationGain,
      healthGain: recovery.healthGain,
      totalPlayers: recovery.totalPlayers,
      affectedPlayers: recovery.affectedPlayers,
      appliedTicks: recovery.appliedTicks,
    };
  });

const runMigrationSweep = async (nowMs: number) => {
  const cronStateSnap = await cronStateRef.get();
  const cursor =
    typeof cronStateSnap.get('migrationCursor') === 'string'
      ? String(cronStateSnap.get('migrationCursor'))
      : null;

  let query = teamCollection
    .orderBy(FieldPath.documentId())
    .limit(MAX_MIGRATION_TEAMS_PER_RUN);
  if (cursor) {
    query = query.startAfter(cursor);
  }

  const migrationSnap = await query.get();
  let seeded = 0;
  let migrated = 0;
  let failed = 0;

  for (const teamDoc of migrationSnap.docs) {
    const teamData = (teamDoc.data() as TeamConditionRecoveryDoc | undefined) ?? undefined;
    if (hasValidDueAt(teamData?.conditionRecoveryDueAt)) {
      continue;
    }

    try {
      const result = await processTeamConditionRecovery(teamDoc.ref, nowMs);
      if (result.source === 'legacy') {
        migrated += 1;
      } else if (result.source === 'seeded') {
        seeded += 1;
      }
    } catch (error) {
      failed += 1;
      functions.logger.error('[conditionRecovery] migration failed', {
        teamId: teamDoc.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const nextCursor =
    migrationSnap.size === MAX_MIGRATION_TEAMS_PER_RUN
      ? migrationSnap.docs[migrationSnap.docs.length - 1]?.id ?? null
      : null;

  await cronStateRef.set(
    {
      migrationCursor: nextCursor,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    scanned: migrationSnap.size,
    seeded,
    migrated,
    failed,
    cursorReset: nextCursor == null,
  };
};

export const recoverTeamConditionCron = functions
  .region(REGION)
  .pubsub.schedule('every 15 minutes')
  .timeZone(TZ)
  .onRun(async () => {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const dueSnap = await teamCollection
      .where('conditionRecoveryDueAt', '<=', nowIso)
      .orderBy('conditionRecoveryDueAt')
      .limit(MAX_DUE_TEAMS_PER_RUN)
      .get();

    let appliedTeams = 0;
    let appliedTicks = 0;
    let conditionGain = 0;
    let motivationGain = 0;
    let healthGain = 0;
    let affectedPlayers = 0;
    let failed = 0;

    for (const teamDoc of dueSnap.docs) {
      try {
        const result = await processTeamConditionRecovery(teamDoc.ref, nowMs);
        if (result.status !== 'applied') {
          continue;
        }

        appliedTeams += 1;
        appliedTicks += result.appliedTicks;
        conditionGain = Number((conditionGain + result.conditionGain).toFixed(3));
        motivationGain = Number((motivationGain + result.motivationGain).toFixed(3));
        healthGain = Number((healthGain + result.healthGain).toFixed(3));
        affectedPlayers += result.affectedPlayers;
      } catch (error) {
        failed += 1;
        functions.logger.error('[conditionRecovery] due processing failed', {
          teamId: teamDoc.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const migration = await runMigrationSweep(nowMs);

    functions.logger.info('[conditionRecovery] cron complete', {
      dueScanned: dueSnap.size,
      appliedTeams,
      appliedTicks,
      conditionGain,
      motivationGain,
      healthGain,
      affectedPlayers,
      failed,
      migration,
    });

    return null;
  });
