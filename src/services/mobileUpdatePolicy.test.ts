import { describe, expect, it } from 'vitest';
import {
  normalizeAndroidMobileUpdatePolicy,
  shouldBlockForAndroidUpdate,
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
      gateMode: 'observe',
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

  it('does not block when store reports no newer version than the installed build', () => {
    const policy = normalizeAndroidMobileUpdatePolicy({
      latestVersionCode: 2026031708,
      latestVersionName: '1.0.8',
      minSupportedVersionCode: 2026031708,
      gateMode: 'enforce',
    });

    expect(
      shouldBlockForAndroidUpdate(2026031707, policy, {
        updateAvailable: false,
        inProgress: false,
        availableVersionCode: 2026031707,
      }),
    ).toBe(false);
  });

  it('blocks when the installed build is below minimum and store has a newer version', () => {
    const policy = normalizeAndroidMobileUpdatePolicy({
      latestVersionCode: 2026031708,
      latestVersionName: '1.0.8',
      minSupportedVersionCode: 2026031708,
      gateMode: 'enforce',
    });

    expect(
      shouldBlockForAndroidUpdate(2026031707, policy, {
        updateAvailable: true,
        inProgress: false,
        availableVersionCode: 2026031708,
      }),
    ).toBe(true);
  });

  it('enforces the current production target exactly at 2026032801', () => {
    const policy = normalizeAndroidMobileUpdatePolicy({
      latestVersionCode: 2026032801,
      latestVersionName: '1.0.17',
      minSupportedVersionCode: 2026032801,
      gateMode: 'enforce',
    });

    expect(shouldForceUpdateForVersion(2026032800, policy)).toBe(true);
    expect(shouldForceUpdateForVersion(2026032801, policy)).toBe(false);
    expect(shouldForceUpdateForVersion(2026032802, policy)).toBe(false);
  });

  it('lets 2026032801 pass the gate because it is the required build', () => {
    const policy = normalizeAndroidMobileUpdatePolicy({
      latestVersionCode: 2026032801,
      latestVersionName: '1.0.17',
      minSupportedVersionCode: 2026032801,
      gateMode: 'enforce',
    });

    expect(
      shouldBlockForAndroidUpdate(2026032801, policy, {
        updateAvailable: false,
        inProgress: false,
        availableVersionCode: 2026032801,
      }),
    ).toBe(false);
  });
});
