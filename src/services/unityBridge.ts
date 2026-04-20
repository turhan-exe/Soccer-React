import { Capacitor, registerPlugin } from '@capacitor/core';

export type UnityBridgeEventType =
  | 'ready'
  | 'connected'
  | 'connection_failed'
  | 'match_ended'
  | 'closed'
  | 'error';

export type UnityLaunchPayload = {
  homeId: string;
  awayId: string;
  matchId?: string;
  joinTicket?: string;
  mode?: 'friendly' | 'league';
  role?: 'spectator' | 'player';
};

export type UnityBridgeEvent = {
  type: UnityBridgeEventType | string;
  message?: string;
  code?: string;
  matchId?: string;
  serverIp?: string;
  serverPort?: number;
  reason?: string;
};

export type UnityLaunchResult = {
  ok: boolean;
  nativeLaunch: boolean;
  alreadyActive?: boolean;
  bridgeMode?: string;
  activityClass?: string;
};

export type UnityLaunchStatus = {
  ok: boolean;
  active: boolean;
  inFlight?: boolean;
  hostActive?: boolean;
  embeddedActivityActive?: boolean;
  pendingShellReturn?: boolean;
  activeActivityClass?: string | null;
  activeMatchId?: string | null;
  hostMatchId?: string | null;
  hostServerIp?: string | null;
  hostServerPort?: number | null;
  launchGeneration?: number | null;
};

type UnityMatchPluginOpenPayload = {
  serverIp: string;
  serverPort: number;
  matchId?: string;
  joinTicket?: string;
  homeId?: string;
  awayId?: string;
  mode?: string;
  role?: string;
};

type UnityMatchPlugin = {
  openMatch(payload: UnityMatchPluginOpenPayload): Promise<UnityLaunchResult>;
  closeMatch(payload?: { reason?: string }): Promise<{ ok: boolean }>;
  getLaunchStatus(): Promise<UnityLaunchStatus>;
  addListener(
    eventName: 'unityEvent',
    listenerFunc: (event: UnityBridgeEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
};

const UnityMatch = registerPlugin<UnityMatchPlugin>('UnityMatch');

type UnityBridgeEventListener = (event: UnityBridgeEvent) => void;

let nextUnityEventListenerId = 1;
const unityEventListeners = new Map<number, UnityBridgeEventListener>();
let unityNativeEventSubscription:
  | {
      remove: () => Promise<void>;
    }
  | null = null;
let unityNativeEventRegistrationPromise: Promise<void> | null = null;

function isAndroidNativePlatform(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function emitUnityBridgeEvent(event: UnityBridgeEvent): void {
  const snapshot = Array.from(unityEventListeners.values());
  snapshot.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      console.warn('[UnityBridge] unity event listener failed', error);
    }
  });
}

async function ensureUnityNativeEventListener(): Promise<void> {
  if (!isAndroidNativePlatform()) {
    return;
  }

  if (unityNativeEventSubscription) {
    return;
  }

  if (!unityNativeEventRegistrationPromise) {
    unityNativeEventRegistrationPromise = UnityMatch.addListener('unityEvent', (event) => {
      emitUnityBridgeEvent(event);
    })
      .then((subscription) => {
        unityNativeEventSubscription = subscription;
      })
      .catch((error) => {
        unityNativeEventRegistrationPromise = null;
        throw error;
      });
  }

  await unityNativeEventRegistrationPromise;
}

async function launchNativeOnAndroid(
  ip: string,
  port: number,
  matchRequest?: UnityLaunchPayload,
): Promise<UnityLaunchResult> {
  return UnityMatch.openMatch({
    serverIp: ip,
    serverPort: Number.isFinite(port) ? Math.max(1, Math.floor(port)) : 7777,
    matchId: matchRequest?.matchId,
    joinTicket: matchRequest?.joinTicket,
    homeId: matchRequest?.homeId,
    awayId: matchRequest?.awayId,
    mode: matchRequest?.mode ?? 'friendly',
    role: matchRequest?.role ?? 'spectator',
  });
}

function launchWebMock(ip: string, port: number, matchRequest?: UnityLaunchPayload): UnityLaunchResult {
  let intentUrl = `connect://${ip}:${port}`;
  if (matchRequest) {
    const params = new URLSearchParams();
    params.set('home', matchRequest.homeId);
    params.set('away', matchRequest.awayId);
    if (matchRequest.matchId) {
      params.set('matchId', matchRequest.matchId);
    }
    if (matchRequest.joinTicket) {
      params.set('joinTicket', matchRequest.joinTicket);
    }
    if (matchRequest.mode) {
      params.set('mode', matchRequest.mode);
    }
    if (matchRequest.role) {
      params.set('role', matchRequest.role);
    }
    intentUrl += `?${params.toString()}`;
  }

  console.log(`[UnityBridge] MOCK launch. intent=${intentUrl}`);

  const matchInfo = matchRequest
    ? `${matchRequest.homeId} vs ${matchRequest.awayId} (${matchRequest.matchId || 'no-match-id'})`
    : 'Yok';
  alert(`[MOCK] Unity Native Penceresi Acildi!\nBaglanti: ${ip}:${port}\nMac: ${matchInfo}`);

  return {
    ok: true,
    nativeLaunch: false,
    bridgeMode: 'web-mock',
  };
}

