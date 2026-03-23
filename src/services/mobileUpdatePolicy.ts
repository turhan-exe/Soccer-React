export type AndroidMobileUpdatePolicy = {
  latestVersionCode: number;
  latestVersionName: string;
  minSupportedVersionCode: number;
  forceImmediateUpdate: boolean;
  storeUrl: string;
  blockTitle: string;
  blockMessage: string;
};

const CACHE_KEY = 'fm_android_mobile_update_policy_v1';
const DEFAULT_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.nerbuss.fhsmanager';
const DEFAULT_BLOCK_TITLE = 'Guncelleme gerekli';
const DEFAULT_BLOCK_MESSAGE =
  'Devam etmek icin uygulamanin en son surumunu yukleyin.';

type CachedPolicyEnvelope = {
  cachedAt: number;
  android: AndroidMobileUpdatePolicy;
};

const parsePositiveInt = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return null;
};

const parseBoolean = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback;

const parseString = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

export const normalizeAndroidMobileUpdatePolicy = (
  value: unknown,
): AndroidMobileUpdatePolicy | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Record<string, unknown>;
  const latestVersionCode = parsePositiveInt(source.latestVersionCode);
  const minSupportedVersionCode = parsePositiveInt(source.minSupportedVersionCode);

  if (latestVersionCode === null || minSupportedVersionCode === null) {
    return null;
  }

  const effectiveLatestVersionCode = Math.max(latestVersionCode, minSupportedVersionCode);

  return {
    latestVersionCode: effectiveLatestVersionCode,
    latestVersionName: parseString(source.latestVersionName, String(effectiveLatestVersionCode)),
    minSupportedVersionCode,
    forceImmediateUpdate: parseBoolean(source.forceImmediateUpdate, true),
    storeUrl: parseString(source.storeUrl, DEFAULT_STORE_URL),
    blockTitle: parseString(source.blockTitle, DEFAULT_BLOCK_TITLE),
    blockMessage: parseString(source.blockMessage, DEFAULT_BLOCK_MESSAGE),
  };
};

export const getCachedAndroidMobileUpdatePolicy = (): AndroidMobileUpdatePolicy | null => {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CachedPolicyEnvelope;
    return normalizeAndroidMobileUpdatePolicy(parsed?.android ?? null);
  } catch (error) {
    console.warn('[mobileUpdatePolicy] failed to read cache', error);
    window.localStorage.removeItem(CACHE_KEY);
    return null;
  }
};

export const setCachedAndroidMobileUpdatePolicy = (
  policy: AndroidMobileUpdatePolicy,
): void => {
  try {
    const envelope: CachedPolicyEnvelope = {
      cachedAt: Date.now(),
      android: policy,
    };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
  } catch (error) {
    console.warn('[mobileUpdatePolicy] failed to persist cache', error);
  }
};

export const fetchAndroidMobileUpdatePolicy = async (): Promise<AndroidMobileUpdatePolicy | null> => {
  const [{ doc, getDoc }, { db }] = await Promise.all([
    import('firebase/firestore'),
    import('@/services/firebase'),
  ]);
  const policyDocRef = doc(db, 'public_config', 'mobile_update');
  const snapshot = await getDoc(policyDocRef);
  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data();
  return normalizeAndroidMobileUpdatePolicy(data?.android ?? null);
};

export const fetchAndroidMobileUpdatePolicyWithTimeout = async (
  timeoutMs = 2500,
): Promise<AndroidMobileUpdatePolicy | null> => {
  let timeoutId: number | undefined;

  try {
    return await Promise.race([
      fetchAndroidMobileUpdatePolicy(),
      new Promise<null>((resolve) => {
        timeoutId = window.setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
};

export const shouldForceUpdateForVersion = (
  installedVersionCode: number | null,
  policy: AndroidMobileUpdatePolicy | null,
): boolean => {
  if (!policy || installedVersionCode === null) {
    return false;
  }

  return installedVersionCode < policy.minSupportedVersionCode;
};
