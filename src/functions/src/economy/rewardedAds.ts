import * as functions from 'firebase-functions/v1';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from 'crypto';

import '../_firebase.js';

const db = getFirestore();

const REGION = 'europe-west1';
const SESSION_TTL_MS = 15 * 60 * 1000;
const PLAYER_RENAME_MIN_LENGTH = 2;
const PLAYER_RENAME_MAX_LENGTH = 32;
const PLAYER_RENAME_AD_COOLDOWN_HOURS = 24;
const AD_MOB_VALIDATION_TOKEN = 'admob_validation_ping';
const FINANCE_DEFAULT_BALANCE = 50_000;
const CLUB_BALANCE_REWARD_AMOUNT = 2_000;

const AD_MOB_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';

type RewardPlacement =
  | 'kit_reward'
  | 'club_balance'
  | 'training_finish'
  | 'player_rename'
  | 'youth_cooldown';
type RewardSessionStatus = 'created' | 'verified' | 'claimed';
type KitType = 'energy' | 'morale' | 'health';
type RewardedAdDiagnosticStage = 'init' | 'load' | 'show' | 'ssv' | 'unknown';

type RewardedSessionDoc = {
  uid: string;
  placement: RewardPlacement;
  context: Record<string, unknown>;
  status: RewardSessionStatus;
  createdAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  verifiedAt?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | null;
  claimedAt?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | null;
  transactionId?: string | null;
  adUnitId?: string | null;
  adNetwork?: string | null;
  rewardItem?: string | null;
  rewardAmount?: number | null;
  userId?: string | null;
  claimResult?: Record<string, unknown> | null;
};

type RewardedAdDiagnosticDoc = {
  uid: string;
  placement: RewardPlacement;
  outcome: string;
  sessionId?: string | null;
  context?: Record<string, unknown> | null;
  surfacedMessage?: string | null;
  ad?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  debug?: Record<string, unknown> | null;
  createdAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
};

type VerifyingKeyCache = {
  expiresAt: number;
  keys: Map<number, string>;
};

let verifyingKeyCache: VerifyingKeyCache | null = null;

const KIT_LABELS: Record<KitType, string> = {
  energy: 'Kondisyon Kiti',
  morale: 'Motivasyon Kiti',
  health: 'Saglik Kiti',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateAuth = (context: functions.https.CallableContext): string => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Bu islem icin oturum acman gerekir.');
  }
  return uid;
};

const normalizeString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeOptionalBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

const normalizeOptionalNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const sanitizeJsonValue = (value: unknown, depth = 0): unknown => {
  if (depth > 3) {
    return null;
  }

  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value.trim().slice(0, 200);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeJsonValue(entry, depth + 1));
  }

  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, entry]) => {
      const next = sanitizeJsonValue(entry, depth + 1);
      if (next !== undefined) {
        out[key] = next;
      }
    });
    return out;
  }

  return null;
};

const sanitizePlacement = (value: unknown): RewardPlacement => {
  const placement = normalizeString(value);
  if (
    placement !== 'kit_reward'
    && placement !== 'club_balance'
    && placement !== 'training_finish'
    && placement !== 'player_rename'
    && placement !== 'youth_cooldown'
  ) {
    throw new functions.https.HttpsError('invalid-argument', 'Gecersiz reklam placement gonderildi.');
  }
  return placement;
};

const sanitizeDiagnosticStage = (value: unknown): RewardedAdDiagnosticStage => {
  const stage = normalizeString(value);
  if (stage === 'init' || stage === 'load' || stage === 'show' || stage === 'ssv') {
    return stage;
  }
  return 'unknown';
};

const sanitizeDiagnosticError = (value: unknown): Record<string, unknown> | null => {
  const raw = isRecord(value) ? value : null;
  if (!raw) {
    return null;
  }

  return {
    stage: sanitizeDiagnosticStage(raw.stage),
    code: normalizeOptionalNumber(raw.code),
    domain: normalizeString(raw.domain).slice(0, 120) || null,
    message: normalizeString(raw.message).slice(0, 300) || null,
    responseInfo: normalizeString(raw.responseInfo).slice(0, 4000) || null,
    cause: normalizeString(raw.cause).slice(0, 500) || null,
    consentStatus: normalizeString(raw.consentStatus).slice(0, 64) || null,
    privacyOptionsRequired: normalizeOptionalBoolean(raw.privacyOptionsRequired),
    isTestDevice: normalizeOptionalBoolean(raw.isTestDevice),
    loadedAtMs: normalizeOptionalNumber(raw.loadedAtMs),
    timedOut: normalizeOptionalBoolean(raw.timedOut),
  };
};