export const unityBridge = {
  async launchMatchActivity(
    ip: string,
    port: number = 7777,
    matchRequest?: UnityLaunchPayload,
  ): Promise<UnityLaunchResult> {
    if (isAndroidNativePlatform()) {
      await ensureUnityNativeEventListener();
      const response = await launchNativeOnAndroid(ip, port, matchRequest);
      if (!response?.ok) {
        throw new Error('Unity native launch failed.');
      }

      return response;
    }

    return launchWebMock(ip, port, matchRequest);
  },

  async closeMatchActivity(reason?: string): Promise<void> {
    if (!isAndroidNativePlatform()) {
      console.log('[UnityBridge] closeMatchActivity() ignored on non-Android platform.');
      return;
    }

    await UnityMatch.closeMatch(
      reason && reason.trim().length > 0
        ? { reason: reason.trim() }
        : undefined,
    );
  },

  async getLaunchStatus(): Promise<UnityLaunchStatus> {
    if (!isAndroidNativePlatform()) {
      return {
        ok: true,
        active: false,
        inFlight: false,
        hostActive: false,
        embeddedActivityActive: false,
        pendingShellReturn: false,
        activeActivityClass: null,
        activeMatchId: null,
        hostMatchId: null,
        hostServerIp: null,
        hostServerPort: null,
        launchGeneration: 0,
      };
    }

    return UnityMatch.getLaunchStatus();
  },

  async onUnityEvent(
    callback: (event: UnityBridgeEvent) => void,
  ): Promise<() => Promise<void>> {
    if (!isAndroidNativePlatform()) {
      return async () => {};
    }

    await ensureUnityNativeEventListener();

    const listenerId = nextUnityEventListenerId++;
    unityEventListeners.set(listenerId, callback);
    return async () => {
      unityEventListeners.delete(listenerId);
    };
  },
};

/**
 * Legacy Bridge Support for WebGL (To prevent build errors in Legacy/Demo Pages)
 * - These exports are required because legacy files (MatchSimulation.tsx, MatchSimulationLegacy.tsx, UnityAutoSeed.tsx) still reference them.
 * - In Milestone 4 (Android Build), we will refactor these completely.
 */

// --- Types ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BridgeMatchRequest = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BridgeMatchResult = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PublishTeamsPayload = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ShowTeamsPayload = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PublishedTeam = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PublishedPlayer = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TeamKitColors = any;

// New missing types for MatchSimulation.tsx & UnityAutoSeed.tsx
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RuntimePlayer = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RuntimeTeam = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GoalTimelineEntry = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MatchBridgeAPI = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TeamBadge = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TeamKitAssets = any;

type LegacyBridge = {
  sendTeams: (payload?: unknown) => boolean;
  publishTeams: (payload?: unknown) => boolean;
  sendMatch: (payload?: unknown) => boolean;
  dispose: () => void;
};

type LegacyMatchBridgeApi = {
  publishTeams: (payload?: unknown) => void;
  showTeams: (payload?: unknown) => void;
  sendTeams: (payload?: unknown) => void;
  loadMatchFromJSON: (payload?: unknown) => void;
};

// --- Functions ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const prepareUnityIframeBridge = (iframe: HTMLIFrameElement, callbacks?: any): LegacyBridge => {
  console.log("[UnityBridge] Legacy WebGL bridge requested (Ignored for Native Mode)");
  return {
    sendTeams: (_payload?: unknown) => true,
    publishTeams: (_payload?: unknown) => true,
    sendMatch: (_payload?: unknown) => true,
    dispose: () => { }
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const waitForMatchBridgeAPIOnWindow = async (win: any, timeout: number): Promise<void> => {
  return Promise.resolve();
};

export const waitForMatchBridgeAPI = async (timeout: number = 10000): Promise<LegacyMatchBridgeApi> => {
  console.log("[UnityBridge] waitForMatchBridgeAPI called (Mock)");
  return Promise.resolve({
    publishTeams: (_payload?: unknown) => { },
    showTeams: (_payload?: unknown) => { },
    sendTeams: (_payload?: unknown) => { },
    loadMatchFromJSON: (_payload?: unknown) => { }
  });
};

export const toUnityFormationEnum = (formation: string): string => {
  return formation; // Mock return
};

// Updated signature to support optional second argument used in UnityAutoSeed.tsx
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const runtimeTeamToPublishedTeam = (runtimeTeam: any, options?: any): any => {
  return runtimeTeam; // Mock pass-through
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const buildGoalTimelineEntries = (homeGoals: string, awayGoals: string): any[] => {
  return []; // Mock return empty array
};

export const createRequestToken = (): string => {
  return "mock-token-" + Date.now();
};
