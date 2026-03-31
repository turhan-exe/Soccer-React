import * as functions from 'firebase-functions/v1';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { GoogleAuth } from 'google-auth-library';
import { createHash, randomUUID } from 'node:crypto';

import '../_firebase.js';

const db = getFirestore();
const adminAuth = getAuth();

const integrityAuth = new GoogleAuth({
  scopes: [
    'https://www.googleapis.com/auth/playintegrity',
    'https://www.googleapis.com/auth/cloud-platform',
  ],
});

const PACKAGE_NAME = (
  process.env.ANDROID_PACKAGE_NAME || 'com.nerbuss.fhsmanager'
).trim();

const EXPECTED_PLAY_CERT_DIGESTS = String(
  process.env.ANDROID_ALLOWED_CERT_DIGESTS
  || 't4nLPL4EjD2ogexm9P9AfjBtjowsH-dOX2TNWR8x9wE',
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const EXPECTED_PRERELEASE_CERT_DIGESTS = String(
  process.env.ANDROID_ALLOWED_PRERELEASE_CERT_DIGESTS
  || 't4nLPL4EjD2ogexm9P9AfjBtjowsH-dOX2TNWR8x9wE,b-SqkTFgAHKY70pCZ3-FsA6RbcUcQ7MmNe0Una8V6PE',
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_PRERELEASE_TESTER_EMAILS = ['fikretleto@gmail.com'];

type GateMode = 'observe' | 'enforce';

type AndroidVersionPolicy = {
  latestVersionCode: number;
  latestVersionName: string;
  minSupportedVersionCode: number;
  forceImmediateUpdate: boolean;
  gateMode: GateMode;
  sessionTtlSeconds: number;
  requireLicensedPlayInstall: boolean;
  requireDeviceIntegrity: boolean;
  allowPrereleaseTesterEmails: string[];
  storeUrl: string;
  blockTitle: string;
  blockMessage: string;
};

type ChallengeRecord = {
  uid: string;
  challengeId: string;
  requestHash: string;
  createdAtMs: number;
  expiresAtMs: number;
  usedAtMs: number | null;
};

type GateViolation = {
  reason: string;
  message: string;
  extra?: Record<string, unknown>;
};

const DEFAULT_POLICY: AndroidVersionPolicy = {
  latestVersionCode: 2026032801,
  latestVersionName: '1.0.17',
  minSupportedVersionCode: 2026032801,
  forceImmediateUpdate: true,
  gateMode: 'enforce',
  sessionTtlSeconds: 600,
  requireLicensedPlayInstall: true,
  requireDeviceIntegrity: true,
  allowPrereleaseTesterEmails: DEFAULT_PRERELEASE_TESTER_EMAILS,
  storeUrl: 'https://play.google.com/store/apps/details?id=com.nerbuss.fhsmanager',
  blockTitle: 'Guncelleme gerekli',
  blockMessage: 'Devam etmek icin uygulamanin en son surumunu yukleyin.',
};

const asInt = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const asString = (value: unknown): string =>
  typeof value === 'string' && value.trim() ? value.trim() : '';

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const asStringList = (value: unknown, fallback: string[] = []): string[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const normalized = value
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter(Boolean);

  return normalized.length > 0 ? normalized : [...fallback];
};

const normalizeEmail = (value: unknown): string =>
  typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : '';

const toPolicy = (value: unknown): AndroidVersionPolicy => {
  if (!value || typeof value !== 'object') {
    return DEFAULT_POLICY;
  }

  const source = value as Record<string, unknown>;
  const latestVersionCode =
    asInt(source.latestVersionCode) ?? DEFAULT_POLICY.latestVersionCode;
  const minSupportedVersionCode =
    asInt(source.minSupportedVersionCode) ?? DEFAULT_POLICY.minSupportedVersionCode;
  const gateMode: GateMode = source.gateMode === 'enforce' ? 'enforce' : 'observe';
  const sessionTtlSeconds = Math.max(
    asInt(source.sessionTtlSeconds) ?? DEFAULT_POLICY.sessionTtlSeconds,
    60,
  );
  const effectiveLatestVersionCode = Math.max(
    latestVersionCode,
    minSupportedVersionCode,
  );

  return {
    latestVersionCode: effectiveLatestVersionCode,
    latestVersionName:
      asString(source.latestVersionName) || String(effectiveLatestVersionCode),
    minSupportedVersionCode,
    forceImmediateUpdate: asBoolean(
      source.forceImmediateUpdate,
      DEFAULT_POLICY.forceImmediateUpdate,
    ),
    gateMode,
    sessionTtlSeconds,
    requireLicensedPlayInstall: asBoolean(
      source.requireLicensedPlayInstall,
      DEFAULT_POLICY.requireLicensedPlayInstall,
    ),
    requireDeviceIntegrity: asBoolean(
      source.requireDeviceIntegrity,
      DEFAULT_POLICY.requireDeviceIntegrity,
    ),
    allowPrereleaseTesterEmails: asStringList(
      source.allowPrereleaseTesterEmails,
      DEFAULT_POLICY.allowPrereleaseTesterEmails,
    ),
    storeUrl: asString(source.storeUrl) || DEFAULT_POLICY.storeUrl,
    blockTitle: asString(source.blockTitle) || DEFAULT_POLICY.blockTitle,
    blockMessage: asString(source.blockMessage) || DEFAULT_POLICY.blockMessage,
  };
};

const getMobileUpdatePolicy = async (): Promise<AndroidVersionPolicy> => {
  const snapshot = await db.collection('public_config').doc('mobile_update').get();
  if (!snapshot.exists) {
    return DEFAULT_POLICY;
  }

  return toPolicy(snapshot.data()?.android ?? null);
};

const challengeRef = (challengeId: string) =>
  db.collection('versionIntegrityChallenges').doc(challengeId);

const getAccessToken = async (): Promise<string> => {
  const client = await integrityAuth.getClient();
  const token = await client.getAccessToken();
  const value = typeof token === 'string' ? token : token?.token;

  if (!value) {
    throw new functions.https.HttpsError(
      'internal',
      'Play Integrity erisim belirteci alinamadi.',
      { reason: 'NETWORK_REQUIRED' },
    );
  }

  return value;
};

const readApiErrorBody = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => '');
  if (!text) {
    return '';
  }

  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    return parsed.error?.message?.trim() || text;
  } catch {
    return text;
  }
};

