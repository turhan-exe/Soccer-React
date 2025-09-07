// Lightweight Unity WebGL bridge utilities for React ↔ Unity communication
// - Works with our embedded iframe at `/Unity/match-viewer/index.html`
// - Sends JSON to Unity C# `MatchBridge.LoadMatchFromJSON`
// - Listens to `unityMatchFinished` events emitted from Unity's WebGL plugin

export type BridgeMatchRequest = {
  matchId?: string;
  homeTeamKey: string; // Resources/Database/<key>.asset (e.g., "Istanbul", "London")
  awayTeamKey: string; // Resources/Database/<key>.asset
  autoStart?: boolean;
  aiLevel?: string; // e.g., "Legendary"
  userTeam?: 'None' | 'Home' | 'Away';
  dayTime?: string; // e.g., "Night"
  homeAltKit?: boolean | null; // false => Home kit
  awayAltKit?: boolean | null; // true  => Away kit
};

export type BridgeMatchResult = {
  matchId?: string;
  homeTeam?: string;
  awayTeam?: string;
  homeGoals?: number;
  awayGoals?: number;
  scorers?: string[];
};

type UnityInstance = {
  SendMessage: (goName: string, method: string, param?: any) => void;
  SetFullscreen?: (enabled: number) => void;
};

export type UnityBridge = {
  isReady: () => boolean;
  sendMatch: (req: BridgeMatchRequest) => boolean;
  sendTeams: (req: ShowTeamsPayload) => boolean;
  publishTeams: (req: PublishTeamsPayload) => boolean;
  preselectMenu: (req: PreselectMenuPayload) => boolean;
  hideOverlay: () => boolean;
  dispose: () => void;
};

/**
 * Prepare a bridge for an iframe that hosts our Unity WebGL build.
 * Assumes the iframe URL is same-origin (public/Unity/match-viewer/index.html).
 */
