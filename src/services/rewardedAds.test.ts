import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  },
  registerPlugin: () => ({
    initialize: vi.fn(),
    showRewardedAd: vi.fn(),
    showPrivacyOptionsForm: vi.fn(),
    getRewardedAdsDebugInfo: vi.fn(),
    openAdInspector: vi.fn(),
    addListener: vi.fn(),
  }),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn(),
}));

vi.mock('@/services/firebase', () => ({
  functions: {},
}));

import {
  getRewardedAdFailureMessage,
  parseRewardedAdErrorLike,
} from '@/services/rewardedAds';

describe('rewardedAds helpers', () => {
  it('parses legacy load failures into structured load errors', () => {
    const parsed = parseRewardedAdErrorLike('rewarded_load_failed:0:internal_error');

    expect(parsed).toMatchObject({
      stage: 'load',
      code: 0,
      domain: 'com.google.android.gms.ads',
      message: 'internal_error',
      timedOut: false,
    });
  });

  it('returns a timeout-specific user message', () => {
    const message = getRewardedAdFailureMessage({
      error: {
        stage: 'load',
        code: null,
        domain: 'rewarded_ads_plugin',
        message: 'rewarded_load_timeout',
        responseInfo: null,
        cause: null,
        consentStatus: 'OBTAINED',
        privacyOptionsRequired: false,
        isTestDevice: false,
        loadedAtMs: null,
        timedOut: true,
      },
    });

    expect(message).toContain('gecikti');
    expect(message).toContain('Internet');
  });

  it('maps internal load errors to a device-network troubleshooting hint', () => {
    const message = getRewardedAdFailureMessage({
      error: {
        stage: 'load',
        code: 0,
        domain: 'com.google.android.gms.ads',
        message: 'internal_error',
        responseInfo: null,
        cause: null,
        consentStatus: 'OBTAINED',
        privacyOptionsRequired: false,
        isTestDevice: false,
        loadedAtMs: null,
        timedOut: false,
      },
    });

    expect(message).toContain('VPN');
    expect(message).toContain('Private DNS');
  });

  it('surfaces stale backend placement errors explicitly', () => {
    const message = getRewardedAdFailureMessage(new Error('Gecersiz reklam placement gonderildi.'));

    expect(message).toContain('Sunucu');
    expect(message).toContain('tanimiyor');
  });

  it('surfaces AdMob format mismatch errors explicitly', () => {
    const message = getRewardedAdFailureMessage({
      error: {
        stage: 'load',
        code: 3,
        domain: 'com.google.android.gms.ads',
        message: "Ad unit doesn't match format.",
        responseInfo: null,
        cause: null,
        consentStatus: 'OBTAINED',
        privacyOptionsRequired: false,
        isTestDevice: true,
        loadedAtMs: null,
        timedOut: false,
      },
    });

    expect(message).toContain('yanlis formatta');
  });
});