const decodeIntegrityToken = async (integrityToken: string): Promise<any> => {
  const accessToken = await getAccessToken();
  const url = `https://playintegrity.googleapis.com/v1/${encodeURIComponent(PACKAGE_NAME)}:decodeIntegrityToken`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ integrityToken }),
  });

  if (!response.ok) {
    const detail = await readApiErrorBody(response);
    functions.logger.error('Play Integrity decode failed', {
      packageName: PACKAGE_NAME,
      status: response.status,
      detail,
    });

    throw new functions.https.HttpsError(
      response.status === 401 || response.status === 403
        ? 'permission-denied'
        : 'failed-precondition',
      detail || `Play Integrity decode failed with HTTP ${response.status}.`,
      { reason: 'NETWORK_REQUIRED', detail },
    );
  }

  const parsed = (await response.json()) as {
    tokenPayloadExternal?: unknown;
  };

  return parsed.tokenPayloadExternal ?? null;
};

const requireAuthUid = (
  context: functions.https.CallableContext,
): string => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required.', {
      reason: 'VERSION_SESSION_REQUIRED',
    });
  }

  return uid;
};

const makeRequestHash = (
  uid: string,
  challengeId: string,
  createdAtMs: number,
): string =>
  createHash('sha256')
    .update(`${uid}:${challengeId}:${createdAtMs}:${randomUUID()}`)
    .digest('hex');

const blockWith = (
  reason: string,
  message: string,
  policy: AndroidVersionPolicy,
  extra: Record<string, unknown> = {},
): never => {
  functions.logger.warn('Android version gate blocked request', {
    reason,
    latestVersionCode: policy.latestVersionCode,
    minSupportedVersionCode: policy.minSupportedVersionCode,
    gateMode: policy.gateMode,
    ...extra,
  });

  throw new functions.https.HttpsError('failed-precondition', message, {
    reason,
    message,
  });
};

