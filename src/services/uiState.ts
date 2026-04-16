import { Capacitor, registerPlugin } from '@capacitor/core';

type UiStatePlugin = {
  markBootVisualReady: () => Promise<void>;
};

const UiState = registerPlugin<UiStatePlugin>('UiState');

export const markBootVisualReady = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return;
  }

  try {
    await UiState.markBootVisualReady();
  } catch (error) {
    console.warn('[UiState] failed to mark boot visual ready', error);
  }
};
