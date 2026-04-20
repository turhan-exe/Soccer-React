import { Capacitor, registerPlugin } from '@capacitor/core';

type UiStatePlugin = {
  markBootVisualReady: () => Promise<void>;
};

const UiState = registerPlugin<UiStatePlugin>('UiState');

let bootVisualReadyMarked = false;

export const hasMarkedBootVisualReady = (): boolean => bootVisualReadyMarked;

export const shouldDelayBootVisualStabilization = ({
  isHydrated,
  isVipReady,
}: {
  isHydrated: boolean;
  isVipReady: boolean;
}): boolean => isHydrated && isVipReady && !bootVisualReadyMarked;

export const markBootVisualReadyOnce = async (): Promise<boolean> => {
  if (bootVisualReadyMarked) {
    return false;
  }

  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    bootVisualReadyMarked = true;
    return true;
  }

  try {
    await UiState.markBootVisualReady();
    bootVisualReadyMarked = true;
    return true;
  } catch (error) {
    console.warn('[UiState] failed to mark boot visual ready', error);
    return false;
  }
};

export const resetBootVisualReadyForTests = (): void => {
  bootVisualReadyMarked = false;
};