export function prepareUnityIframeBridge(
  iframe: HTMLIFrameElement,
  opts?: {
    onReady?: (unity: UnityInstance) => void;
    onResult?: (result: BridgeMatchResult) => void;
    log?: (msg: string, ...rest: any[]) => void;
  }
): UnityBridge {
  let unity: UnityInstance | null = null;
  let childWin: (Window & typeof globalThis & { MGX?: any; __MGX__?: any; onUnityReady?: (u: UnityInstance) => void; MatchBridgeAPI?: MatchBridgeAPI }) | null = null;
  const queue: BridgeMatchRequest[] = [];

  const log = opts?.log || (() => {});

  const tryResolveUnity = () => {
    if (!iframe.contentWindow) return;
    childWin = iframe.contentWindow as any;
    const inst = (
      (childWin.MGX && childWin.MGX.unityInstance) ||
      (childWin.__MGX__ && childWin.__MGX__.unityInstance)
    ) as UnityInstance | undefined;
    if (inst && typeof inst.SendMessage === 'function') {
      unity = inst;
      opts?.onReady?.(inst);
      // Flush queue
      while (queue.length) {
        const req = queue.shift()!;
        safeSend(req);
      }
    }
  };

  const onChildUnityReady = (u: UnityInstance) => {
    log('[UnityBridge] onUnityReady received');
    unity = u;
    opts?.onReady?.(u);
    while (queue.length) {
      const req = queue.shift()!;
      safeSend(req);
    }
  };

  const onUnityResult = (ev: Event) => {
    try {
      const ce = ev as CustomEvent<string>;
      const raw = ce?.detail || '';
      const parsed = raw ? (JSON.parse(raw) as BridgeMatchResult) : ({} as BridgeMatchResult);
      opts?.onResult?.(parsed);
      // Forward to parent window for optional telemetry/logging hooks
      try {
        const forwarded = new CustomEvent('unityMatchFinished', { detail: raw });
        window.dispatchEvent(forwarded);
      } catch {}
    } catch (e) {
      log('[UnityBridge] result parse error', e);
    }
  };

  // Attach to child window once loaded
  const onLoad = () => {
    try {
      if (!iframe.contentWindow) return;
      childWin = iframe.contentWindow as any;

      // Listen results in the child window (event is dispatched there)
      childWin.addEventListener?.('unityMatchFinished', onUnityResult);

      // Provide a hook used by the template to notify readiness
      childWin.onUnityReady = onChildUnityReady;

      // Pre-wait for API readiness (non-blocking)
      try {
        waitForMatchBridgeAPI(childWin as any, 15000).then(() => log('[UnityBridge] MatchBridgeAPI ready'));
      } catch {}

      // In case it's already ready by now
      tryResolveUnity();
    } catch (e) {
      log('[UnityBridge] onLoad error', e);
    }
  };

  // If the frame is already loaded when we attach
  if (iframe.complete) {
    setTimeout(onLoad, 0);
  } else {
    iframe.addEventListener('load', onLoad, { once: true });
  }

  const safeSend = (req: BridgeMatchRequest): boolean => {
    if (!unity) return false;
    try {
      const json = JSON.stringify(req);
      unity.SendMessage('MatchBridge', 'LoadMatchFromJSON', json);
      return true;
    } catch (e) {
      log('[UnityBridge] SendMessage failed', e);
      return false;
    }
  };

  return {
    isReady: () => !!unity,
    sendMatch: (req) => {
      if (unity) return safeSend(req);
      queue.push(req);
      // Attempt to resolve in case ready state was missed
      tryResolveUnity();
      return false;
    },
    sendTeams: (req) => {
      try {
        const api = (childWin as any)?.MatchBridgeAPI as MatchBridgeAPI | undefined;
        if (api && typeof api.showTeams === 'function') {
          api.showTeams(req);
          return true;
        }
        if (!unity) return false;
        const json = JSON.stringify(req);
        unity.SendMessage('MatchBridge', 'ShowTeamsFromJSON', json);
        return true;
      } catch (e) {
        log('[UnityBridge] showTeams failed', e as any);
        return false;
      }
    },
    publishTeams: (req) => {
      try {
        const api = (childWin as any)?.MatchBridgeAPI as MatchBridgeAPI | undefined;
        if (api && typeof api.publishTeams === 'function') {
          api.publishTeams(req);
          return true;
        }
        // Fallback to direct SendMessage if available
        if (unity) {
          const json = JSON.stringify(req);
          unity.SendMessage('MatchBridge', 'LoadTeamsToSelectionFromJSON', json);
          return true;
        }
        return false;
      } catch (e) {
        log('[UnityBridge] publishTeams failed', e as any);
        return false;
      }
    },
    preselectMenu: (req) => {
      try {
        const api = (childWin as any)?.MatchBridgeAPI as MatchBridgeAPI | undefined;
        if (api && typeof api.preselectMenu === 'function') {
          api.preselectMenu(req);
          return true;
        }
        if (unity) {
          const json = JSON.stringify(req);
          unity.SendMessage('MatchBridge', 'PreselectMenuFromJSON', json);
          return true;
        }
        return false;
      } catch (e) {
        log('[UnityBridge] preselectMenu failed', e as any);
        return false;
      }
    },
    hideOverlay: () => {
      try {
        const api = (childWin as any)?.MatchBridgeAPI as MatchBridgeAPI | undefined;
        if (api && typeof api.hideOverlay === 'function') {
          api.hideOverlay();
          return true;
        }
        if (unity) {
          unity.SendMessage('MatchBridge', 'HideOverlay');
          return true;
        }
        return false;
      } catch (e) {
        log('[UnityBridge] hideOverlay failed', e as any);
        return false;
      }
    },
    dispose: () => {
      try {
        iframe.removeEventListener('load', onLoad as any);
      } catch {}
      try {
        (childWin as any)?.removeEventListener?.('unityMatchFinished', onUnityResult as any);
      } catch {}
      unity = null;
      childWin = null;
      queue.splice(0, queue.length);
    },
  };
}

// -----------------
// Runtime Teams API
// -----------------