const sanitizeDiagnosticDebug = (value: unknown): Record<string, unknown> | null => {
  const raw = isRecord(value) ? value : null;
  if (!raw) {
    return null;
  }

  return {
    sdkReady: normalizeOptionalBoolean(raw.sdkReady),
    mobileAdsInitialized: normalizeOptionalBoolean(raw.mobileAdsInitialized),
    adLoaded: normalizeOptionalBoolean(raw.adLoaded),
    adLoadInFlight: normalizeOptionalBoolean(raw.adLoadInFlight),
    loadedAtMs: normalizeOptionalNumber(raw.loadedAtMs),
    adAgeMs: normalizeOptionalNumber(raw.adAgeMs),
    consentStatus: normalizeString(raw.consentStatus).slice(0, 64) || null,
    privacyOptionsRequired: normalizeOptionalBoolean(raw.privacyOptionsRequired),
    isTestDevice: normalizeOptionalBoolean(raw.isTestDevice),
    admobUseTestIds: normalizeOptionalBoolean(raw.admobUseTestIds),
    appVersionName: normalizeString(raw.appVersionName).slice(0, 64) || null,
    versionCode: normalizeOptionalNumber(raw.versionCode),
    installSource: normalizeString(raw.installSource).slice(0, 120) || null,
    deviceModel: normalizeString(raw.deviceModel).slice(0, 160) || null,
    sdkInt: normalizeOptionalNumber(raw.sdkInt),
    networkType: normalizeString(raw.networkType).slice(0, 64) || null,
    adUnitIdConfigured: normalizeOptionalBoolean(raw.adUnitIdConfigured),
    lastLoadError: sanitizeDiagnosticError(raw.lastLoadError),
    lastShowError: sanitizeDiagnosticError(raw.lastShowError),
  };
};

const sanitizeDiagnosticAd = (value: unknown): Record<string, unknown> | null => {
  const raw = isRecord(value) ? value : null;
  if (!raw) {
    return null;
  }

  const status = normalizeString(raw.status);
  return {
    status:
      status === 'earned' || status === 'dismissed' || status === 'failed'
        ? status
        : 'unknown',
    message: normalizeString(raw.message).slice(0, 300) || null,
    responseCode: normalizeOptionalNumber(raw.responseCode),
    debugMessage: normalizeString(raw.debugMessage).slice(0, 4000) || null,
  };
};

const sanitizeRenameValue = (value: unknown): string => {
  const trimmed = normalizeString(value).replace(/\s+/g, ' ');
  if (trimmed.length < PLAYER_RENAME_MIN_LENGTH) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Oyuncu adi en az ${PLAYER_RENAME_MIN_LENGTH} karakter olmali.`,
    );
  }
  if (trimmed.length > PLAYER_RENAME_MAX_LENGTH) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Oyuncu adi en fazla ${PLAYER_RENAME_MAX_LENGTH} karakter olabilir.`,
    );
  }
  return trimmed;
};

const sanitizeSessionContext = (
  placement: RewardPlacement,
  value: unknown,
): Record<string, unknown> => {
  const raw = isRecord(value) ? value : {};
  const sanitized = sanitizeJsonValue(raw) as Record<string, unknown>;

  if (placement === 'kit_reward') {
    const kitType = normalizeString(sanitized.kitType);
    if (kitType !== 'energy' && kitType !== 'morale' && kitType !== 'health') {
      throw new functions.https.HttpsError('invalid-argument', 'Kit reklaminda gecerli kitType zorunludur.');
    }
    return {
      ...sanitized,
      kitType,
      surface: normalizeString(sanitized.surface),
    };
  }

  if (placement === 'player_rename') {
    const playerId = normalizeString(sanitized.playerId);
    const newName = sanitizeRenameValue(sanitized.newName);
    if (!playerId) {
      throw new functions.https.HttpsError('invalid-argument', 'playerId zorunludur.');
    }
    return {
      ...sanitized,
      playerId,
      newName,
      surface: normalizeString(sanitized.surface),
    };
  }

  return {
    ...sanitized,
    surface: normalizeString(sanitized.surface),
  };
};

