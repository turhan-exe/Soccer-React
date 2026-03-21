import { Capacitor, registerPlugin } from '@capacitor/core';
import { httpsCallable } from 'firebase/functions';

import { functions } from '@/services/firebase';

export type RewardPlacement = 'kit_reward' | 'training_finish' | 'player_rename';

export type RewardedAdSurface =
  | 'mainmenu'
  | 'topbar'
  | 'training'
  | 'team_planning'
  | 'settings';

export type RewardedSessionContext = {
  surface?: RewardedAdSurface;
  kitType?: 'energy' | 'morale' | 'health';
  playerId?: string;
  newName?: string;
  trainingId?: string;
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

export type NativeRewardedAdResult = {
  status: 'earned' | 'dismissed' | 'failed';
  message?: string;
  responseCode?: number;
  debugMessage?: string;
};

type RewardedAdsPlugin = {
  initialize(): Promise<{ ok: boolean; consentStatus?: string; privacyOptionsRequired?: boolean }>;
  showRewardedAd(payload: {
    userId: string;
    customData: string;
  }): Promise<NativeRewardedAdResult>;
  showPrivacyOptionsForm(): Promise<{ shown: boolean; status?: string }>;
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

let initializePromise: Promise<void> | null = null;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

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

export async function showRewardedAd(payload: {
  userId: string;
  customData: string;
}): Promise<NativeRewardedAdResult> {
  if (!isRewardedAdsSupported()) {
    throw new Error(getRewardedAdsUnavailableMessage());
  }

  await initializeRewardedAds();
  return RewardedAds.showRewardedAd(payload);
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

  if (adResult.status !== 'earned') {
    return {
      outcome: adResult.status,
      ad: adResult,
      sessionId: session.sessionId,
      placement: payload.placement,
    };
  }

  const retryDelays = [400, 700, 1000, 1300, 1700, 2200, 2600];
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

  return {
    outcome: 'pending_verification',
    ad: adResult,
    sessionId: session.sessionId,
    placement: payload.placement,
  };
}
