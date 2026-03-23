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

export const isAndroidNativeApp = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const getInstalledAppVersion = async (): Promise<InstalledAppVersion> => {
  const info = await CapacitorApp.getInfo();
  return {
    packageId: info.id,
    versionName: info.version ?? '0.0.0',
    versionCode: parseVersionCode(info.build),
    build: info.build ?? '',
  };
};
