import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';
import { markHeartbeat } from '../monitor/heartbeat.js';
import { repairIncompleteSquad } from '../utils/squadRepair.js';

const db = getFirestore();
const REGION = 'europe-west1';
const TZ = 'Europe/Istanbul';
const ADMIN_SECRETS = Array.from(
  new Set(
    [
      process.env.ADMIN_SECRET || '',
      (functions.config() as any)?.admin?.secret || '',
      (functions.config() as any)?.scheduler?.secret || '',
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ),
);

const SQUAD_REPAIR_PAGE_SIZE = 200;
const SQUAD_REPAIR_HTTP_SAMPLE_LIMIT = 50;
const SQUAD_REPAIR_CRON = '0 9 * * *';

type RepairIncompleteSquadsOptions = {
  dryRun?: boolean;
  limit?: number | null;
  markOps?: boolean;
  now?: Date;
  teamId?: string | null;
};

type RepairTeamRunResult = {
  teamId: string;
  status: 'healthy' | 'repaired' | 'skipped_insufficient_roster' | 'missing';
  reasons: string[];
  sourceKind?: string;
};

type RepairIncompleteSquadsResult = {
  dryRun: boolean;
  failed: number;
  candidates: number;
  repaired: number;
  scanned: number;
  skippedAlreadyHealthy: number;
  skippedInsufficientRoster: number;
  targetTeamId: string | null;
  items: RepairTeamRunResult[];
};

function applyCors(req: functions.https.Request, res: functions.Response<any>) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

function requireAdminSecret(req: functions.https.Request, res: functions.Response<any>) {
  const headerToken = String(req.headers.authorization || '').startsWith('Bearer ')
    ? String(req.headers.authorization || '').slice(7).trim()
    : '';
  const queryToken = String(req.query?.secret || '').trim();
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const bodyToken = typeof (body as { secret?: unknown }).secret === 'string'
    ? String((body as { secret?: unknown }).secret).trim()
    : '';
  const provided = headerToken || queryToken || bodyToken;
  if (ADMIN_SECRETS.length === 0 || !provided || !ADMIN_SECRETS.includes(provided)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}

function readRequestBody(req: functions.https.Request) {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
  return {};
}

function parseBoolean(raw: unknown, fallback = false) {
  if (raw == null || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
}

function parseLimit(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'limit must be a positive number');
  }
  return Math.floor(parsed);
}

async function processTeamRepair(
  teamRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  now: Date,
  dryRun: boolean,
): Promise<RepairTeamRunResult> {
  if (dryRun) {
    const snap = await teamRef.get();
    if (!snap.exists) {
      return { teamId: teamRef.id, status: 'missing', reasons: [] };
    }
    const result = repairIncompleteSquad(snap.data() as any, { now });
    return {
      teamId: teamRef.id,
      status: result.status,
      reasons: result.reasons,
      sourceKind: result.status === 'repaired' ? result.sourceKind : undefined,
    };
  }

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists) {
      return { teamId: teamRef.id, status: 'missing', reasons: [] } satisfies RepairTeamRunResult;
    }

    const result = repairIncompleteSquad(snap.data() as any, { now });
    if (result.status === 'repaired') {
      tx.set(
        teamRef,
        {
          players: result.payload.players,
          lineup: result.payload.lineup,
          plan: result.payload.plan,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    return {
      teamId: teamRef.id,
      status: result.status,
      reasons: result.reasons,
      sourceKind: result.status === 'repaired' ? result.sourceKind : undefined,
    } satisfies RepairTeamRunResult;
  });
}

function createEmptyRepairSummary(input: {
  dryRun: boolean;
  teamId: string | null;
}): RepairIncompleteSquadsResult {
  return {
    dryRun: input.dryRun,
    failed: 0,
    candidates: 0,
    repaired: 0,
    scanned: 0,
    skippedAlreadyHealthy: 0,
    skippedInsufficientRoster: 0,
    targetTeamId: input.teamId,
    items: [],
  };
}

async function markRepairHeartbeat(summary: RepairIncompleteSquadsResult) {
  await markHeartbeat({
    squadRepairScanned: summary.scanned,
    squadRepairCandidates: summary.candidates,
    squadRepairRepaired: summary.repaired,
    squadRepairSkippedInsufficientRoster: summary.skippedInsufficientRoster,
    squadRepairSkippedAlreadyHealthy: summary.skippedAlreadyHealthy,
    squadRepairFailed: summary.failed,
    squadRepairLastRunAt: FieldValue.serverTimestamp(),
    squadRepairOk: summary.failed === 0,
  });
}

export async function repairIncompleteSquadsInternal(
  options: RepairIncompleteSquadsOptions = {},
): Promise<RepairIncompleteSquadsResult> {
  const now =
    options.now instanceof Date && !Number.isNaN(options.now.getTime())
      ? options.now
      : new Date();
  const dryRun = options.dryRun === true;
  const targetTeamId = String(options.teamId || '').trim() || null;
  const totalLimit =
    typeof options.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(1, Math.floor(options.limit))
      : null;
  const summary = createEmptyRepairSummary({
    dryRun,
    teamId: targetTeamId,
  });

  const applyResult = (result: RepairTeamRunResult) => {
    summary.scanned += 1;
    if (summary.items.length < SQUAD_REPAIR_HTTP_SAMPLE_LIMIT) {
      summary.items.push(result);
    }

    if (result.status === 'repaired') {
      summary.candidates += 1;
      summary.repaired += 1;
      return;
    }

    if (result.status === 'skipped_insufficient_roster') {
      summary.candidates += 1;
      summary.skippedInsufficientRoster += 1;
      return;
    }

    if (result.status === 'healthy') {
      summary.skippedAlreadyHealthy += 1;
    }
  };

  if (targetTeamId) {
    try {
      const result = await processTeamRepair(db.collection('teams').doc(targetTeamId), now, dryRun);
      applyResult(result);
    } catch (error) {
      summary.failed += 1;
      functions.logger.error('[squadRepair] team repair failed', {
        teamId: targetTeamId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    let cursor: string | null = null;
    let shouldContinue = true;

    while (shouldContinue) {
      const remaining =
        totalLimit == null ? SQUAD_REPAIR_PAGE_SIZE : Math.max(0, totalLimit - summary.scanned);
      if (remaining <= 0) {
        break;
      }

      let query = db
        .collection('teams')
        .orderBy(FieldPath.documentId())
        .limit(Math.min(SQUAD_REPAIR_PAGE_SIZE, remaining));
      if (cursor) {
        query = query.startAfter(cursor);
      }

      const snap = await query.get();
      if (snap.empty) {
        break;
      }

      for (const teamDoc of snap.docs) {
        try {
          const result = await processTeamRepair(teamDoc.ref, now, dryRun);
          applyResult(result);
        } catch (error) {
          summary.failed += 1;
          functions.logger.error('[squadRepair] team repair failed', {
            teamId: teamDoc.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = snap.docs[snap.docs.length - 1]?.id ?? null;
      shouldContinue = snap.size >= Math.min(SQUAD_REPAIR_PAGE_SIZE, remaining);
    }
  }

  if (options.markOps) {
    await markRepairHeartbeat(summary);
  }

  return summary;
}

export const repairIncompleteSquadsDaily = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .pubsub.schedule(SQUAD_REPAIR_CRON)
  .timeZone(TZ)
  .onRun(async () => {
    const result = await repairIncompleteSquadsInternal({ markOps: true });
    functions.logger.info('[squadRepair] daily repair complete', result);
    return null;
  });

export const repairIncompleteSquadsHttp = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed' });
      return;
    }
    if (!requireAdminSecret(req, res)) return;

    try {
      const body = readRequestBody(req);
      const result = await repairIncompleteSquadsInternal({
        dryRun: parseBoolean(body.dryRun ?? req.query?.dryRun, false),
        limit: parseLimit(body.limit ?? req.query?.limit),
        teamId: String(body.teamId ?? req.query?.teamId ?? '').trim() || null,
      });
      res.json({ ok: true, ...result });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error?.message || 'internal' });
    }
  });

export { SQUAD_REPAIR_CRON, SQUAD_REPAIR_PAGE_SIZE };
