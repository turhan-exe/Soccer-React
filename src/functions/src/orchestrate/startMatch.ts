import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { log } from '../logger.js';
import { v2 as cloudTasks } from '@google-cloud/tasks';
import { scheduleFinalizeWatchdog } from './retry.js';

const db = admin.firestore();
const REGION = 'europe-west1';
const START_SECRET = (functions.config() as any)?.start?.secret || (functions.config() as any)?.orchestrate?.secret || '';

const tasksClient = new cloudTasks.CloudTasksClient();

function shardKey(leagueId: string, shards = Number(process.env.TASKS_SHARDS || '1')) {
  if (!shards || shards <= 1) return 0;
  const sum = [...String(leagueId)].reduce((a, c) => a + c.charCodeAt(0), 0);
  return Math.abs(sum) % shards;
}

export async function enqueueStartMatch(matchId: string, leagueId: string) {
  const location = process.env.TASKS_LOCATION || 'europe-west1';
  const project = process.env.GCLOUD_PROJECT!;
  const shard = shardKey(leagueId);
  const baseQueue = process.env.TASKS_QUEUE || 'start-match';
  const queue = shard > 0 ? `${baseQueue}-${shard}` : baseQueue; // e.g., start-match-3
  const parent = tasksClient.queuePath(project, location, queue);

  const url = `https://${REGION}-${project}.cloudfunctions.net/startMatchHttp`;
  const payload = { matchId, leagueId };
  const task = {
    httpRequest: {
      httpMethod: 'POST' as const,
      url,
      headers: {
        'Content-Type': 'application/json',
        ...(START_SECRET ? { Authorization: `Bearer ${START_SECRET}` } : {}),
      },
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
    },
    // De-dup by name to avoid duplicate enqueues per match
    // Note: supplying name requires full path
    name: `${parent}/tasks/run-${matchId}`,
  } as const;

  try {
    await tasksClient.createTask({ parent, task: task as any });
  } catch (e: any) {
    // If task already exists, treat as success (idempotent enqueue)
    if (e?.code === 6 || /ALREADY_EXISTS/i.test(e?.message || '')) return;
    throw e;
  }
}

