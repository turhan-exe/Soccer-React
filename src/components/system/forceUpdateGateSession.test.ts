import { describe, expect, it } from 'vitest';
import type { GateState } from '@/components/system/forceUpdateGateSession';
import {
  AUTO_START_KEY_TTL_MS,
  GATE_STATE_TTL_MS,
  createPersistedAutoStartKey,
  createPersistedGateState,
  restorePersistedAutoStartKey,
  restorePersistedGateState,
  shouldRunResumeUpdateCheck,
} from '@/components/system/forceUpdateGateSession';
import type { PlayUpdateState } from '@/services/playUpdate';

const FALLBACK_PLAY_STATE: PlayUpdateState = {
  updateAvailable: false,
  immediateAllowed: false,
  inProgress: false,
  source: 'fallback',
};

describe('forceUpdateGateSession', () => {
  it('restores the last stable gate state without replaying stale play state', () => {
    const now = 1_710_000_000_000;
    const persisted = createPersistedGateState(
      {
        phase: 'blocked',
        policy: {
          latestVersionCode: 2026031707,
          latestVersionName: '1.0.7',
          minSupportedVersionCode: 2026031707,
          forceImmediateUpdate: true,
          storeUrl: 'https://play.google.com/store/apps/details?id=com.nerbuss.fhsmanager',
          blockTitle: 'Guncelleme gerekli',
          blockMessage: 'Devam etmek icin guncelle.',
        },
        installedVersionCode: 2026031706,
        installedVersionName: '1.0.6',
        playUpdateState: {
          updateAvailable: true,
          immediateAllowed: true,
          inProgress: true,
          source: 'play',
        },
      } satisfies GateState,
      now,
    );

    const restored = restorePersistedGateState(persisted, FALLBACK_PLAY_STATE, now + 1_000);

    expect(restored).toEqual({
      phase: 'blocked',
      policy: {
        latestVersionCode: 2026031707,
        latestVersionName: '1.0.7',
        minSupportedVersionCode: 2026031707,
        forceImmediateUpdate: true,
        storeUrl: 'https://play.google.com/store/apps/details?id=com.nerbuss.fhsmanager',
        blockTitle: 'Guncelleme gerekli',
        blockMessage: 'Devam etmek icin guncelle.',
      },
      installedVersionCode: 2026031706,
      installedVersionName: '1.0.6',
      playUpdateState: FALLBACK_PLAY_STATE,
    });
  });

  it('does not persist transient checking state', () => {
    const persisted = createPersistedGateState({
      phase: 'checking',
      policy: null,
      installedVersionCode: null,
      installedVersionName: '',
      playUpdateState: FALLBACK_PLAY_STATE,
    });

    expect(persisted).toBeNull();
  });

  it('expires stale gate snapshots and stale auto-start keys', () => {
    const now = 1_710_000_000_000;
    const persistedState = createPersistedGateState(
      {
        phase: 'ready',
        policy: null,
        installedVersionCode: 2026031707,
        installedVersionName: '1.0.7',
        playUpdateState: FALLBACK_PLAY_STATE,
      },
      now,
    );
    const persistedKey = createPersistedAutoStartKey('2026031706:2026031707:immediate:idle', now);

    expect(
      restorePersistedGateState(
        persistedState,
        FALLBACK_PLAY_STATE,
        now + GATE_STATE_TTL_MS + 1,
      ),
    ).toBeNull();
    expect(restorePersistedAutoStartKey(persistedKey, now + AUTO_START_KEY_TTL_MS + 1)).toBeNull();
  });

  it('runs resume checks only after a real background interval and enough cooldown', () => {
    const now = 1_710_000_000_000;

    expect(
      shouldRunResumeUpdateCheck({
        now,
        lastCompletedCheckAt: now - 5 * 60 * 1000,
        lastBackgroundedAt: null,
      }),
    ).toBe(false);

    expect(
      shouldRunResumeUpdateCheck({
        now,
        lastCompletedCheckAt: now - 5 * 60 * 1000,
        lastBackgroundedAt: now - 5_000,
      }),
    ).toBe(false);

    expect(
      shouldRunResumeUpdateCheck({
        now,
        lastCompletedCheckAt: now - 10_000,
        lastBackgroundedAt: now - 30_000,
      }),
    ).toBe(false);

    expect(
      shouldRunResumeUpdateCheck({
        now,
        lastCompletedCheckAt: now - 5 * 60 * 1000,
        lastBackgroundedAt: now - 30_000,
      }),
    ).toBe(true);
  });
});
