import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { markBootVisualReadyMock, capacitorState } = vi.hoisted(() => ({
  markBootVisualReadyMock: vi.fn(),
  capacitorState: {
    native: true,
    platform: 'android',
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitorState.native,
    getPlatform: () => capacitorState.platform,
  },
  registerPlugin: () => ({
    markBootVisualReady: markBootVisualReadyMock,
  }),
}));

import {
  hasMarkedBootVisualReady,
  markBootVisualReadyOnce,
  resetBootVisualReadyForTests,
  shouldDelayBootVisualStabilization,
} from '@/services/uiState';

describe('uiState', () => {
  beforeEach(() => {
    capacitorState.native = true;
    capacitorState.platform = 'android';
    markBootVisualReadyMock.mockReset();
    markBootVisualReadyMock.mockResolvedValue(undefined);
    resetBootVisualReadyForTests();
  });

  afterEach(() => {
    resetBootVisualReadyForTests();
  });

  it('calls the native boot visual marker only once per session', async () => {
    await expect(markBootVisualReadyOnce()).resolves.toBe(true);
    await expect(markBootVisualReadyOnce()).resolves.toBe(false);

    expect(markBootVisualReadyMock).toHaveBeenCalledTimes(1);
    expect(hasMarkedBootVisualReady()).toBe(true);
  });

  it('stops delaying vip render after the boot visual latch is marked', async () => {
    expect(
      shouldDelayBootVisualStabilization({
        isHydrated: true,
        isVipReady: true,
      }),
    ).toBe(true);

    await markBootVisualReadyOnce();

    expect(
      shouldDelayBootVisualStabilization({
        isHydrated: true,
        isVipReady: true,
      }),
    ).toBe(false);
  });

  it('marks the latch immediately on non-android platforms', async () => {
    capacitorState.native = false;
    capacitorState.platform = 'web';

    await expect(markBootVisualReadyOnce()).resolves.toBe(true);

    expect(markBootVisualReadyMock).not.toHaveBeenCalled();
    expect(hasMarkedBootVisualReady()).toBe(true);
  });
});
