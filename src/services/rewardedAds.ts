import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { httpsCallable } from 'firebase/functions';

import { functions } from '@/services/firebase';

export type RewardPlacement =
  | 'kit_reward'
  | 'club_balance'
  | 'training_finish'
  | 'player_rename'
  | 'youth_cooldown'
  | 'match_entry';

export type MatchEntryKind = 'friendly' | 'league' | 'champions';

export type RewardedAdSurface =
  | 'mainmenu'
  | 'topbar'
  | 'training'
  | 'team_planning'
  | 'settings'
  | 'youth'
  | 'friendly_match'
  | 'fixtures'
  | 'match_watcher';

export type RewardedSessionContext = {
  surface?: RewardedAdSurface;
  kitType?: 'energy' | 'morale' | 'health';
  playerId?: string;
  playerIds?: string[];
  trainingIds?: string[];
  newName?: string;
  trainingId?: string;
  matchKind?: MatchEntryKind;
  targetId?: string;
  fixtureId?: string;
  requestId?: string;
  matchId?: string;
  competitionType?: string;
  [key: string]: unknown;
};

export type CreateRewardedAdSessionPayload = {
  placement: RewardPlacement;
  context?: RewardedSessionContext;
};

export type CreateRewardedAdSessionResponse = {
  sessionId: string;
  placement: RewardPlacement;
  expiresAtIso: string;
};

export type RewardClaimResult =
  | {
      status: 'claimed' | 'already_claimed';
      sessionId: string;
      placement: RewardPlacement;
      reward: Record<string, unknown>;
    }
  | {
      status: 'pending_verification';
      sessionId: string;
      placement: RewardPlacement;
    };

export type MatchEntryAccessStatusPayload = {
  matchKind: MatchEntryKind;
  targetId: string;
};

export type MatchEntryAccessStatusResponse = {
  active: boolean;
  expiresAtIso: string | null;
};

export type RewardedAdStage = 'init' | 'load' | 'show' | 'ssv' | 'unknown';

export type RewardedAdErrorDetails = {
  stage: RewardedAdStage;
  code: number | null;
  domain: string | null;
  message: string | null;
  responseInfo: string | null;
  cause: string | null;
  consentStatus: string | null;
  privacyOptionsRequired: boolean;
  isTestDevice: boolean;
  loadedAtMs: number | null;
  timedOut: boolean;
};

export type RewardedAdsDebugInfo = {
  sdkReady: boolean;
  mobileAdsInitialized: boolean;
  adLoaded: boolean;
  adLoadInFlight: boolean;
  loadedAtMs: number | null;
  adAgeMs: number | null;
  consentStatus: string | null;
  privacyOptionsRequired: boolean;
  isTestDevice: boolean;
  admobUseTestIds: boolean;
  appVersionName: string | null;
  versionCode: number | null;
  installSource: string | null;
  deviceModel: string | null;
  sdkInt: number | null;
  networkType: string | null;
  adUnitIdConfigured: boolean;
  lastLoadError: RewardedAdErrorDetails | null;
  lastShowError: RewardedAdErrorDetails | null;
};

export type NativeRewardedAdResult = {
  status: 'earned' | 'dismissed' | 'failed';
  message?: string;
  responseCode?: number;
  debugMessage?: string;
  error?: RewardedAdErrorDetails | null;
  debug?: RewardedAdsDebugInfo | null;
};

export type RewardedAdLifecycleEvent = {
  status: 'showing' | 'dismissed' | 'earned' | 'failed';
  error?: RewardedAdErrorDetails | null;
  debug?: RewardedAdsDebugInfo | null;
};