export async function startMatchInternal(matchId: string, leagueId: string, opts?: { forceRedispatch?: boolean }) {
  const t0 = Date.now();
  const reqId = log.info('startMatch_start', { function: 'startMatchInternal', matchId, leagueId });
  const fxRef = db.doc(`leagues/${leagueId}/fixtures/${matchId}`);
  const forceRedispatch = !!opts?.forceRedispatch;
  // Transactional guard for idempotency: only transition scheduled -> running once
  let fx: any;
  let shouldSkip = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(fxRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'fixture missing');
    fx = snap.data();
    const st = fx.status;
    if (forceRedispatch) return; // allow continuing without status change
    if (st === 'scheduled') {
      tx.update(fxRef, {
        status: 'running',
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }
    if (st === 'running' || st === 'played') {
      shouldSkip = true;
    }
  });

  if (shouldSkip && !forceRedispatch) {
    log.warn('startMatch skipped (status)', { requestId: reqId, matchId, status: fx?.status, ok: true, skipped: true, durationMs: Date.now() - t0 });
    return { skipped: true };
  }

  // Ensure snapshot plan exists
  const planRef = db.doc(`matchPlans/${matchId}`);
  const planDoc = await planRef.get();
  if (!planDoc.exists) {
    // Read lineup from top-level teams collection (source of truth)
    const homeRef = db.doc(`teams/${fx.homeTeamId}`);
    const awayRef = db.doc(`teams/${fx.awayTeamId}`);
    const [home, away] = await db.getAll(homeRef, awayRef);
    const h = home.data() as any, a = away.data() as any;
    await planRef.set({
      matchId, leagueId, seasonId: fx.seasonId || 'S-2025a',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      rngSeed: fx.seed || Math.floor(Math.random() * 1e9),
      kickoffUtc: fx.date,
      home: {
        teamId: fx.homeTeamId, clubName: h?.clubName,
        formation: h?.lineup?.formation, tactics: h?.lineup?.tactics || {},
        starters: h?.lineup?.starters || [], subs: h?.lineup?.subs || []
      },
      away: {
        teamId: fx.awayTeamId, clubName: a?.clubName,
        formation: a?.lineup?.formation, tactics: a?.lineup?.tactics || {},
        starters: a?.lineup?.starters || [], subs: a?.lineup?.subs || []
      }
    });
  }

  // If forceRedispatch and fixture is not running, ensure it's marked running
  if (forceRedispatch && fx?.status !== 'running') {
    await fxRef.set({ status: 'running', startedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }

  // Mark league active on first start
  try {
    const leagueRef = db.doc(`leagues/${leagueId}`);
    const leagueSnap = await leagueRef.get();
    const state = (leagueSnap.data() as any)?.state;
    if (state === 'scheduled') {
      await leagueRef.set({ state: 'active', activatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
  } catch {}

  const UNITY_URL = process.env.UNITY_DISPATCHER_URL;
  const UNITY_SECRET = functions.config().unity?.secret || '';

  if (!UNITY_URL) {
    log.warn('UNITY_DISPATCHER_URL missing; assume batch mode', { matchId });
    return { ok: true, batchMode: true };
  }

  const plan = (await planRef.get()).data() as any;

  // Optional enrichment: load team rosters to attach pos/ovr
  async function mapPlayers(ids: string[] | undefined, teamId: string) {
    if (!ids || ids.length === 0) return [] as any[];
    try {
      const teamDoc = await db.doc(`teams/${teamId}`).get();
      const roster: any[] = (teamDoc.data() as any)?.players || [];
      const byId = new Map<string, any>(roster.map((p: any) => [String(p.id), p]));
      return ids.map((pid: string) => {
        const p = byId.get(String(pid));
        return p
          ? { pid: String(pid), pos: p.position || undefined, ovr: p.overall || undefined, stamina: 1.0, traits: [] as any[] }
          : { pid: String(pid) };
      });
    } catch {
      return ids.map((pid) => ({ pid: String(pid) }));
    }
  }

  const homePlayers = await mapPlayers(plan?.home?.starters, plan?.home?.teamId || plan?.home?.clubId);
  const homeBench = await mapPlayers(plan?.home?.subs, plan?.home?.teamId || plan?.home?.clubId);
  const awayPlayers = await mapPlayers(plan?.away?.starters, plan?.away?.teamId || plan?.away?.clubId);
  const awayBench = await mapPlayers(plan?.away?.subs, plan?.away?.teamId || plan?.away?.clubId);

  const matchSpec = {
    schemaVersion: 1,
    matchId,
    leagueId,
    seasonId: plan.seasonId,
    kickoffUtc: plan.kickoffUtc?.toDate?.()?.toISOString?.() || new Date().toISOString(),
    rngSeed: plan.rngSeed,
    home: {
      teamId: plan.home.teamId || plan.home.clubId, name: plan.home.clubName,
      formation: plan.home.formation, tactics: plan.home.tactics,
      players: homePlayers,
      bench: homeBench,
    },
    away: {
      teamId: plan.away.teamId || plan.away.clubId, name: plan.away.clubName,
      formation: plan.away.formation, tactics: plan.away.tactics,
      players: awayPlayers,
      bench: awayBench,
    }
  };

  try {
    const resp = await fetch(UNITY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(UNITY_SECRET ? { 'Authorization': `Bearer ${UNITY_SECRET}` } : {}) },
      body: JSON.stringify(matchSpec)
    });
    if (!resp.ok) throw new Error(`Unity dispatch ${resp.status}`);
    log.info('startMatch dispatched', { requestId: reqId, matchId, ok: true, forceRedispatch });
  } catch (e: any) {
    log.error('startMatch dispatch failed', { requestId: reqId, matchId, err: String(e), errorClass: e?.code || e?.name || 'UnityDispatchError', ok: false });
  }

  const durationMs = Date.now() - t0;
  log.info('startMatch_done', { requestId: reqId, function: 'startMatchInternal', matchId, leagueId, ok: true, durationMs });
  try {
    await scheduleFinalizeWatchdog(matchId, leagueId, 0);
  } catch {}
  return { ok: true, durationMs };
}

export const startMatchHttp = functions
  .runWith({ maxInstances: 100, timeoutSeconds: 540, memory: '512MB' })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const t0 = Date.now();
    // Restrict to internal callers (Tasks/Scheduler/Operators) via bearer secret
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!START_SECRET || token !== START_SECRET) {
      res.status(401).send('unauthorized');
      return;
    }

    const { matchId, leagueId } = req.body || {};
    if (!matchId || !leagueId) return res.status(400).send('missing params');
    try {
      const r = await startMatchInternal(matchId, leagueId);
      const durationMs = Date.now() - t0;
      log.info('startMatchHttp_ok', { matchId, leagueId, ok: true, durationMs });
      res.json({ ok: true, ...r, httpDurationMs: durationMs });
    } catch (e: any) {
      const durationMs = Date.now() - t0;
      log.error('startMatchHttp_err', { matchId, leagueId, ok: false, durationMs, errorClass: e?.code || e?.name || 'StartMatchHttpError', err: String(e?.message || e) });
      res.status(500).send(e?.message || 'error');
    }
  });
