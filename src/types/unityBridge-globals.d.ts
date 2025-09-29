import type { MatchBridgeAPI } from '@/services/unityBridge';

declare global {
  interface Window {
    MatchBridgeAPI?: MatchBridgeAPI;
    onUnityReady?: (unityInstance: unknown) => void;
  }
}

export {};