type RewardedAdsPlugin = {
  initialize(): Promise<{
    ok: boolean;
    consentStatus?: string;
    privacyOptionsRequired?: boolean;
    debug?: RewardedAdsDebugInfo | null;
  }>;
  showRewardedAd(payload: {
    userId: string;
    customData: string;
  }): Promise<NativeRewardedAdResult>;
  showPrivacyOptionsForm(): Promise<{ shown: boolean; status?: string }>;
  getRewardedAdsDebugInfo(): Promise<RewardedAdsDebugInfo>;
  openAdInspector(): Promise<{
    opened: boolean;
    error?: RewardedAdErrorDetails | null;
    debug?: RewardedAdsDebugInfo | null;
  }>;
  addListener(
    eventName: 'rewardedAdLifecycle',
    listenerFunc: (event: RewardedAdLifecycleEvent) => void,
  ): Promise<PluginListenerHandle>;
};

type RewardedAdDiagnosticPayload = {
  placement: RewardPlacement;
  outcome: 'failed' | 'pending_verification';
  sessionId?: string;
  context?: RewardedSessionContext;
  surfacedMessage?: string;
  ad?: NativeRewardedAdResult | null;
  error?: RewardedAdErrorDetails | null;
  debug?: RewardedAdsDebugInfo | null;
};

type RewardedFlowResult =
  | {
      outcome: 'claimed' | 'already_claimed';
      claim: Extract<RewardClaimResult, { status: 'claimed' | 'already_claimed' }>;
      ad: NativeRewardedAdResult;
    }
  | {
      outcome: 'dismissed' | 'failed' | 'pending_verification';
      ad: NativeRewardedAdResult;
      sessionId: string;
      placement: RewardPlacement;
    };

const RewardedAds = registerPlugin<RewardedAdsPlugin>('RewardedAds');

const createRewardedAdSessionCallable = httpsCallable<
  CreateRewardedAdSessionPayload,
  CreateRewardedAdSessionResponse
>(functions, 'createRewardedAdSession');

const claimRewardedAdRewardCallable = httpsCallable<{ sessionId: string }, RewardClaimResult>(
  functions,
  'claimRewardedAdReward',
);

const getMatchEntryAccessStatusCallable = httpsCallable<
  MatchEntryAccessStatusPayload,
  MatchEntryAccessStatusResponse
>(functions, 'getMatchEntryAccessStatus');

const logRewardedAdDiagnosticCallable = httpsCallable<RewardedAdDiagnosticPayload, { ok: boolean }>(
  functions,
  'logRewardedAdDiagnostic',
);

let initializePromise: Promise<void> | null = null;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const toTrimmedString = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

const toNullableNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const toNullableBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const createSyntheticRewardedAdError = (
  stage: RewardedAdStage,
  message: string,
  overrides: Partial<RewardedAdErrorDetails> = {},
): RewardedAdErrorDetails => ({
  stage,
  code: overrides.code ?? null,
  domain: overrides.domain ?? 'rewarded_ads_service',
  message,
  responseInfo: overrides.responseInfo ?? null,
  cause: overrides.cause ?? null,
  consentStatus: overrides.consentStatus ?? null,
  privacyOptionsRequired: overrides.privacyOptionsRequired ?? false,
  isTestDevice: overrides.isTestDevice ?? false,
  loadedAtMs: overrides.loadedAtMs ?? null,
  timedOut: overrides.timedOut ?? false,
});

const parseLegacyRewardedAdError = (
  message: string,
  fallbackStage: RewardedAdStage = 'unknown',
): RewardedAdErrorDetails | null => {
  const normalized = message.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('rewarded_load_failed:')) {
    const [, rawCode = '', ...rest] = normalized.split(':');
    const code = toNullableNumber(rawCode);
    return createSyntheticRewardedAdError('load', rest.join(':') || normalized, {
      code,
      domain: 'com.google.android.gms.ads',
    });
  }

  if (normalized === 'rewarded_load_timeout') {
    return createSyntheticRewardedAdError('load', normalized, { timedOut: true });
  }

  if (
    normalized === 'rewarded_ad_not_ready'
    || normalized === 'rewarded_ad_already_showing'
    || normalized === 'activity_unavailable'
  ) {
    return createSyntheticRewardedAdError('show', normalized);
  }

  if (
    normalized === 'admob_app_id_missing'
    || normalized === 'rewarded_ad_unit_missing'
    || normalized === 'consent_info_update_failed'
  ) {
    return createSyntheticRewardedAdError('init', normalized);
  }

  return createSyntheticRewardedAdError(fallbackStage, normalized);
};

