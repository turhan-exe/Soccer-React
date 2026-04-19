import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';
import { dayKeyTR } from '../utils/schedule.js';

const REGION = 'europe-west1';
const TZ = 'Europe/Istanbul';
const db = getFirestore();

export type HistoricalRecoveryAlertInput = {
  leagueId: string;
  fixtureId: string;
  fixturePath: string;
  competitionType?: string | null;
  waveId?: string | null;
  reason: string;
  attemptCount: number;
  lastMatchId?: string | null;
};

export type HistoricalRecoveryAlertDoc = {
  kind: 'historical_fixture_fallback';
  leagueId: string;
  fixtureId: string;
  fixturePath: string;
  competitionType: string | null;
  waveId: string | null;
  reason: string;
  attemptCount: number;
  lastMatchId: string | null;
  sendAttempts: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  sentAt?: unknown;
  lastSendError?: string | null;
};

function updateHeartbeat(day: string, patch: Record<string, unknown>) {
  return db.doc(`ops_heartbeats/${day}`).set(
    {
      lastUpdated: FieldValue.serverTimestamp(),
      ...patch,
    },
    { merge: true },
  );
}

function readConfig() {
  return (functions.config() as any) || {};
}

function readString(value: unknown) {
  return String(value || '').trim();
}

function parseEmailList(value: unknown) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveAlertRecipients() {
  const cfg = readConfig();
  return parseEmailList(
    process.env.RECOVERY_ALERT_EMAILS ||
      cfg?.recovery?.alert_emails ||
      cfg?.alert?.email_to ||
      '',
  );
}

function resolveSmtpConfig() {
  const cfg = readConfig();
  const host =
    process.env.SMTP_HOST ||
    cfg?.recovery?.smtp_host ||
    cfg?.notify?.smtp_host ||
    '';
  const portRaw =
    process.env.SMTP_PORT ||
    cfg?.recovery?.smtp_port ||
    cfg?.notify?.smtp_port ||
    '587';
  const secureRaw =
    process.env.SMTP_SECURE ||
    cfg?.recovery?.smtp_secure ||
    cfg?.notify?.smtp_secure ||
    '';
  const user =
    process.env.SMTP_USER ||
    cfg?.recovery?.smtp_user ||
    cfg?.notify?.smtp_user ||
    '';
  const pass =
    process.env.SMTP_PASS ||
    cfg?.recovery?.smtp_pass ||
    cfg?.notify?.smtp_pass ||
    '';
  const from =
    process.env.SMTP_FROM ||
    cfg?.recovery?.smtp_from ||
    cfg?.notify?.smtp_from ||
    '';
  const port = Number(portRaw || 587);
  const secure =
    secureRaw
      ? String(secureRaw).trim().toLowerCase() === 'true'
      : port === 465;

  return {
    host: readString(host),
    port: Number.isFinite(port) ? port : 587,
    secure,
    user: readString(user),
    pass: readString(pass),
    from: readString(from),
  };
}

function buildAlertDocId(input: HistoricalRecoveryAlertInput) {
  return `historical_fallback__${input.leagueId}__${input.fixtureId}`;
}

function competitionLabel(value: string | null | undefined) {
  return readString(value) === 'champions_league'
    ? 'Champions League'
    : 'League';
}

export function buildHistoricalRecoveryAlertEmail(
  alert: Pick<
    HistoricalRecoveryAlertDoc,
    'leagueId' | 'fixtureId' | 'competitionType' | 'waveId' | 'reason' | 'attemptCount' | 'lastMatchId' | 'fixturePath'
  >,
) {
  const subject = `[MGX] Historical recovery alert ${competitionLabel(alert.competitionType)} ${alert.leagueId}/${alert.fixtureId}`;
  const text = [
    'Historical match recovery requires operator attention.',
    'This alert is emitted after nightly recovery exhausted live retries or fallback finalization failed.',
    '',
    `Competition: ${competitionLabel(alert.competitionType)}`,
    `League ID: ${alert.leagueId}`,
    `Fixture ID: ${alert.fixtureId}`,
    `Fixture Path: ${alert.fixturePath}`,
    `Wave ID: ${alert.waveId || '-'}`,
    `Attempts: ${alert.attemptCount}`,
    `Last Match ID: ${alert.lastMatchId || '-'}`,
    `Reason: ${alert.reason}`,
  ].join('\n');

  return { subject, text };
}

