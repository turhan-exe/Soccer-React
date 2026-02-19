/**
 * Unity Native Bridge Layer
 * This simulates calling Java/Kotlin (Android) or Obj-C (iOS) from React Native.
 * For now, it just logs to console to verify the flow.
 */

export const unityBridge = {
  /**
   * Launches the Unity Native Activity
   * @param ip Server IP to connect to via KCP
   * @param port Server Port (default 7777)
   */
  /**
   * Launches the Unity Native Activity
   * @param ip Server IP to connect to via KCP
   * @param port Server Port (default 7777)
   * @param matchRequest Optional match request data (home/away team IDs)
   */
  launchMatchActivity: (ip: string, port: number = 7777, matchRequest?: { homeId: string, awayId: string }) => {
    let intentUrl = `connect://${ip}:${port}`;
    if (matchRequest) {
      intentUrl += `?home=${matchRequest.homeId}&away=${matchRequest.awayId}`;
    }
    console.log(`[UnityBridge] Launching Native Activity with intent: ${intentUrl}`);

    // In a real environment (Capacitor/React Native):
    // NativeModules.UnityModule.launch(ip, port, matchRequest);

    // For Browser Test:
    alert(`[MOCK] Unity Native Penceresi Acildi!\nBaglanti: ${ip}:${port}\nMac: ${matchRequest ? `${matchRequest.homeId} vs ${matchRequest.awayId}` : 'Yok'}`);
  }
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


// --- Functions ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const prepareUnityIframeBridge = (iframe: HTMLIFrameElement, callbacks?: any) => {
  console.log("[UnityBridge] Legacy WebGL bridge requested (Ignored for Native Mode)");
  return {
    sendTeams: () => true,
    publishTeams: () => true,
    sendMatch: () => true,
    dispose: () => { }
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const waitForMatchBridgeAPIOnWindow = async (win: any, timeout: number) => {
  return Promise.resolve();
};

export const waitForMatchBridgeAPI = async (timeout: number = 10000) => {
  console.log("[UnityBridge] waitForMatchBridgeAPI called (Mock)");
  return Promise.resolve({
    publishTeams: () => { },
    showTeams: () => { },
    sendTeams: () => { },
    loadMatchFromJSON: () => { }
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
