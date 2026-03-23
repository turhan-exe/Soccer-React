import { describe, expect, it } from 'vitest';
import {
  normalizeAndroidMobileUpdatePolicy,
  shouldForceUpdateForVersion,
} from '@/services/mobileUpdatePolicy';

describe('mobileUpdatePolicy', () => {
  it('normalizes a valid android policy payload', () => {
    const policy = normalizeAndroidMobileUpdatePolicy({
      latestVersionCode: 2026031706,
      latestVersionName: '1.0.6',
      minSupportedVersionCode: 2026031706,
      forceImmediateUpdate: true,
      storeUrl: 'https://play.google.com/store/apps/details?id=com.nerbuss.fhsmanager',
      blockTitle: 'Guncelleme gerekli',
      blockMessage: 'Devam etmek icin guncelle.',
    });

    expect(policy).toEqual({
      latestVersionCode: 2026031706,
      latestVersionName: '1.0.6',
      minSupportedVersionCode: 2026031706,
      forceImmediateUpdate: true,
      storeUrl: 'https://play.google.com/store/apps/details?id=com.nerbuss.fhsmanager',
      blockTitle: 'Guncelleme gerekli',
      blockMessage: 'Devam etmek icin guncelle.',
    });
  });

  it('rejects invalid payloads', () => {
    expect(normalizeAndroidMobileUpdatePolicy(null)).toBeNull();
    expect(
      normalizeAndroidMobileUpdatePolicy({
        latestVersionCode: 'abc',
        minSupportedVersionCode: 1,
      }),
    ).toBeNull();
  });

  it('blocks only versions below minimum supported code', () => {
    const policy = normalizeAndroidMobileUpdatePolicy({
      latestVersionCode: 2026031706,
      latestVersionName: '1.0.6',
      minSupportedVersionCode: 2026031706,
    });

    expect(shouldForceUpdateForVersion(2026031705, policy)).toBe(true);
    expect(shouldForceUpdateForVersion(2026031706, policy)).toBe(false);
    expect(shouldForceUpdateForVersion(2026031707, policy)).toBe(false);
  });
});
