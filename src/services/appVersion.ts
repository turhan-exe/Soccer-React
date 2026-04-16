import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export type InstalledAppVersion = {
  packageId: string;
  versionName: string;
  versionCode: number | null;
  build: string;
};

const parseVersionCode = (value: string | null | undefined): number | null => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const APP_VERSION_ASSET_URL = new URL('../../app.version.json', import.meta.url).href;

type BundledAppVersionConfig = {
  versionName?: unknown;
  versionCode?: unknown;
};

const buildInstalledAppVersion = (
  input: Partial<InstalledAppVersion>,
): InstalledAppVersion => ({
  packageId: input.packageId?.trim() || 'web',
  versionName: input.versionName?.trim() || '0.0.0',
  versionCode:
    input.versionCode != null
      ? input.versionCode
      : parseVersionCode(input.build),
  build: input.build?.trim() || '',
});

export const isAndroidNativeApp = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const getBundledAppVersion = async (): Promise<InstalledAppVersion> => {
  const response = await fetch(APP_VERSION_ASSET_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Unable to load bundled app version (${response.status})`);
  }

  const config = (await response.json()) as BundledAppVersionConfig;
  const build = String(config.versionCode ?? '').trim();

  return buildInstalledAppVersion({
    packageId: 'web',
    versionName: typeof config.versionName === 'string' ? config.versionName : '',
    build,
    versionCode: parseVersionCode(build),
  });
};

export const getInstalledAppVersion = async (): Promise<InstalledAppVersion> => {
  if (!Capacitor.isNativePlatform()) {
    return getBundledAppVersion();
  }

  try {
    const info = await CapacitorApp.getInfo();
    return buildInstalledAppVersion({
      packageId: info.id,
      versionName: info.version,
      versionCode: parseVersionCode(info.build),
      build: info.build ?? '',
    });
  } catch (error) {
    return getBundledAppVersion();
  }
};