export const parseRewardedAdErrorLike = (
  value: unknown,
  fallbackStage: RewardedAdStage = 'unknown',
): RewardedAdErrorDetails | null => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return parseLegacyRewardedAdError(value, fallbackStage);
  }

  if (value instanceof Error) {
    const parsed = parseLegacyRewardedAdError(value.message, fallbackStage);
    if (parsed) {
      return parsed;
    }
    return createSyntheticRewardedAdError(fallbackStage, value.message || 'rewarded_ad_failed');
  }

  if (!isRecord(value)) {
    return null;
  }

  const stage = toTrimmedString(value.stage) || fallbackStage;
  const code = toNullableNumber(value.code);
  const message = toTrimmedString(value.message) || null;
  const domain = toTrimmedString(value.domain) || null;
  const responseInfo = toTrimmedString(value.responseInfo) || null;
  const cause = toTrimmedString(value.cause) || null;
  const consentStatus = toTrimmedString(value.consentStatus) || null;
  const privacyOptionsRequired = toNullableBoolean(value.privacyOptionsRequired) ?? false;
  const isTestDevice = toNullableBoolean(value.isTestDevice) ?? false;
  const loadedAtMs = toNullableNumber(value.loadedAtMs);
  const timedOut = toNullableBoolean(value.timedOut) ?? false;

  if (!message && code === null && !domain) {
    const nestedMessage = toTrimmedString(value.error);
    return nestedMessage ? parseLegacyRewardedAdError(nestedMessage, fallbackStage) : null;
  }

  return {
    stage:
      stage === 'init' || stage === 'load' || stage === 'show' || stage === 'ssv'
        ? stage
        : fallbackStage,
    code,
    domain,
    message,
    responseInfo,
    cause,
    consentStatus,
    privacyOptionsRequired,
    isTestDevice,
    loadedAtMs,
    timedOut,
  };
};

const normalizeRewardedAdsDebugInfo = (value: unknown): RewardedAdsDebugInfo | null => {
  if (!isRecord(value)) {
    return null;
  }

  return {
    sdkReady: toNullableBoolean(value.sdkReady) ?? false,
    mobileAdsInitialized: toNullableBoolean(value.mobileAdsInitialized) ?? false,
    adLoaded: toNullableBoolean(value.adLoaded) ?? false,
    adLoadInFlight: toNullableBoolean(value.adLoadInFlight) ?? false,
    loadedAtMs: toNullableNumber(value.loadedAtMs),
    adAgeMs: toNullableNumber(value.adAgeMs),
    consentStatus: toTrimmedString(value.consentStatus) || null,
    privacyOptionsRequired: toNullableBoolean(value.privacyOptionsRequired) ?? false,
    isTestDevice: toNullableBoolean(value.isTestDevice) ?? false,
    admobUseTestIds: toNullableBoolean(value.admobUseTestIds) ?? false,
    appVersionName: toTrimmedString(value.appVersionName) || null,
    versionCode: toNullableNumber(value.versionCode),
    installSource: toTrimmedString(value.installSource) || null,
    deviceModel: toTrimmedString(value.deviceModel) || null,
    sdkInt: toNullableNumber(value.sdkInt),
    networkType: toTrimmedString(value.networkType) || null,
    adUnitIdConfigured: toNullableBoolean(value.adUnitIdConfigured) ?? false,
    lastLoadError: parseRewardedAdErrorLike(value.lastLoadError, 'load'),
    lastShowError: parseRewardedAdErrorLike(value.lastShowError, 'show'),
  };
};

