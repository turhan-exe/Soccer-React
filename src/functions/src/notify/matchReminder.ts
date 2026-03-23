import * as functions from 'firebase-functions/v1';
import { getFirestore } from 'firebase-admin/firestore';
import { v2 as cloudTasks } from '@google-cloud/tasks';
import { sendPushToUser } from './push.js';

const db = getFirestore();
const REGION = 'europe-west1';
const tasksClient = new cloudTasks.CloudTasksClient();
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const TASKS_LOCATION = process.env.TASKS_LOCATION || 'europe-west1';
const MATCH_REMINDER_QUEUE = process.env.MATCH_REMINDER_QUEUE || 'league-match-reminder';
const MATCH_REMINDER_SECRET =
  process.env.MATCH_REMINDER_SECRET ||
  (functions.config() as any)?.notify?.secret ||
  (functions.config() as any)?.orchestrate?.secret ||
  '';

type MatchReminderPayload = {
  leagueId: string;
  fixtureId: string;
  kickoffAtMs: number;
};

const buildReminderTaskName = (parent: string, fixtureId: string, kickoffAtMs: number) =>
  `${parent}/tasks/league-match-2m-${fixtureId}-${kickoffAtMs}`;

export async function enqueueLeagueMatchReminder(
  leagueId: string,
  fixtureId: string,
  kickoffAt: Date,
) {
  if (!PROJECT || !MATCH_REMINDER_SECRET) {
    return;
  }

  const kickoffAtMs = kickoffAt.getTime();
  if (!Number.isFinite(kickoffAtMs)) {
    return;
  }

  const parent = tasksClient.queuePath(PROJECT, TASKS_LOCATION, MATCH_REMINDER_QUEUE);
  const url = `https://${REGION}-${PROJECT}.cloudfunctions.net/leagueMatchReminderHttp`;
  const scheduleAtMs = Math.max(Date.now() + 5_000, kickoffAtMs - 120_000);
  const payload: MatchReminderPayload = { leagueId, fixtureId, kickoffAtMs };

  const task = {
    name: buildReminderTaskName(parent, fixtureId, kickoffAtMs),
    scheduleTime: {
      seconds: Math.floor(scheduleAtMs / 1000),
    },
    httpRequest: {
      httpMethod: 'POST' as const,
      url,
      headers: {
        'Content-Type': 'application/json',
        ...(MATCH_REMINDER_SECRET ? { Authorization: `Bearer ${MATCH_REMINDER_SECRET}` } : {}),
      },
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
    },
  } as const;

  try {
    await tasksClient.createTask({ parent, task: task as any });
  } catch (error: any) {
    if (error?.code === 6 || /already exists/i.test(error?.message || '')) {
      return;
    }
    throw error;
  }
}

export async function enqueueLeagueMatchReminders(
  leagueId: string,
  reminders: Array<{ fixtureId: string; kickoffAt: Date }>,
  concurrency = 25,
) {
  if (!PROJECT || !MATCH_REMINDER_SECRET || reminders.length === 0) {
    return { scheduled: 0, failed: 0 };
  }

  let scheduled = 0;
  let failed = 0;
  const chunkSize = Math.max(1, Math.min(100, Math.trunc(concurrency) || 25));

  for (let index = 0; index < reminders.length; index += chunkSize) {
    const chunk = reminders.slice(index, index + chunkSize);
    const results = await Promise.allSettled(
      chunk.map((item) => enqueueLeagueMatchReminder(leagueId, item.fixtureId, item.kickoffAt)),
    );
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        scheduled += 1;
        return;
      }
      failed += 1;
      functions.logger.warn('[enqueueLeagueMatchReminders] createTask failed', {
        leagueId,
        error: result.reason?.message || String(result.reason),
      });
    });
  }

  return { scheduled, failed };
}

async function resolveFixtureOwners(fixture: any) {
  const teamIds = [fixture?.homeTeamId, fixture?.awayTeamId]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const uniqueTeamIds = Array.from(new Set(teamIds));
  if (uniqueTeamIds.length === 0) {
    return { homeOwnerUid: null, awayOwnerUid: null };
  }

  const teamSnaps = await Promise.all(uniqueTeamIds.map((teamId) => db.doc(`teams/${teamId}`).get()));
  const ownerByTeamId = new Map<string, string | null>();
  teamSnaps.forEach((snap) => {
    if (!snap.exists) return;
    const data = snap.data() as any;
    ownerByTeamId.set(snap.id, typeof data?.ownerUid === 'string' ? data.ownerUid : null);
  });

  return {
    homeOwnerUid: ownerByTeamId.get(String(fixture?.homeTeamId || '')) || null,
    awayOwnerUid: ownerByTeamId.get(String(fixture?.awayTeamId || '')) || null,
  };
}

export const leagueMatchReminderHttp = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const authz = (req.headers.authorization as string) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!MATCH_REMINDER_SECRET || token !== MATCH_REMINDER_SECRET) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    const body = (req.body || {}) as MatchReminderPayload;
    const { leagueId, fixtureId, kickoffAtMs } = body;
    if (!leagueId || !fixtureId || !Number.isFinite(kickoffAtMs)) {
      res.status(400).json({ ok: false, error: 'invalid-payload' });
      return;
    }

    const fixtureRef = db.doc(`leagues/${leagueId}/fixtures/${fixtureId}`);
    const fixtureSnap = await fixtureRef.get();
    if (!fixtureSnap.exists) {
      res.json({ ok: true, skipped: 'missing-fixture' });
      return;
    }

    const fixture = fixtureSnap.data() as any;
    const actualKickoffAtMs =
      fixture?.date && typeof fixture.date.toMillis === 'function' ? fixture.date.toMillis() : 0;
    if (!actualKickoffAtMs || actualKickoffAtMs !== kickoffAtMs) {
      res.json({ ok: true, skipped: 'stale-task' });
      return;
    }

    if (String(fixture?.status || '').toLowerCase() !== 'scheduled') {
      res.json({ ok: true, skipped: 'fixture-not-scheduled' });
      return;
    }

    const { homeOwnerUid, awayOwnerUid } = await resolveFixtureOwners(fixture);
    const recipients = [homeOwnerUid, awayOwnerUid].filter(
      (value, index, array): value is string => Boolean(value) && array.indexOf(value) === index,
    );

    for (const uid of recipients) {
      await sendPushToUser(
        uid,
        {
          type: 'league-match-2m',
          title: 'Lig maci yaklasiyor',
          body: 'Resmi lig macin 2 dakika icinde baslayacak.',
          path: '/fixtures',
          data: {
            leagueId,
            fixtureId,
            kickoffAtMs,
          },
        },
        `league-match-2m:${leagueId}:${fixtureId}:${uid}`,
      );
    }

    res.json({ ok: true, recipients: recipients.length });
  });