export type RuntimePlayer = {
  id?: string;
  name: string;
  position?: string;
  overall?: number;
  age?: number;
  // Keep attributes optional and loosely-typed to avoid tight coupling
  attributes?: Record<string, number>;
};

export type KitSpec = {
  // Accept both hex (#RRGGBB[AA]) or "r,g,b[,a]" strings
  color1?: string;
  color2?: string;
  color3?: string;
  shorts?: string;
  socks?: string;
};

export type RuntimeTeam = {
  name: string;
  players: string[]; // 11 names, GK → FW order; Unity uses names for fallback
  playersData?: RuntimePlayer[]; // Optional: parallel array with details
  formation?: string; // Unity enum name e.g. _4_3_3, _4_2_3_1_A
  // Optional kit fields used by TeamSelection publish flow
  homeKit?: KitSpec;
  awayKit?: KitSpec;
};

export type ShowTeamsPayload = {
  home: RuntimeTeam;
  away: RuntimeTeam;
  aiLevel?: string; // e.g., Legendary
  userTeam?: 'None' | 'Home' | 'Away';
  dayTime?: string; // e.g., Night
  autoStart?: boolean; // if true, proceed to pre-match; if false, stay in selection
  openMenu?: boolean; // open team selection UI (handled by C#)
  select?: boolean;   // auto select injected teams
};

// -------------
// Team Selection
// -------------

export type PublishTeamsPayload = {
  home?: RuntimeTeam | null;
  away?: RuntimeTeam | null;
  openMenu?: boolean; // Open TeamSelection UI
  select?: boolean; // Auto select injected teams
};

export type PreselectMenuPayload = {
  homeTeamKey?: string; // Existing DB key (e.g., "Istanbul")
  awayTeamKey?: string; // Existing DB key
  userTeam?: 'Home' | 'Away' | 'None';
  openMenu?: boolean;
};

export type MatchBridgeAPI = {
  showTeams: (payload: ShowTeamsPayload) => void;
  publishTeams: (payload: PublishTeamsPayload) => void;
  preselectMenu: (payload: PreselectMenuPayload) => void;
  hideOverlay: () => void;
};

/**
 * Convert formation labels like "4-3-3" or "4-2-3-1" to Unity enum names
 * like "_4_3_3" or "_4_2_3_1". If a variant is provided such as
 * "4-2-3-1 A" or "4-2-3-1_A", outputs "_4_2_3_1_A".
 */
export function toUnityFormationEnum(label?: string | null): string | undefined {
  if (!label) return undefined;
  const trimmed = label.trim();
  if (!trimmed) return undefined;
  // Already in Unity format
  if (trimmed.startsWith('_')) return trimmed;
  // Accept digits separated by '-' or '_' and optional variant
  // Examples: "4-2-3-1 A", "4-2-3-1_A", "4_3_3", "4-3-3"
  const m = trimmed.match(/^(\d(?:[-_]\d)+)(?:[ _-]*([A-Za-z]))?$/);
  if (!m) return undefined;
  const base = m[1].replace(/-/g, '_');
  const variant = (m[2] || '').toUpperCase();
  return `_${base}${variant ? `_${variant}` : ''}`;
}

/**
 * Wait until MatchBridgeAPI is available on a given window (top-level or iframe).
 * Useful when calling Unity APIs directly without the iframe bridge helper.
 */
export function waitForMatchBridgeAPI(
  win: (Window & { MatchBridgeAPI?: MatchBridgeAPI }) = (window as any),
  timeoutMs = 15000
): Promise<MatchBridgeAPI> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const api = win && (win as any).MatchBridgeAPI as MatchBridgeAPI | undefined;
      if (api && typeof api.showTeams === 'function') return resolve(api);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('MatchBridgeAPI timeout'));
      // Use RAF when present, otherwise setTimeout fallback
      if (typeof (win as any).requestAnimationFrame === 'function') (win as any).requestAnimationFrame(tick);
      else setTimeout(tick, 50);
    };
    tick();
  });
}