const normalizeNativeRewardedAdResult = (value: unknown): NativeRewardedAdResult => {
  const record = isRecord(value) ? value : {};
  const statusRaw = toTrimmedString(record.status);
  const error =
    parseRewardedAdErrorLike(record.error, 'unknown')
    ?? parseRewardedAdErrorLike(record.message, 'unknown');
  const debug = normalizeRewardedAdsDebugInfo(record.debug);

  const status: NativeRewardedAdResult['status'] =
    statusRaw === 'earned' || statusRaw === 'dismissed' || statusRaw === 'failed'
      ? statusRaw
      : error
        ? 'failed'
        : 'dismissed';

  return {
    status,
    message: toTrimmedString(record.message) || error?.message || undefined,
    responseCode: toNullableNumber(record.responseCode) ?? error?.code ?? undefined,
    debugMessage: toTrimmedString(record.debugMessage) || error?.responseInfo || undefined,
    error,
    debug,
  };
};

const getDiagnosticError = (
  ad: NativeRewardedAdResult | null | undefined,
  fallback: RewardedAdErrorDetails | null = null,
): RewardedAdErrorDetails | null => ad?.error ?? fallback;

const logRewardedAdDiagnosticSafe = async (payload: RewardedAdDiagnosticPayload): Promise<void> => {
  try {
    await logRewardedAdDiagnosticCallable(payload);
  } catch (error) {
    console.warn('[rewardedAds] diagnostic log failed', error);
  }
};

const buildFailedAdResult = (
  error: RewardedAdErrorDetails,
  debug: RewardedAdsDebugInfo | null = null,
): NativeRewardedAdResult => ({
  status: 'failed',
  message: error.message ?? 'rewarded_ad_failed',
  responseCode: error.code ?? undefined,
  debugMessage: error.responseInfo ?? undefined,
  error,
  debug,
});

export function getRewardedAdFailureMessage(input: unknown): string {
  const error =
    parseRewardedAdErrorLike((isRecord(input) ? input.error : null) ?? input, 'unknown')
    ?? (isRecord(input) ? parseRewardedAdErrorLike(input.message, 'unknown') : null);
  const normalizedMessage = (error?.message ?? '').trim().toLowerCase();
  const normalizedCause = (error?.cause ?? '').trim().toLowerCase();

  if (!error) {
    return 'Reklam simdilik baslatilamadi. Biraz sonra tekrar dene.';
  }

  if (normalizedMessage.includes('gecersiz reklam placement')) {
    return 'Sunucu bu reklam odulunu henuz tanimiyor. Biraz sonra tekrar dene.';
  }

  if (normalizedMessage.includes('match format') || normalizedCause.includes('match format')) {
    return 'Reklam birimi yanlis formatta ayarlanmis. Biraz sonra tekrar dene.';
  }

  if (error.timedOut || error.message === 'rewarded_load_timeout') {
    return 'Reklam yaniti gecikti. Internet baglantisini kontrol edip tekrar dene.';
  }

  if (error.stage === 'load' && error.code === 2) {
    return 'Reklam yuklenemedi. Internet baglantisini kontrol edip tekrar dene.';
  }

  if (error.stage === 'load' && error.code === 3) {
    return 'Su anda uygun reklam bulunamadi. Biraz sonra tekrar dene.';
  }

  if (error.stage === 'load' && error.code === 0) {
    return 'Reklam yuklenemedi. VPN, Private DNS veya reklam engelleyici varsa kapatip tekrar dene.';
  }

  if (error.stage === 'ssv') {
    return 'Reklam odulu dogrulanamadi. Biraz sonra yeniden dene.';
  }

  if (error.message === 'rewarded_ad_already_showing') {
    return 'Baska bir reklam istegi zaten devam ediyor.';
  }

  if (error.message === 'activity_unavailable') {
    return 'Reklam ekrani hazir degil. Uygulamaya donup tekrar dene.';
  }

  if (error.message === 'rewarded_ad_not_ready') {
    return 'Reklam henuz hazir degil. Biraz sonra tekrar dene.';
  }

  if (error.stage === 'show') {
    return 'Reklam acilamadi. Uygulamayi tekrar acip yeniden dene.';
  }

  if (error.stage === 'init') {
    return 'Reklam servisi henuz hazir degil. Biraz sonra tekrar dene.';
  }

  return 'Reklam simdilik gosterilemiyor. Biraz sonra tekrar dene.';
}

