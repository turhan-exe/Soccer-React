import { Capacitor } from '@capacitor/core';

const bootStartedAt =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const isStartupTimingEnabled = (): boolean => {
  if (import.meta.env.DEV || import.meta.env.VITE_STARTUP_DEBUG === '1') {
    return true;
  }

  try {
    return window.localStorage.getItem('fm_startup_debug') === '1';
  } catch {
    return false;
  }
};

export const markStartupTiming = (
  label: string,
  details?: Record<string, unknown>,
): void => {
  if (!isStartupTimingEnabled()) {
    return;
  }

  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const elapsedMs = Math.round(now - bootStartedAt);

  console.info('[startup]', {
    label,
    elapsedMs,
    platform: Capacitor.getPlatform(),
    ...(details ?? {}),
  });
};