const recordGateViolation = (
  policy: AndroidVersionPolicy,
  observedViolations: string[],
  violation: GateViolation,
): void => {
  const payload = {
    reason: violation.reason,
    message: violation.message,
    latestVersionCode: policy.latestVersionCode,
    minSupportedVersionCode: policy.minSupportedVersionCode,
    gateMode: policy.gateMode,
    ...(violation.extra || {}),
  };

  if (policy.gateMode === 'enforce') {
    functions.logger.warn('Android version gate blocked request', payload);
    throw new functions.https.HttpsError(
      'failed-precondition',
      violation.message,
      {
        reason: violation.reason,
        message: violation.message,
      },
    );
  }

  functions.logger.info('Android version gate observed violation', payload);
  observedViolations.push(violation.reason);
};

const assertChallenge = async (
  uid: string,
  challengeId: string,
): Promise<ChallengeRecord> => {
  const snapshot = await challengeRef(challengeId).get();
  if (!snapshot.exists) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Version challenge bulunamadi.',
      { reason: 'VERSION_SESSION_REQUIRED' },
    );
  }

  const data = (snapshot.data() || {}) as Record<string, unknown>;
  const now = Date.now();
  const record: ChallengeRecord = {
    uid: asString(data.uid),
    challengeId: asString(data.challengeId),
    requestHash: asString(data.requestHash),
    createdAtMs: asInt(data.createdAtMs) ?? 0,
    expiresAtMs: asInt(data.expiresAtMs) ?? 0,
    usedAtMs: asInt(data.usedAtMs),
  };

  if (record.uid !== uid) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Challenge kullanici uyumsuz.',
      { reason: 'SESSION_EXCHANGE_FAILED' },
    );
  }

  if (record.usedAtMs) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Challenge daha once kullanildi.',
      { reason: 'SESSION_EXCHANGE_FAILED' },
    );
  }

  if (record.expiresAtMs <= now) {
    throw new functions.https.HttpsError(
      'deadline-exceeded',
      'Challenge suresi doldu.',
      { reason: 'NETWORK_REQUIRED' },
    );
  }

  return record;
};

export const prepareAndroidVersionCheck = functions
  .region('europe-west1')
  .https.onCall(async (_data, context) => {
    const uid = requireAuthUid(context);
    const challengeId = randomUUID();
    const createdAtMs = Date.now();
    const requestHash = makeRequestHash(uid, challengeId, createdAtMs);

    await challengeRef(challengeId).set({
      uid,
      challengeId,
      requestHash,
      createdAtMs,
      expiresAtMs: createdAtMs + CHALLENGE_TTL_MS,
      usedAtMs: null,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(createdAtMs + CHALLENGE_TTL_MS),
    });

    return {
      challengeId,
      requestHash,
    };
  });