export function isRewardedAdsSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function getRewardedAdsUnavailableMessage(): string {
  return 'Odullu reklam yalnizca Android uygulamasinda kullanilabilir.';
}

export async function initializeRewardedAds(): Promise<void> {
  if (!isRewardedAdsSupported()) {
    return;
  }

  if (!initializePromise) {
    initializePromise = RewardedAds.initialize()
      .then(() => undefined)
      .catch((error) => {
        initializePromise = null;
        throw error;
      });
  }

  await initializePromise;
}

export async function showRewardedAdsPrivacyOptions(): Promise<boolean> {
  if (!isRewardedAdsSupported()) {
    return false;
  }

  await initializeRewardedAds();
  const response = await RewardedAds.showPrivacyOptionsForm();
  return Boolean(response.shown);
}

export async function getRewardedAdsDebugInfo(): Promise<RewardedAdsDebugInfo | null> {
  if (!isRewardedAdsSupported()) {
    return null;
  }

  try {
    await initializeRewardedAds();
  } catch {
    // Best effort debug info fetch.
  }

  const response = await RewardedAds.getRewardedAdsDebugInfo();
  return normalizeRewardedAdsDebugInfo(response);
}

export async function openRewardedAdsAdInspector(): Promise<{
  opened: boolean;
  error?: RewardedAdErrorDetails | null;
  debug?: RewardedAdsDebugInfo | null;
}> {
  if (!isRewardedAdsSupported()) {
    throw new Error(getRewardedAdsUnavailableMessage());
  }

  const response = await RewardedAds.openAdInspector();
  return {
    opened: Boolean(response.opened),
    error: parseRewardedAdErrorLike(response.error, 'show'),
    debug: normalizeRewardedAdsDebugInfo(response.debug),
  };
}

export async function addRewardedAdLifecycleListener(
  listener: (event: RewardedAdLifecycleEvent) => void,
): Promise<PluginListenerHandle | null> {
  if (!isRewardedAdsSupported()) {
    return null;
  }

  return RewardedAds.addListener('rewardedAdLifecycle', (event) => {
    listener({
      status:
        event.status === 'showing'
        || event.status === 'dismissed'
        || event.status === 'earned'
        || event.status === 'failed'
          ? event.status
          : 'failed',
      error: parseRewardedAdErrorLike(event.error, 'unknown'),
      debug: normalizeRewardedAdsDebugInfo(event.debug),
    });
  });
}

export async function createRewardedAdSession(
  payload: CreateRewardedAdSessionPayload,
): Promise<CreateRewardedAdSessionResponse> {
  const response = await createRewardedAdSessionCallable(payload);
  return response.data;
}

export async function claimRewardedAdReward(sessionId: string): Promise<RewardClaimResult> {
  const response = await claimRewardedAdRewardCallable({ sessionId });
  return response.data;
}

export async function getMatchEntryAccessStatus(
  payload: MatchEntryAccessStatusPayload,
): Promise<MatchEntryAccessStatusResponse> {
  const response = await getMatchEntryAccessStatusCallable(payload);
  return response.data;
}

