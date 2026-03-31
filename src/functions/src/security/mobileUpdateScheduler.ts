import * as functions from 'firebase-functions/v1';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

import '../_firebase.js';

const db = getFirestore();
const TZ = 'Europe/Istanbul';

type GateMode = 'observe' | 'enforce';

type PendingActivation = {
  activateAtMs: number;
  latestVersionCode: number;
  latestVersionName: string;
  minSupportedVersionCode: number;
  gateMode: GateMode;
  forceImmediateUpdate: boolean;
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

const readPendingActivation = (value: unknown): PendingActivation | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Record<string, unknown>;
  const activateAtMs = asInt(source.activateAtMs);
  const latestVersionCode = asInt(source.latestVersionCode);
  const minSupportedVersionCode = asInt(source.minSupportedVersionCode);

  if (
    activateAtMs === null
    || latestVersionCode === null
    || minSupportedVersionCode === null
    || activateAtMs <= 0
    || latestVersionCode <= 0
    || minSupportedVersionCode <= 0
  ) {
    return null;
  }

  const effectiveLatestVersionCode = Math.max(
    latestVersionCode,
    minSupportedVersionCode,
  );
  const latestVersionName =
    asString(source.latestVersionName) || String(effectiveLatestVersionCode);

  return {
    activateAtMs,
    latestVersionCode: effectiveLatestVersionCode,
    latestVersionName,
    minSupportedVersionCode,
    gateMode: source.gateMode === 'observe' ? 'observe' : 'enforce',
    forceImmediateUpdate: asBoolean(source.forceImmediateUpdate, true),
  };
};

export const applyPendingMobileUpdatePolicies = functions
  .region('europe-west1')
  .pubsub.schedule('* * * * *')
  .timeZone(TZ)
  .onRun(async () => {
    const docRef = db.collection('public_config').doc('mobile_update');
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data() ?? {};
    const android =
      data.android && typeof data.android === 'object'
        ? (data.android as Record<string, unknown>)
        : null;

    if (!android) {
      return null;
    }

    const pending = readPendingActivation(android.pendingActivation);
    if (!pending) {
      return null;
    }

    const now = Date.now();
    if (pending.activateAtMs > now) {
      return null;
    }

    await docRef.update({
      'android.latestVersionCode': pending.latestVersionCode,
      'android.latestVersionName': pending.latestVersionName,
      'android.minSupportedVersionCode': pending.minSupportedVersionCode,
      'android.gateMode': pending.gateMode,
      'android.forceImmediateUpdate': pending.forceImmediateUpdate,
      'android.lastAutoActivatedAtMs': now,
      'android.lastAutoActivatedVersionCode': pending.latestVersionCode,
      'android.pendingActivation': FieldValue.delete(),
    });

    functions.logger.info('Applied pending mobile update activation', {
      activateAtMs: pending.activateAtMs,
      latestVersionCode: pending.latestVersionCode,
      latestVersionName: pending.latestVersionName,
      minSupportedVersionCode: pending.minSupportedVersionCode,
      gateMode: pending.gateMode,
    });

    return null;
  });
