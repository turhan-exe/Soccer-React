import { beforeEach, describe, expect, it, vi } from 'vitest';

const rewardedAdsMocks = vi.hoisted(() => ({
  getMatchEntryAccessStatus: vi.fn(),
  getRewardedAdFailureMessage: vi.fn((input: unknown) => {
    if (input instanceof Error && input.message.trim()) {
      return input.message.trim();
    }
    return 'Reklam simdilik gosterilemiyor. Biraz sonra tekrar dene.';
  }),
  getRewardedAdsUnavailableMessage: vi.fn(() => 'Odullu reklam yalnizca Android uygulamasinda kullanilabilir.'),
  isRewardedAdsSupported: vi.fn(() => true),
  runRewardedAdFlow: vi.fn(),
}));

vi.mock('@/services/rewardedAds', () => rewardedAdsMocks);

import {
  MATCH_ENTRY_COMPLETION_REQUIRED_MESSAGE,
  MATCH_ENTRY_PENDING_MESSAGE,
  ensureMatchEntryAccess,
  getMatchEntryAccessOutcomeMessage,
} from '@/services/matchEntryAccess';

describe('matchEntryAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rewardedAdsMocks.isRewardedAdsSupported.mockReturnValue(true);
    rewardedAdsMocks.getMatchEntryAccessStatus.mockResolvedValue({
      active: false,
      expiresAtIso: null,
    });
  });

  it('reuses an existing active grant without showing an ad', async () => {
    rewardedAdsMocks.getMatchEntryAccessStatus.mockResolvedValue({
      active: true,
      expiresAtIso: '2026-04-19T12:10:00.000Z',
    });

    const result = await ensureMatchEntryAccess({
      userId: 'u1',
      matchKind: 'league',
      targetId: 'fx-1',
      fixtureId: 'fx-1',
      surface: 'fixtures',
    });

    expect(result).toEqual({
      outcome: 'granted',
      reused: true,
      expiresAtIso: '2026-04-19T12:10:00.000Z',
    });
    expect(rewardedAdsMocks.runRewardedAdFlow).not.toHaveBeenCalled();
  });

  it('blocks live entry when the rewarded ad is dismissed', async () => {
    rewardedAdsMocks.runRewardedAdFlow.mockResolvedValue({
      outcome: 'dismissed',
      ad: null,
    });

    const result = await ensureMatchEntryAccess({
      userId: 'u1',
      matchKind: 'friendly',
      targetId: 'req-1',
      requestId: 'req-1',
      surface: 'friendly_match',
    });

    expect(result).toEqual({
      outcome: 'dismissed',
      ad: null,
      expiresAtIso: null,
    });
  });

  it('continues when a new grant becomes active after ad completion', async () => {
    rewardedAdsMocks.getMatchEntryAccessStatus
      .mockResolvedValueOnce({
        active: false,
        expiresAtIso: null,
      })
      .mockResolvedValueOnce({
        active: true,
        expiresAtIso: '2026-04-19T12:10:00.000Z',
      });
    rewardedAdsMocks.runRewardedAdFlow.mockResolvedValue({
      outcome: 'claimed',
      ad: null,
    });

    const result = await ensureMatchEntryAccess({
      userId: 'u1',
      matchKind: 'league',
      targetId: 'fx-1',
      fixtureId: 'fx-1',
      matchId: 'm1',
      surface: 'mainmenu',
    });

    expect(result).toEqual({
      outcome: 'granted',
      reused: false,
      expiresAtIso: '2026-04-19T12:10:00.000Z',
    });
  });

  it('surfaces explicit dismissal, pending, and thrown messages', () => {
    expect(getMatchEntryAccessOutcomeMessage({ outcome: 'dismissed', expiresAtIso: null })).toBe(
      MATCH_ENTRY_COMPLETION_REQUIRED_MESSAGE,
    );
    expect(
      getMatchEntryAccessOutcomeMessage({ outcome: 'pending_verification', expiresAtIso: null }),
    ).toBe(MATCH_ENTRY_PENDING_MESSAGE);
    expect(getMatchEntryAccessOutcomeMessage(new Error('Odullu reklam yalnizca Android uygulamasinda kullanilabilir.'))).toBe(
      'Odullu reklam yalnizca Android uygulamasinda kullanilabilir.',
    );
  });
});