export async function showRewardedAd(payload: {
  userId: string;
  customData: string;
}): Promise<NativeRewardedAdResult> {
  if (!isRewardedAdsSupported()) {
    throw new Error(getRewardedAdsUnavailableMessage());
  }

  try {
    await initializeRewardedAds();
  } catch (error) {
    return buildFailedAdResult(
      parseRewardedAdErrorLike(error, 'init')
        ?? createSyntheticRewardedAdError('init', 'rewarded_init_failed'),
    );
  }

  try {
    const result = await RewardedAds.showRewardedAd(payload);
    return normalizeNativeRewardedAdResult(result);
  } catch (error) {
    return buildFailedAdResult(
      parseRewardedAdErrorLike(error, 'unknown')
        ?? createSyntheticRewardedAdError('unknown', 'rewarded_ad_failed'),
    );
  }
}

export async function runRewardedAdFlow(payload: {
  userId: string;
  placement: RewardPlacement;
  context?: RewardedSessionContext;
}): Promise<RewardedFlowResult> {
  if (!isRewardedAdsSupported()) {
    throw new Error(getRewardedAdsUnavailableMessage());
  }

  const session = await createRewardedAdSession({
    placement: payload.placement,
    context: payload.context,
  });

  const adResult = await showRewardedAd({
    userId: payload.userId,
    customData: session.sessionId,
  });

  if (adResult.status === 'failed') {
    await logRewardedAdDiagnosticSafe({
      placement: payload.placement,
      outcome: 'failed',
      sessionId: session.sessionId,
      context: payload.context,
      surfacedMessage: getRewardedAdFailureMessage(adResult),
      ad: adResult,
      error: getDiagnosticError(adResult),
      debug: adResult.debug ?? null,
    });

    return {
      outcome: 'failed',
      ad: adResult,
      sessionId: session.sessionId,
      placement: payload.placement,
    };
  }

  if (adResult.status !== 'earned') {
    return {
      outcome: adResult.status,
      ad: adResult,
      sessionId: session.sessionId,
      placement: payload.placement,
    };
  }

  const retryDelays = [400, 700, 1000, 1300, 1700, 2200, 2600];
  try {
    for (const delayMs of retryDelays) {
      const claim = await claimRewardedAdReward(session.sessionId);
      if (claim.status === 'claimed' || claim.status === 'already_claimed') {
        return {
          outcome: claim.status,
          claim,
          ad: adResult,
        };
      }
      await wait(delayMs);
    }

    const finalClaim = await claimRewardedAdReward(session.sessionId);
    if (finalClaim.status === 'claimed' || finalClaim.status === 'already_claimed') {
      return {
        outcome: finalClaim.status,
        claim: finalClaim,
        ad: adResult,
      };
    }
  } catch (error) {
    const ssvError =
      parseRewardedAdErrorLike(error, 'ssv')
      ?? createSyntheticRewardedAdError('ssv', 'reward_claim_failed');
    const failedAdResult = buildFailedAdResult(ssvError, adResult.debug ?? null);

    await logRewardedAdDiagnosticSafe({
      placement: payload.placement,
      outcome: 'failed',
      sessionId: session.sessionId,
      context: payload.context,
      surfacedMessage: getRewardedAdFailureMessage(ssvError),
      ad: failedAdResult,
      error: ssvError,
      debug: adResult.debug ?? null,
    });

    return {
      outcome: 'failed',
      ad: failedAdResult,
      sessionId: session.sessionId,
      placement: payload.placement,
    };
  }

  const verificationError = createSyntheticRewardedAdError('ssv', 'reward_verification_timeout');
  await logRewardedAdDiagnosticSafe({
    placement: payload.placement,
    outcome: 'pending_verification',
    sessionId: session.sessionId,
    context: payload.context,
    surfacedMessage: getRewardedAdFailureMessage(verificationError),
    ad: {
      ...adResult,
      error: verificationError,
      debug: adResult.debug ?? null,
    },
    error: verificationError,
    debug: adResult.debug ?? null,
  });

  return {
    outcome: 'pending_verification',
    ad: {
      ...adResult,
      error: verificationError,
      debug: adResult.debug ?? null,
    },
    sessionId: session.sessionId,
    placement: payload.placement,
  };
}