export const exchangeAndroidVersionSession = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
    const uid = requireAuthUid(context);
    const challengeId = asString(data?.challengeId);
    const integrityToken = asString(data?.integrityToken);
    const clientPackageName = asString(data?.packageName);
    const clientVersionCode = asInt(data?.versionCode) ?? 0;
    const clientVersionName = asString(data?.versionName);

    if (!challengeId || !integrityToken || !clientPackageName || clientVersionCode <= 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Eksik version session verisi.',
        { reason: 'SESSION_EXCHANGE_FAILED' },
      );
    }

    const policy = await getMobileUpdatePolicy();
    const challenge = await assertChallenge(uid, challengeId);
    const userRecord = await adminAuth.getUser(uid);
    const normalizedEmail = normalizeEmail(userRecord.email);
    const isAllowlistedPrereleaseTester =
      !!normalizedEmail
      && policy.allowPrereleaseTesterEmails.includes(normalizedEmail);
    const decoded = await decodeIntegrityToken(integrityToken);
    const observedViolations: string[] = [];

    const requestHash = asString(decoded?.requestDetails?.requestHash);
    const requestPackageName = asString(decoded?.requestDetails?.requestPackageName);
    const appRecognitionVerdict = asString(decoded?.appIntegrity?.appRecognitionVerdict);
    const appVersionCode = asInt(decoded?.appIntegrity?.versionCode) ?? 0;
    const certificateDigests = Array.isArray(
      decoded?.appIntegrity?.certificateSha256Digest,
    )
      ? decoded.appIntegrity.certificateSha256Digest
          .map((value: unknown) => String(value).trim())
          .filter(Boolean)
      : [];
    const licensingVerdict = asString(decoded?.accountDetails?.appLicensingVerdict);
    const deviceVerdicts = Array.isArray(
      decoded?.deviceIntegrity?.deviceRecognitionVerdict,
    )
      ? decoded.deviceIntegrity.deviceRecognitionVerdict.map((value: unknown) =>
          String(value).trim(),
        )
      : [];

    if (requestHash !== challenge.requestHash) {
      blockWith('INTEGRITY_TOKEN_INVALID', 'Play Integrity request hash uyusmadi.', policy, {
        uid,
        challengeId,
      });
    }

    if (requestPackageName !== PACKAGE_NAME || clientPackageName !== PACKAGE_NAME) {
      blockWith(
        'UNRECOGNIZED_VERSION',
        'Paket kimligi Play Integrity ile eslesmiyor.',
        policy,
        {
          uid,
          challengeId,
          requestPackageName,
          clientPackageName,
        },
      );
    }

    if (appVersionCode <= 0 || appVersionCode !== clientVersionCode) {
      blockWith(
        'UNRECOGNIZED_VERSION',
        'Surum kodu Play Integrity ile eslesmiyor.',
        policy,
        {
          uid,
          challengeId,
          appVersionCode,
          clientVersionCode,
          clientVersionName,
        },
      );
    }

    if (appVersionCode < policy.minSupportedVersionCode) {
      recordGateViolation(policy, observedViolations, {
        reason: 'OUTDATED_VERSION',
        message: 'Bu surum artik desteklenmiyor. Guncelleme gerekli.',
        extra: {
          uid,
          challengeId,
          appVersionCode,
        },
      });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const sessionTtlSeconds = Math.max(policy.sessionTtlSeconds, 60);
    const sessionExpiresAtSeconds = nowSeconds + sessionTtlSeconds;
    const sessionId = randomUUID();

    const isTesterPrereleaseCandidate =
      isAllowlistedPrereleaseTester
      && appVersionCode >= policy.latestVersionCode
      && appRecognitionVerdict !== 'PLAY_RECOGNIZED';

    if (isTesterPrereleaseCandidate) {
      if (
        policy.requireDeviceIntegrity
        && !deviceVerdicts.includes('MEETS_DEVICE_INTEGRITY')
      ) {
        recordGateViolation(policy, observedViolations, {
          reason: 'DEVICE_INTEGRITY_FAIL',
          message: 'Cihaz butunlugu dogrulanamadi.',
          extra: {
            uid,
            challengeId,
            deviceVerdicts,
            appVersionCode,
          },
        });
      }

      if (EXPECTED_PRERELEASE_CERT_DIGESTS.length > 0) {
        const hasExpectedTesterDigest = certificateDigests.some((digest: string) =>
          EXPECTED_PRERELEASE_CERT_DIGESTS.includes(digest),
        );

        if (!hasExpectedTesterDigest) {
          recordGateViolation(policy, observedViolations, {
            reason: 'UNRECOGNIZED_VERSION',
            message: 'Test surumu beklenen imza ile eslesmiyor.',
            extra: {
              uid,
              challengeId,
              appVersionCode,
              certificateDigests,
            },
          });
        }
      }

      await challengeRef(challengeId).set(
        {
          usedAtMs: Date.now(),
          sessionId,
          verifiedVersionCode: appVersionCode,
          appRecognitionVerdict,
          licensingVerdict,
          deviceVerdicts,
          sessionSource: 'tester_prerelease',
          testerEmail: normalizedEmail,
          observedViolations,
          gateMode: policy.gateMode,
        },
        { merge: true },
      );

      const testerCustomToken = await adminAuth.createCustomToken(uid, {
        vok: true,
        vvc: appVersionCode,
        vexp: sessionExpiresAtSeconds,
        vsid: sessionId,
        vsrc: 'tester_prerelease',
        vpre: true,
        vtem: normalizedEmail,
      });

      functions.logger.info('Android tester prerelease session issued', {
        uid,
        email: normalizedEmail,
        sessionId,
        versionCode: appVersionCode,
        latestVersionCode: policy.latestVersionCode,
        gateMode: policy.gateMode,
        observedViolations,
        sessionExpiresAtSeconds,
      });

      return {
        customToken: testerCustomToken,
        sessionExpiresAtSeconds,
        sessionId,
      };
    }

    if (appVersionCode > policy.latestVersionCode) {
      recordGateViolation(policy, observedViolations, {
        reason: 'UNRECOGNIZED_VERSION',
        message: 'Bu surumun sunucuda tanimli bir yayini yok.',
        extra: {
          uid,
          challengeId,
          appVersionCode,
          latestVersionCode: policy.latestVersionCode,
          email: normalizedEmail,
          appRecognitionVerdict,
        },
      });
    }

    if (appRecognitionVerdict !== 'PLAY_RECOGNIZED') {
      recordGateViolation(policy, observedViolations, {
        reason: 'UNRECOGNIZED_VERSION',
        message: 'Bu kurulum resmi Google Play surumu olarak dogrulanamadi.',
        extra: {
          uid,
          challengeId,
          appRecognitionVerdict,
        },
      });
    }

    if (EXPECTED_PLAY_CERT_DIGESTS.length > 0) {
      const hasExpectedDigest = certificateDigests.some((digest: string) =>
        EXPECTED_PLAY_CERT_DIGESTS.includes(digest),
      );

      if (!hasExpectedDigest) {
        recordGateViolation(policy, observedViolations, {
          reason: 'UNRECOGNIZED_VERSION',
          message: 'Uygulama imzasi beklenen Play sertifikasi ile eslesmiyor.',
          extra: {
            uid,
            challengeId,
            certificateDigests,
          },
        });
      }
    }

    if (
      policy.requireLicensedPlayInstall
      && licensingVerdict !== 'LICENSED'
    ) {
      recordGateViolation(policy, observedViolations, {
        reason: 'UNLICENSED',
        message: 'Uygulamanin Google Play lisansi dogrulanamadi.',
        extra: {
          uid,
          challengeId,
          licensingVerdict,
        },
      });
    }

    if (
      policy.requireDeviceIntegrity
      && !deviceVerdicts.includes('MEETS_DEVICE_INTEGRITY')
    ) {
      recordGateViolation(policy, observedViolations, {
        reason: 'DEVICE_INTEGRITY_FAIL',
        message: 'Cihaz butunlugu dogrulanamadi.',
        extra: {
          uid,
          challengeId,
          deviceVerdicts,
        },
      });
    }

    await challengeRef(challengeId).set(
      {
        usedAtMs: Date.now(),
        sessionId,
        verifiedVersionCode: appVersionCode,
        appRecognitionVerdict,
        licensingVerdict,
        deviceVerdicts,
        observedViolations,
        gateMode: policy.gateMode,
      },
      { merge: true },
    );

    const customToken = await adminAuth.createCustomToken(uid, {
      vok: true,
      vvc: appVersionCode,
      vexp: sessionExpiresAtSeconds,
      vsid: sessionId,
      vsrc: 'play_integrity',
      vtem: normalizedEmail,
    });

    functions.logger.info('Android version session issued', {
      uid,
      sessionId,
      versionCode: appVersionCode,
      gateMode: policy.gateMode,
      observedViolations,
      sessionExpiresAtSeconds,
    });

    return {
      customToken,
      sessionExpiresAtSeconds,
      sessionId,
    };
  });
