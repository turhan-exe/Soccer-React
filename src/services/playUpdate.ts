import { Capacitor, registerPlugin } from '@capacitor/core';

export type PlayUpdateState = {
  updateAvailable: boolean;
  immediateAllowed: boolean;
  inProgress: boolean;
  source: 'play' | 'fallback';
  availableVersionCode?: number;
  updateAvailability?: number;
  installStatus?: number;
  error?: string;
};

type PlayUpdateStartResult = {
  started: boolean;
  error?: string;
};

type PlayUpdatePlugin = {
  getUpdateState(): Promise<PlayUpdateState>;
  startImmediateUpdate(): Promise<PlayUpdateStartResult>;
  openStoreListing(): Promise<void>;
};

const PlayUpdate = registerPlugin<PlayUpdatePlugin>('PlayUpdate');

const fallbackState: PlayUpdateState = {
  updateAvailable: false,
  immediateAllowed: false,
  inProgress: false,
  source: 'fallback',
};

export const isPlayUpdateSupported = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const getPlayUpdateState = async (): Promise<PlayUpdateState> => {
  if (!isPlayUpdateSupported()) {
    return fallbackState;
  }

  try {
    const result = await PlayUpdate.getUpdateState();
    return {
      ...fallbackState,
      ...result,
    };
  } catch (error) {
    console.warn('[playUpdate] getUpdateState failed', error);
    return {
      ...fallbackState,
      error: error instanceof Error ? error.message : 'play_update_state_failed',
    };
  }
};

export const startImmediateUpdate = async (): Promise<PlayUpdateStartResult> => {
  if (!isPlayUpdateSupported()) {
    return { started: false, error: 'unsupported_platform' };
  }

  try {
    return await PlayUpdate.startImmediateUpdate();
  } catch (error) {
    console.warn('[playUpdate] startImmediateUpdate failed', error);
    return {
      started: false,
      error: error instanceof Error ? error.message : 'play_update_start_failed',
    };
  }
};

export const openPlayStoreListing = async (): Promise<void> => {
  if (!isPlayUpdateSupported()) {
    return;
  }

  await PlayUpdate.openStoreListing();
};