const getSessionRef = (sessionId: string) => db.collection('rewardedAdSessions').doc(sessionId);

const getInventoryRef = (uid: string) => db.collection('users').doc(uid).collection('inventory').doc('consumables');

const getActiveTrainingRef = (uid: string) => db.collection('users').doc(uid).collection('training').doc('active');

const getTeamRef = (uid: string) => db.collection('teams').doc(uid);

const getUserRef = (uid: string) => db.collection('users').doc(uid);

const getFinanceRef = (uid: string) => db.collection('finance').doc(uid);

const getFinanceHistoryCollection = (uid: string) => db.collection('finance').doc('history').collection(uid);

const toMillis = (value: unknown): number | null => {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  if (isRecord(value) && typeof value.toMillis === 'function') {
    try {
      return Number(value.toMillis());
    } catch {
      return null;
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return null;
};

const resolveTeamBalance = (
  teamData: { budget?: number; transferBudget?: number } | undefined,
  financeData: { balance?: number } | undefined,
): number => {
  const balanceSource = Number.isFinite(teamData?.transferBudget)
    ? Number(teamData?.transferBudget)
    : Number.isFinite(teamData?.budget)
      ? Number(teamData?.budget)
      : (financeData?.balance ?? FINANCE_DEFAULT_BALANCE);

  return Math.max(0, Math.round(balanceSource));
};

const getExpiryTimestamp = (): FirebaseFirestore.Timestamp =>
  Timestamp.fromMillis(Date.now() + SESSION_TTL_MS);

const base64UrlToBuffer = (value: string): Buffer => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
};

const getVerifyingPublicKeys = async (): Promise<Map<number, string>> => {
  const now = Date.now();
  if (verifyingKeyCache && verifyingKeyCache.expiresAt > now) {
    return verifyingKeyCache.keys;
  }

  const response = await fetch(AD_MOB_KEYS_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`AdMob verifier key fetch failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    keys?: Array<{ keyId?: number; pem?: string }>;
  };

  const keys = new Map<number, string>();
  payload.keys?.forEach((entry) => {
    if (typeof entry.keyId === 'number' && typeof entry.pem === 'string' && entry.pem.trim()) {
      keys.set(entry.keyId, entry.pem.trim());
    }
  });

  if (keys.size === 0) {
    throw new Error('No AdMob verifier keys available.');
  }

  verifyingKeyCache = {
    expiresAt: now + 24 * 60 * 60 * 1000,
    keys,
  };

  return keys;
};

const verifySsvRequest = async (rawQuery: string): Promise<{
  params: URLSearchParams;
  transactionId: string;
  sessionId: string;
  keyId: number;
}> => {
  const signatureMarker = '&signature=';
  const keyMarker = '&key_id=';
  const signatureIndex = rawQuery.indexOf(signatureMarker);
  if (signatureIndex === -1) {
    throw new Error('signature parameter missing');
  }

  const keyIndex = rawQuery.indexOf(keyMarker, signatureIndex + 1);
  if (keyIndex === -1) {
    throw new Error('key_id parameter missing');
  }

  const dataToVerify = rawQuery.substring(0, signatureIndex);
  const signatureRaw = rawQuery.substring(signatureIndex + signatureMarker.length, keyIndex);
  const keyIdRaw = rawQuery.substring(keyIndex + keyMarker.length);
  const keyId = Number.parseInt(keyIdRaw, 10);
  if (!Number.isFinite(keyId)) {
    throw new Error('invalid key_id');
  }

  const keys = await getVerifyingPublicKeys();
  const publicKeyPem = keys.get(keyId);
  if (!publicKeyPem) {
    throw new Error(`unknown key_id:${keyId}`);
  }

  const signatureBuffer = base64UrlToBuffer(decodeURIComponent(signatureRaw));
  const isValid = verifySignature(
    'sha256',
    Buffer.from(dataToVerify, 'utf8'),
    createPublicKey(publicKeyPem),
    signatureBuffer,
  );

  if (!isValid) {
    throw new Error('ssv_signature_invalid');
  }

  const params = new URLSearchParams(rawQuery);
  const transactionId = normalizeString(params.get('transaction_id'));
  const sessionId = normalizeString(params.get('custom_data'));
  if (!transactionId) {
    throw new Error('transaction_id missing');
  }
  if (!sessionId) {
    throw new Error('custom_data missing');
  }

  return {
    params,
    transactionId,
    sessionId,
    keyId,
  };
};

const ensureSessionClaimable = (
  sessionId: string,
  uid: string,
  session: RewardedSessionDoc,
) => {
  if (session.uid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Bu reklam oturumu size ait degil.');
  }

  const expiresAt = session.expiresAt instanceof Timestamp ? session.expiresAt.toMillis() : null;
  if (expiresAt !== null && expiresAt < Date.now()) {
    throw new functions.https.HttpsError('deadline-exceeded', 'Reklam oturumu zaman asimina ugradi.');
  }

  if (!session.placement) {
    throw new functions.https.HttpsError('failed-precondition', `Reklam oturumu bozuk: ${sessionId}`);
  }
};

const sanitizeStoredKits = (value: unknown): Record<KitType, number> => {
  const raw = isRecord(value) ? value : {};
  const sanitize = (entry: unknown) => {
    const numeric = typeof entry === 'number' ? entry : Number(entry);
    if (!Number.isFinite(numeric)) {
      return 0;
    }
    return Math.max(0, Math.floor(numeric));
  };
  return {
    energy: sanitize(raw.energy),
    morale: sanitize(raw.morale),
    health: sanitize(raw.health),
  };
};

const claimKitReward = async (
  uid: string,
  sessionRef: FirebaseFirestore.DocumentReference,
  session: RewardedSessionDoc,
): Promise<Record<string, unknown>> => {
  const kitType = normalizeString(session.context.kitType) as KitType;
  const label = KIT_LABELS[kitType];

  return db.runTransaction(async (tx) => {
    const [freshSessionSnap, inventorySnap] = await Promise.all([
      tx.get(sessionRef),
      tx.get(getInventoryRef(uid)),
    ]);

    const freshSession = freshSessionSnap.data() as RewardedSessionDoc | undefined;
    if (!freshSession) {
      throw new functions.https.HttpsError('not-found', 'Reklam oturumu bulunamadi.');
    }
    if (freshSession.status === 'claimed') {
      return (freshSession.claimResult ?? {
        type: 'kit_reward',
        kitType,
        amount: 1,
        label,
      }) as Record<string, unknown>;
    }
    if (freshSession.status !== 'verified') {
      throw new functions.https.HttpsError('failed-precondition', 'Odul henuz dogrulanmadi.');
    }

    const currentKits = inventorySnap.exists
      ? sanitizeStoredKits(inventorySnap.get('kits'))
      : { energy: 0, morale: 0, health: 0 };
    const nextKits = {
      ...currentKits,
      [kitType]: currentKits[kitType] + 1,
    };
    const reward = {
      type: 'kit_reward',
      kitType,
      amount: 1,
      label,
    };

    tx.set(
      getInventoryRef(uid),
      {
        kits: nextKits,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      sessionRef,
      {
        status: 'claimed',
        claimedAt: FieldValue.serverTimestamp(),
        claimResult: reward,
      },
      { merge: true },
    );

    return reward;
  });
};

const claimTrainingReward = async (
  uid: string,
  sessionRef: FirebaseFirestore.DocumentReference,
): Promise<Record<string, unknown>> => {
  const reductionPercent = 25;

  return db.runTransaction(async (tx) => {
    const [freshSessionSnap, trainingSnap] = await Promise.all([
      tx.get(sessionRef),
      tx.get(getActiveTrainingRef(uid)),
    ]);

    const freshSession = freshSessionSnap.data() as RewardedSessionDoc | undefined;
    if (!freshSession) {
      throw new functions.https.HttpsError('not-found', 'Reklam oturumu bulunamadi.');
    }
    if (freshSession.status === 'claimed') {
      return (freshSession.claimResult ?? { type: 'training_finish', completed: true }) as Record<string, unknown>;
    }
    if (freshSession.status !== 'verified') {
      throw new functions.https.HttpsError('failed-precondition', 'Odul henuz dogrulanmadi.');
    }
    if (!trainingSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Aktif antrenman bulunamadi.');
    }

    const startAt = trainingSnap.get('startAt');
    const startedAtMs = toMillis(startAt);
    const currentDuration = Number(trainingSnap.get('durationSeconds') ?? 0);
    const elapsedSeconds = startedAtMs == null
      ? 0
      : Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
    const remainingSeconds = Math.max(currentDuration - elapsedSeconds, 0);
    const reductionSeconds = Math.max(
      1,
      Math.floor(remainingSeconds * (reductionPercent / 100)),
    );
    const nextDurationSeconds = Math.max(
      elapsedSeconds,
      currentDuration - reductionSeconds,
    );
    const nextRemainingSeconds = Math.max(nextDurationSeconds - elapsedSeconds, 0);
    const reward = {
      type: 'training_finish',
      completed: nextRemainingSeconds <= 0,
      reductionPercent,
      reductionSeconds: Math.min(reductionSeconds, remainingSeconds),
      durationSeconds: nextDurationSeconds,
      remainingSeconds: nextRemainingSeconds,
    };

    tx.set(
      getActiveTrainingRef(uid),
      {
        durationSeconds: nextDurationSeconds,
        endsAt: Timestamp.fromMillis(startedAtMs == null
          ? Date.now()
          : startedAtMs + nextDurationSeconds * 1000),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      sessionRef,
      {
        status: 'claimed',
        claimedAt: FieldValue.serverTimestamp(),
        claimResult: reward,
      },
      { merge: true },
    );

    return reward;
  });
};

const claimClubBalanceReward = async (
  uid: string,
  sessionRef: FirebaseFirestore.DocumentReference,
): Promise<Record<string, unknown>> => {
  const financeRef = getFinanceRef(uid);
  const teamRef = getTeamRef(uid);
  const historyRef = getFinanceHistoryCollection(uid).doc();

  return db.runTransaction(async (tx) => {
    const [freshSessionSnap, financeSnap, teamSnap] = await Promise.all([
      tx.get(sessionRef),
      tx.get(financeRef),
      tx.get(teamRef),
    ]);

    const freshSession = freshSessionSnap.data() as RewardedSessionDoc | undefined;
    if (!freshSession) {
      throw new functions.https.HttpsError('not-found', 'Reklam oturumu bulunamadi.');
    }

    const financeData = (financeSnap.data() as { balance?: number } | undefined) ?? undefined;
    const teamData =
      (teamSnap.data() as { budget?: number; transferBudget?: number } | undefined) ?? undefined;
    const currentBalance = resolveTeamBalance(teamData, financeData);

    if (freshSession.status === 'claimed') {
      return (freshSession.claimResult ?? {
        type: 'club_balance',
        amount: CLUB_BALANCE_REWARD_AMOUNT,
        balance: currentBalance,
      }) as Record<string, unknown>;
    }
    if (freshSession.status !== 'verified') {
      throw new functions.https.HttpsError('failed-precondition', 'Odul henuz dogrulanmadi.');
    }

    const nextBalance = currentBalance + CLUB_BALANCE_REWARD_AMOUNT;
    const reward = {
      type: 'club_balance',
      amount: CLUB_BALANCE_REWARD_AMOUNT,
      balance: nextBalance,
    };

    tx.set(
      financeRef,
      {
        balance: nextBalance,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      teamRef,
      {
        budget: nextBalance,
        transferBudget: nextBalance,
      },
      { merge: true },
    );
    tx.set(historyRef, {
      id: historyRef.id,
      type: 'income',
      category: 'ad',
      amount: CLUB_BALANCE_REWARD_AMOUNT,
      source: 'RewardedAd',
      note: 'Reklam odulu',
      timestamp: FieldValue.serverTimestamp(),
    });
    tx.set(
      sessionRef,
      {
        status: 'claimed',
        claimedAt: FieldValue.serverTimestamp(),
        claimResult: reward,
      },
      { merge: true },
    );

    return reward;
  });
};

const claimYouthCooldownReward = async (
  uid: string,
  sessionRef: FirebaseFirestore.DocumentReference,
): Promise<Record<string, unknown>> => {
  const reductionPercent = 15;

  return db.runTransaction(async (tx) => {
    const [freshSessionSnap, userSnap] = await Promise.all([
      tx.get(sessionRef),
      tx.get(getUserRef(uid)),
    ]);

    const freshSession = freshSessionSnap.data() as RewardedSessionDoc | undefined;
    if (!freshSession) {
      throw new functions.https.HttpsError('not-found', 'Reklam oturumu bulunamadi.');
    }
    if (freshSession.status === 'claimed') {
      return (freshSession.claimResult ?? {
        type: 'youth_cooldown',
        reductionPercent,
        reductionMs: 0,
        nextGenerateAtMs: Date.now(),
        ready: true,
      }) as Record<string, unknown>;
    }
    if (freshSession.status !== 'verified') {
      throw new functions.https.HttpsError('failed-precondition', 'Odul henuz dogrulanmadi.');
    }

    const nowMs = Date.now();
    const nextGenerateAtMs = toMillis(userSnap.get('youth.nextGenerateAt')) ?? nowMs;
    const remainingMs = Math.max(nextGenerateAtMs - nowMs, 0);
    const reductionMs = remainingMs <= 0
      ? 0
      : Math.max(60 * 1000, Math.floor(remainingMs * (reductionPercent / 100)));
    const targetMs = remainingMs <= 0
      ? nowMs
      : Math.max(nowMs, nextGenerateAtMs - reductionMs);
    const reward = {
      type: 'youth_cooldown',
      reductionPercent,
      reductionMs: Math.min(reductionMs, remainingMs),
      nextGenerateAtMs: targetMs,
      ready: targetMs <= nowMs,
    };

    tx.set(
      getUserRef(uid),
      {
        youth: {
          nextGenerateAt: Timestamp.fromMillis(targetMs),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      sessionRef,
      {
        status: 'claimed',
        claimedAt: FieldValue.serverTimestamp(),
        claimResult: reward,
      },
      { merge: true },
    );

    return reward;
  });
};

const claimPlayerRenameReward = async (
  uid: string,
  sessionRef: FirebaseFirestore.DocumentReference,
  session: RewardedSessionDoc,
): Promise<Record<string, unknown>> => {
  const playerId = normalizeString(session.context.playerId);
  const newName = sanitizeRenameValue(session.context.newName);

  return db.runTransaction(async (tx) => {
    const [freshSessionSnap, teamSnap] = await Promise.all([
      tx.get(sessionRef),
      tx.get(getTeamRef(uid)),
    ]);

    const freshSession = freshSessionSnap.data() as RewardedSessionDoc | undefined;
    if (!freshSession) {
      throw new functions.https.HttpsError('not-found', 'Reklam oturumu bulunamadi.');
    }
    if (freshSession.status === 'claimed') {
      return (freshSession.claimResult ?? {
        type: 'player_rename',
        playerId,
        newName,
      }) as Record<string, unknown>;
    }
    if (freshSession.status !== 'verified') {
      throw new functions.https.HttpsError('failed-precondition', 'Odul henuz dogrulanmadi.');
    }
    if (!teamSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Takim bulunamadi.');
    }

    const teamData = teamSnap.data() as { ownerUid?: string; players?: Array<Record<string, unknown>> };
    if (teamData.ownerUid !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'Takim sahipligi dogrulanamadi.');
    }

    const players = Array.isArray(teamData.players) ? [...teamData.players] : [];
    const playerIndex = players.findIndex((player) => normalizeString(player.id) === playerId);
    if (playerIndex === -1) {
      throw new functions.https.HttpsError('failed-precondition', 'Oyuncu bulunamadi.');
    }

    const now = Date.now();
    const nextAvailableAt = new Date(
      now + PLAYER_RENAME_AD_COOLDOWN_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const player = players[playerIndex];
    const renameState = isRecord(player.rename) ? player.rename : {};
    players[playerIndex] = {
      ...player,
      name: newName,
      rename: {
        ...renameState,
        lastUpdatedAt: new Date(now).toISOString(),
        lastMethod: 'ad',
        adAvailableAt: nextAvailableAt,
      },
    };

    const reward = {
      type: 'player_rename',
      playerId,
      newName,
      adAvailableAt: nextAvailableAt,
    };

    tx.set(getTeamRef(uid), { players }, { merge: true });
    tx.set(
      sessionRef,
      {
        status: 'claimed',
        claimedAt: FieldValue.serverTimestamp(),
        claimResult: reward,
      },
      { merge: true },
    );

    return reward;
  });
};

export const createRewardedAdSession = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const uid = validateAuth(context);
    const placement = sanitizePlacement(data?.placement);
    const sessionContext = sanitizeSessionContext(placement, data?.context);
    const sessionRef = db.collection('rewardedAdSessions').doc();
    const expiresAt = getExpiryTimestamp();

    const session: RewardedSessionDoc = {
      uid,
      placement,
      context: sessionContext,
      status: 'created',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      verifiedAt: null,
      claimedAt: null,
      transactionId: null,
      adUnitId: null,
      adNetwork: null,
      rewardItem: null,
      rewardAmount: null,
      userId: uid,
      claimResult: null,
    };

    await sessionRef.set(session);

    return {
      sessionId: sessionRef.id,
      placement,
      expiresAtIso: expiresAt.toDate().toISOString(),
    };
  });

export const claimRewardedAdReward = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const uid = validateAuth(context);
    const sessionId = normalizeString(data?.sessionId);
    if (!sessionId) {
      throw new functions.https.HttpsError('invalid-argument', 'sessionId zorunludur.');
    }

    const sessionRef = getSessionRef(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Reklam oturumu bulunamadi.');
    }

    const session = sessionSnap.data() as RewardedSessionDoc;
    ensureSessionClaimable(sessionId, uid, session);

    if (session.status === 'claimed') {
      return {
        status: 'already_claimed' as const,
        sessionId,
        placement: session.placement,
        reward: session.claimResult ?? {},
      };
    }

    if (session.status !== 'verified') {
      return {
        status: 'pending_verification' as const,
        sessionId,
        placement: session.placement,
      };
    }

    let reward: Record<string, unknown>;
    if (session.placement === 'kit_reward') {
      reward = await claimKitReward(uid, sessionRef, session);
    } else if (session.placement === 'club_balance') {
      reward = await claimClubBalanceReward(uid, sessionRef);
    } else if (session.placement === 'training_finish') {
      reward = await claimTrainingReward(uid, sessionRef);
    } else if (session.placement === 'youth_cooldown') {
      reward = await claimYouthCooldownReward(uid, sessionRef);
    } else {
      reward = await claimPlayerRenameReward(uid, sessionRef, session);
    }

    return {
      status: 'claimed' as const,
      sessionId,
      placement: session.placement,
      reward,
    };
  });

export const logRewardedAdDiagnostic = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const uid = validateAuth(context);
    const placement = sanitizePlacement(data?.placement);
    const outcome = normalizeString(data?.outcome).slice(0, 64) || 'unknown';
    const sessionId = normalizeString(data?.sessionId) || null;
    const surfacedMessage = normalizeString(data?.surfacedMessage).slice(0, 300) || null;
    const diagnosticContext = sanitizeJsonValue(data?.context) as Record<string, unknown> | null;
    const doc: RewardedAdDiagnosticDoc = {
      uid,
      placement,
      outcome,
      sessionId,
      context: diagnosticContext,
      surfacedMessage,
      ad: sanitizeDiagnosticAd(data?.ad),
      error: sanitizeDiagnosticError(data?.error),
      debug: sanitizeDiagnosticDebug(data?.debug),
      createdAt: FieldValue.serverTimestamp(),
    };

    await db.collection('rewardedAdDiagnostics').add(doc);

    return { ok: true };
  });

export const admobRewardedSsv = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const originalUrl = req.originalUrl || req.url || '';
    const queryIndex = originalUrl.indexOf('?');
    if (queryIndex === -1) {
      res.status(200).json({
        ok: true,
        accepted: false,
        reason: 'validation_ping',
      });
      return;
    }

    const rawQuery = originalUrl.substring(queryIndex + 1);
    const rawParams = new URLSearchParams(rawQuery);
    const validationUserId = normalizeString(rawParams.get('user_id'));
    const validationCustomData = normalizeString(rawParams.get('custom_data'));
    if (validationUserId === AD_MOB_VALIDATION_TOKEN || validationCustomData === AD_MOB_VALIDATION_TOKEN) {
      res.status(200).json({
        ok: true,
        accepted: false,
        reason: 'validation_ping',
      });
      return;
    }

    if (!rawQuery.includes('signature=') || !rawQuery.includes('key_id=')) {
      res.status(200).json({
        ok: true,
        accepted: false,
        reason: 'validation_ping',
      });
      return;
    }

    // AdMob's callback URL verifier may send synthetic requests that include
    // signature fields but omit the real transaction/session identifiers.
    // Those should not fail verification, but we also must not grant rewards.
    if (!normalizeString(rawParams.get('transaction_id')) || !normalizeString(rawParams.get('custom_data'))) {
      res.status(200).json({
        ok: true,
        accepted: false,
        reason: 'validation_ping',
      });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).json({ ok: false, message: 'Method not allowed' });
      return;
    }

    try {
      const verification = await verifySsvRequest(rawQuery);
      const sessionRef = getSessionRef(verification.sessionId);
      const sessionSnap = await sessionRef.get();

      if (!sessionSnap.exists) {
        functions.logger.warn('AdMob SSV arrived for unknown rewarded session', {
          sessionId: verification.sessionId,
          transactionId: verification.transactionId,
        });
        res.status(200).json({ ok: true, accepted: false, reason: 'unknown_session' });
        return;
      }

      const session = sessionSnap.data() as RewardedSessionDoc;
      const params = verification.params;
      const ssvUserId = normalizeString(params.get('user_id'));
      if (ssvUserId && ssvUserId !== session.uid) {
        functions.logger.warn('AdMob SSV user mismatch', {
          sessionId: verification.sessionId,
          transactionId: verification.transactionId,
          sessionUid: session.uid,
          ssvUserId,
        });
        res.status(200).json({ ok: true, accepted: false, reason: 'user_mismatch' });
        return;
      }

      const transactionHash = createHash('sha256')
        .update(`${verification.transactionId}:${verification.sessionId}`)
        .digest('hex');

      await db.runTransaction(async (tx) => {
        const freshSessionSnap = await tx.get(sessionRef);
        const freshSession = freshSessionSnap.data() as RewardedSessionDoc | undefined;
        if (!freshSession) {
          return;
        }

        if (freshSession.status === 'verified' || freshSession.status === 'claimed') {
          tx.set(
            sessionRef,
            {
              transactionId: verification.transactionId,
              transactionHash,
              verifiedAt: freshSession.verifiedAt ?? FieldValue.serverTimestamp(),
              adUnitId: normalizeString(params.get('ad_unit')) || freshSession.adUnitId || null,
              adNetwork: normalizeString(params.get('ad_network')) || freshSession.adNetwork || null,
              rewardItem: normalizeString(params.get('reward_item')) || freshSession.rewardItem || null,
              rewardAmount: Number(params.get('reward_amount') ?? freshSession.rewardAmount ?? 0) || 0,
              userId: ssvUserId || freshSession.userId || null,
            },
            { merge: true },
          );
          return;
        }

        tx.set(
          sessionRef,
          {
            status: 'verified',
            verifiedAt: FieldValue.serverTimestamp(),
            transactionId: verification.transactionId,
            transactionHash,
            adUnitId: normalizeString(params.get('ad_unit')) || null,
            adNetwork: normalizeString(params.get('ad_network')) || null,
            rewardItem: normalizeString(params.get('reward_item')) || null,
            rewardAmount: Number(params.get('reward_amount') ?? 0) || 0,
            userId: ssvUserId || null,
          },
          { merge: true },
        );
      });

      res.status(200).json({
        ok: true,
        accepted: true,
        sessionId: verification.sessionId,
        transactionId: verification.transactionId,
      });
    } catch (error) {
      functions.logger.error('AdMob rewarded SSV verification failed', {
        message: error instanceof Error ? error.message : String(error),
        method: req.method,
        rawQueryPreview: rawQuery.slice(0, 512),
      });
      res.status(400).json({
        ok: false,
        message: error instanceof Error ? error.message : 'verification_failed',
      });
    }
  });