export async function queueHistoricalRecoveryAlert(input: HistoricalRecoveryAlertInput) {
  const ref = db.collection('ops_recovery_alerts').doc(buildAlertDocId(input));
  const existing = await ref.get();
  const existingData = existing.exists ? (existing.data() as HistoricalRecoveryAlertDoc) : null;
  if (existingData?.sentAt || existingData?.createdAt) {
    return { queued: false, alertId: ref.id, duplicate: true };
  }

  await ref.set(
    {
      kind: 'historical_fixture_fallback',
      leagueId: input.leagueId,
      fixtureId: input.fixtureId,
      fixturePath: input.fixturePath,
      competitionType: readString(input.competitionType) || null,
      waveId: readString(input.waveId) || null,
      reason: readString(input.reason) || 'unknown',
      attemptCount: Math.max(1, Math.trunc(Number(input.attemptCount || 0) || 1)),
      lastMatchId: readString(input.lastMatchId) || null,
      sendAttempts: 0,
      sentAt: null,
      lastSendError: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    } satisfies HistoricalRecoveryAlertDoc,
    { merge: true },
  );

  await updateHeartbeat(dayKeyTR(new Date()), {
    nightlyRecoveryAlertPending: FieldValue.increment(1),
  });

  return { queued: true, alertId: ref.id, duplicate: false };
}

async function loadPendingAlertDocs(limit = 20) {
  try {
    const snap = await db
      .collection('ops_recovery_alerts')
      .where('sentAt', '==', null)
      .limit(limit)
      .get();
    return snap.docs;
  } catch {
    const snap = await db.collection('ops_recovery_alerts').limit(Math.max(limit * 2, 40)).get();
    return snap.docs
      .filter((doc) => {
        const data = doc.data() as HistoricalRecoveryAlertDoc;
        return data.sentAt == null;
      })
      .slice(0, limit);
  }
}

async function sendSingleRecoveryAlert(
  snap: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>,
) {
  const alert = snap.data() as HistoricalRecoveryAlertDoc;
  const recipients = resolveAlertRecipients();
  const smtp = resolveSmtpConfig();
  if (!recipients.length) {
    throw new Error('RECOVERY_ALERT_EMAILS missing');
  }
  if (!smtp.host || !smtp.from) {
    throw new Error('SMTP_HOST / SMTP_FROM missing');
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user || smtp.pass
      ? {
          user: smtp.user,
          pass: smtp.pass,
        }
      : undefined,
  });

  const email = buildHistoricalRecoveryAlertEmail(alert);
  await transporter.sendMail({
    from: smtp.from,
    to: recipients.join(', '),
    subject: email.subject,
    text: email.text,
  });
}

export const sendPendingRecoveryAlertEmails = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .region(REGION)
  .pubsub.schedule('every 15 minutes')
  .timeZone(TZ)
  .onRun(async () => {
    const now = new Date();
    const docs = await loadPendingAlertDocs();
    let sent = 0;
    let failed = 0;

    for (const doc of docs) {
      try {
        await sendSingleRecoveryAlert(doc);
        await doc.ref.set(
          {
            sentAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            sendAttempts: FieldValue.increment(1),
            lastSendError: FieldValue.delete(),
          },
          { merge: true },
        );
        sent += 1;
      } catch (error: any) {
        await doc.ref.set(
          {
            updatedAt: FieldValue.serverTimestamp(),
            sendAttempts: FieldValue.increment(1),
            lastSendError: error?.message || String(error),
          },
          { merge: true },
        );
        failed += 1;
        functions.logger.warn('[sendPendingRecoveryAlertEmails] send failed', {
          alertId: doc.id,
          error: error?.message || String(error),
        });
      }
    }

    await updateHeartbeat(dayKeyTR(now), {
      nightlyRecoveryAlertSent: FieldValue.increment(sent),
      nightlyRecoveryAlertFailed: FieldValue.increment(failed),
    });

    functions.logger.info('[sendPendingRecoveryAlertEmails] done', {
      checked: docs.length,
      sent,
      failed,
    });

    return null;
  });
