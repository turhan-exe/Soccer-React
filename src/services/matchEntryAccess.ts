import {
  getMatchEntryAccessStatus,
  getRewardedAdFailureMessage,
  getRewardedAdsUnavailableMessage,
  isRewardedAdsSupported,
  runRewardedAdFlow,
  type MatchEntryKind,
  type NativeRewardedAdResult,
  type RewardedAdSurface,
} from '@/services/rewardedAds';

const MATCH_ENTRY_ACCESS_POLL_DELAYS_MS = [0, 400, 700, 1000, 1300, 1700, 2200, 2600];

export const MATCH_ENTRY_COMPLETION_REQUIRED_MESSAGE =
  'Canli maca girmek icin reklami tamamlamalisin.';
export const MATCH_ENTRY_PENDING_MESSAGE =
  'Reklam dogrulaniyor. Mac henuz acilamadi.';

export type MatchEntryAccessRequest = {
  userId: string;
  matchKind: MatchEntryKind;
  targetId: string;
  fixtureId?: string;
  requestId?: string;
  matchId?: string;
  competitionType?: string;
  surface: RewardedAdSurface;
};

export type MatchEntryAccessResult =
  | {
      outcome: 'granted';
      reused: boolean;
      expiresAtIso: string | null;
    }
  | {
      outcome: 'dismissed' | 'failed' | 'pending_verification';
      ad?: NativeRewardedAdResult;
      expiresAtIso: string | null;
    };

const wait = (ms: number) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

async function pollMatchEntryAccessStatus(input: {
  matchKind: MatchEntryKind;
  targetId: string;
}): Promise<{ active: boolean; expiresAtIso: string | null }> {
  for (const delayMs of MATCH_ENTRY_ACCESS_POLL_DELAYS_MS) {
    if (delayMs > 0) {
      await wait(delayMs);
    }

    const status = await getMatchEntryAccessStatus({
      matchKind: input.matchKind,
      targetId: input.targetId,
    });

    if (status.active) {
      return status;
    }
  }

  return {
    active: false,
    expiresAtIso: null,
  };
}

export function getMatchEntryAccessOutcomeMessage(
  result: MatchEntryAccessResult | NativeRewardedAdResult | unknown,
): string {
  if (
    result &&
    typeof result === 'object' &&
    'outcome' in result &&
    (result.outcome === 'dismissed' || result.outcome === 'pending_verification')
  ) {
    return result.outcome === 'dismissed'
      ? MATCH_ENTRY_COMPLETION_REQUIRED_MESSAGE
      : MATCH_ENTRY_PENDING_MESSAGE;
  }

  if (result instanceof Error && result.message.trim()) {
    return result.message.trim();
  }

  if (typeof result === 'string' && result.trim()) {
    return result.trim();
  }

  if (
    result &&
    typeof result === 'object' &&
    'message' in result &&
    typeof result.message === 'string' &&
    result.message.trim()
  ) {
    return result.message.trim();
  }

  return getRewardedAdFailureMessage(result);
}

export async function ensureMatchEntryAccess(
  input: MatchEntryAccessRequest,
): Promise<MatchEntryAccessResult> {
  if (!input.userId.trim()) {
    throw new Error('Bu islem icin oturum acman gerekir.');
  }

  if (!isRewardedAdsSupported()) {
    throw new Error(getRewardedAdsUnavailableMessage());
  }

  const existing = await getMatchEntryAccessStatus({
    matchKind: input.matchKind,
    targetId: input.targetId,
  });
  if (existing.active) {
    return {
      outcome: 'granted',
      reused: true,
      expiresAtIso: existing.expiresAtIso,
    };
  }

  const adResult = await runRewardedAdFlow({
    userId: input.userId,
    placement: 'match_entry',
    context: {
      surface: input.surface,
      matchKind: input.matchKind,
      targetId: input.targetId,
      fixtureId: input.fixtureId,
      requestId: input.requestId,
      matchId: input.matchId,
      competitionType: input.competitionType,
    },
  });

  if (adResult.outcome === 'dismissed' || adResult.outcome === 'failed') {
    return {
      outcome: adResult.outcome,
      ad: adResult.ad,
      expiresAtIso: null,
    };
  }

  const activated = await pollMatchEntryAccessStatus({
    matchKind: input.matchKind,
    targetId: input.targetId,
  });
  if (activated.active) {
    return {
      outcome: 'granted',
      reused: false,
      expiresAtIso: activated.expiresAtIso,
    };
  }

  return {
    outcome: 'pending_verification',
    ad: adResult.ad,
    expiresAtIso: null,
  };
}
