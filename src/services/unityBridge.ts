// Lightweight Unity WebGL bridge utilities for React ↔ Unity communication
// - Works with our embedded iframe at `/Unity/match-viewer/index.html`
// - Sends JSON to Unity C# `MatchBridge.LoadMatchFromJSON`
// - Listens to `unityMatchFinished` events emitted from Unity's WebGL plugin

export type BridgeMatchRequest = {
  matchId?: string;
  homeTeamKey: string; // Resources/Database/<key>.asset (e.g., "Istanbul", "London")
  awayTeamKey: string; // Resources/Database/<key>.asset
  requestToken?: string; // optional correlation id echoed back with results
  autoStart?: boolean;
  aiLevel?: string; // e.g., "Legendary"
  userTeam?: 'None' | 'Home' | 'Away';
  dayTime?: string; // e.g., "Night"
  homeAltKit?: boolean | null; // false => Home kit
  awayAltKit?: boolean | null; // true  => Away kit
};

export type BridgeMatchResult = {
  matchId?: string;
  requestToken?: string;
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

type RegisterFn = ((instance: UnityInstance) => any) & {
  __unityBridgePatched?: boolean;
  __unityBridgeOriginal?: (instance: UnityInstance) => any;
};

type BridgeChildWindow = Window &
  typeof globalThis & {
    MGX?: any;
    __MGX__?: any;
    onUnityReady?: (u: UnityInstance) => void;
    MatchBridgeAPI?: MatchBridgeAPI;
    __registerMatchBridgeInstance?: RegisterFn;
    __unityMatchBridgeInstance?: UnityInstance;
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
  let childWin: BridgeChildWindow | null = null;
  const queue: BridgeMatchRequest[] = [];
  let restoreGlobalOnUnityReady: (() => void) | null = null;

  const log = opts?.log || (() => {});

  const deliverMatch = (req: BridgeMatchRequest): boolean => {
    const api = (childWin as any)?.MatchBridgeAPI as MatchBridgeAPI | undefined;
    if (api && typeof api.loadByKeys === 'function') {
      try {
        api.loadByKeys(req);
        return true;
      } catch (e) {
        log('[UnityBridge] MatchBridgeAPI.loadByKeys failed', e);
      }
    }

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

  const flushQueue = () => {
    if (!queue.length) return;
    const pending = queue.splice(0, queue.length);
    for (const req of pending) {
      if (!deliverMatch(req)) {
        queue.unshift(req);
        break;
      }
    }
  };

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
      flushQueue();
    }
  };

  const onChildUnityReady = (u: UnityInstance) => {
    log('[UnityBridge] onUnityReady received');
    unity = u;
    opts?.onReady?.(u);
    flushQueue();
  };

  const patchUnityRegister = () => {
    if (!childWin) return;
    const current = childWin.__registerMatchBridgeInstance;
    if (typeof current !== 'function') {
      if (!restoreGlobalOnUnityReady) {
        const parentWin = iframe.ownerDocument?.defaultView ?? window;
        const previous = (parentWin as any).onUnityReady;
        const fallback = (instance: UnityInstance) => {
          try {
            onChildUnityReady(instance);
          } catch (err) {
            log('[UnityBridge] fallback onUnityReady failed', err);
          }
          if (typeof previous === 'function') {
            try {
              previous.call(parentWin, instance);
            } catch (err) {
              log('[UnityBridge] previous onUnityReady failed', err);
            }
          }
        };
        (parentWin as any).onUnityReady = fallback;
        restoreGlobalOnUnityReady = () => {
          if ((parentWin as any).onUnityReady === fallback) {
            (parentWin as any).onUnityReady = previous;
          }
          restoreGlobalOnUnityReady = null;
        };
        log('[UnityBridge] __registerMatchBridgeInstance missing, installed global fallback');
      }
      return;
    }
    if ((current as RegisterFn).__unityBridgePatched) return;
    const original = current;
    const patched: RegisterFn = function patchedRegister(this: unknown, instance: UnityInstance) {
      const result = original.call(this ?? childWin, instance);
      try {
        onChildUnityReady(instance);
      } catch (err) {
        log('[UnityBridge] patched onUnityReady failed', err);
      }
      return result;
    };
    patched.__unityBridgePatched = true;
    patched.__unityBridgeOriginal = original;
    childWin.__registerMatchBridgeInstance = patched;
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
      childWin = iframe.contentWindow as BridgeChildWindow;

      // Listen results in the child window (event is dispatched there)
      childWin.addEventListener?.('unityMatchFinished', onUnityResult);

      // Provide a hook used by the template to notify readiness
      childWin.onUnityReady = onChildUnityReady;
      patchUnityRegister();

      // Pre-wait for API readiness (non-blocking)
      try {
        waitForMatchBridgeAPIOnWindow(childWin as any, 15000).then(() => log('[UnityBridge] MatchBridgeAPI ready'));
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

  return {
    isReady: () => !!unity,
    sendMatch: (req) => {
      if (deliverMatch(req)) return true;
      queue.push(req);
      // Attempt to resolve in case ready state was missed
      tryResolveUnity();
      return false;
    },
    sendTeams: (req) => {
      try {
        const api = (childWin as any)?.MatchBridgeAPI as MatchBridgeAPI | undefined;
        if (api) {
          if (typeof api.sendTeams === 'function') {
            const payload = typeof req === 'string' ? req : JSON.stringify(req);
            api.sendTeams(payload);
            return true;
          }
          if (typeof api.showTeams === 'function') {
            api.showTeams(req);
            return true;
          }
        }
        if (!unity) return false;
        const json = typeof req === 'string' ? req : JSON.stringify(req);
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
      if (restoreGlobalOnUnityReady) {
        try {
          restoreGlobalOnUnityReady();
        } catch {}
        restoreGlobalOnUnityReady = null;
      }
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
  bench?: string[]; // Optional: bench/substitute list (max 9)
  benchData?: RuntimePlayer[]; // Optional: detailed bench data parallel to bench
  // Optional kit fields used by TeamSelection publish flow
  homeKit?: KitSpec;
  awayKit?: KitSpec;
};


// -------------
// Team Selection
// -------------

export type TeamKitColors = {
  primary?: string;
  secondary?: string;
  text?: string;
  shorts?: string;
  socks?: string;
  gkPrimary?: string;
  gkSecondary?: string;
};

export type PublishedPlayer = {
  playerId: string;
  name: string;
  order?: number;
  position?: string;
  overall?: number;
  attributes?: Record<string, number>;
};

export type PublishedTeam = {
  teamKey: string;
  teamName: string;
  formation?: string;
  kit?: TeamKitColors;
  lineup: PublishedPlayer[];
  bench?: PublishedPlayer[];
};

export type PublishTeamsPayload = {
  homeTeam: PublishedTeam;
  awayTeam: PublishedTeam;
  homeTeamKey?: string;
  awayTeamKey?: string;
  cacheOnly?: boolean;
};

export type ShowTeamsPayload = {
  homeTeam: PublishedTeam;
  awayTeam: PublishedTeam;
  homeTeamKey: string;
  awayTeamKey: string;
  aiLevel?: string; // e.g., Legendary
  userTeam?: 'None' | 'Home' | 'Away';
  dayTime?: string; // e.g., Night
  autoStart?: boolean; // if true, proceed to pre-match; if false, stay in selection
  openMenu?: boolean; // open team selection UI (handled by C#)
  select?: boolean; // auto select injected teams
};

export type PreselectMenuPayload = {
  homeTeamKey?: string; // Existing DB key (e.g., "Istanbul")
  awayTeamKey?: string; // Existing DB key
  userTeam?: 'Home' | 'Away' | 'None';
  openMenu?: boolean;
};

export type MatchBridgeAPI = {
  sendTeams?: (json: string) => void;
  startMatch?: () => void;
  showTeams: (payload: ShowTeamsPayload) => void;
  loadSquads?: (payload: ShowTeamsPayload) => void;
  loadByKeys?: (payload: BridgeMatchRequest) => void;
  publishTeams: (payload: PublishTeamsPayload) => void;
  preselectMenu: (payload: PreselectMenuPayload) => void;
  selectTeam?: (side: 'Home' | 'Away' | 'None') => void;
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

const UNITY_ATTRIBUTE_KEYS = [
  'strength',
  'acceleration',
  'topspeed',
  'dribblespeed',
  'jump',
  'tackling',
  'ballkeeping',
  'passing',
  'longball',
  'agility',
  'shooting',
  'shootpower',
  'positioning',
  'reaction',
  'ballcontrol',
  'height',
  'weight',
] as const;

const ZERO_ATTRIBUTES_TEMPLATE: Record<string, number> = UNITY_ATTRIBUTE_KEYS.reduce(
  (acc, key) => {
    acc[key] = 0;
    return acc;
  },
  {} as Record<string, number>
);

export function runtimeTeamToPublishedTeam(
  team: RuntimeTeam,
  opts: { teamKey: string; preferAwayKit?: boolean; fallbackName?: string }
): PublishedTeam {
  const { teamKey, preferAwayKit = false, fallbackName } = opts;
  const lineupNames = Array.isArray(team.players) ? [...team.players] : [];
  while (lineupNames.length < 11) {
    lineupNames.push(`Player ${lineupNames.length + 1}`);
  }

  const lineup = lineupNames.slice(0, 11).map((name, index) => {
    const player = team.playersData?.[index];
    return {
      playerId: player?.id || `${teamKey}-L${index + 1}`,
      name,
      order: index + 1,
      position: player?.position,
      overall: player?.overall,
      attributes: normalizePlayerAttributes(player?.attributes),
    };
  });

  const benchNames = Array.isArray(team.bench) ? [...team.bench] : [];
  const bench = benchNames.slice(0, 9).map((name, index) => {
    const player = team.benchData?.[index];
    return {
      playerId: player?.id || `${teamKey}-B${index + 1}`,
      name,
      order: lineup.length + index + 1,
      position: player?.position,
      overall: player?.overall,
      attributes: normalizePlayerAttributes(player?.attributes),
    };
  });

  return {
    teamKey,
    teamName: team.name || fallbackName || teamKey,
    formation: normalizeFormationForPublish(team.formation),
    kit: resolveKitColors(team, teamKey, preferAwayKit),
    lineup,
    bench: bench.length ? bench : undefined,
  };
}

function normalizePlayerAttributes(attrs?: Record<string, number>): Record<string, number> {
  if (!attrs || !Object.keys(attrs).length) {
    return { ...ZERO_ATTRIBUTES_TEMPLATE };
  }
  const sanitized = new Map<string, number>();
  for (const [rawKey, rawValue] of Object.entries(attrs)) {
    const key = rawKey.toLowerCase().replace(/[\s_-]/g, '');
    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    if (!Number.isFinite(value)) continue;
    sanitized.set(key, value);
  }
  const result: Record<string, number> = {};
  for (const key of UNITY_ATTRIBUTE_KEYS) {
    result[key] = sanitized.has(key) ? sanitized.get(key)! : 0;
  }
  return result;
}

function resolveKitColors(team: RuntimeTeam, teamKey: string, preferAwayKit: boolean): TeamKitColors {
  const preferred = preferAwayKit ? team.awayKit ?? team.homeKit : team.homeKit ?? team.awayKit;
  return kitSpecToTeamKitColors(preferred) || fallbackKitFromKey(teamKey || team.name || 'TEAM', preferAwayKit);
}

function normalizeFormationForPublish(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith('_')) return value;
  return value
    .slice(1)
    .split('_')
    .filter(Boolean)
    .join('-');
}

function kitSpecToTeamKitColors(kit?: KitSpec | null): TeamKitColors | undefined {
  if (!kit) return undefined;
  const { color1, color2, color3, shorts, socks } = kit;
  if (!color1 && !color2 && !color3 && !shorts && !socks) return undefined;
  return {
    primary: color1,
    secondary: color2,
    text: color3,
    shorts,
    socks,
    gkPrimary: shorts || color2 || color1,
    gkSecondary: socks || color3 || color2 || color1,
  };
}

const KIT_COLOR_PALETTE = ['#0EA5E9', '#DC2626', '#16A34A', '#F97316', '#7C3AED', '#0D9488', '#E11D48', '#2563EB'];

function fallbackKitFromKey(teamKey: string, preferAwayKit: boolean): TeamKitColors {
  const hash = Math.abs(hashString(teamKey));
  const primary = KIT_COLOR_PALETTE[hash % KIT_COLOR_PALETTE.length];
  const accent = KIT_COLOR_PALETTE[(hash + 3) % KIT_COLOR_PALETTE.length];
  return {
    primary: preferAwayKit ? accent : primary,
    secondary: preferAwayKit ? '#0F172A' : '#FFFFFF',
    text: preferAwayKit ? '#F8FAFC' : '#0F172A',
    shorts: preferAwayKit ? '#0F172A' : '#F8FAFC',
    socks: preferAwayKit ? accent : primary,
    gkPrimary: preferAwayKit ? '#FFFFFF' : '#111827',
    gkSecondary: preferAwayKit ? accent : '#FFFFFF',
  };
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * Wait until MatchBridgeAPI is available on a given window (top-level or iframe).
 * Useful when calling Unity APIs directly without the iframe bridge helper.
 */
export function waitForMatchBridgeAPI(timeoutMs = 15000): Promise<MatchBridgeAPI> {
  return waitForMatchBridgeAPIOnWindow(window as Window & { MatchBridgeAPI?: MatchBridgeAPI }, timeoutMs);
}

export function waitForMatchBridgeAPIOnWindow(
  win: Window & { MatchBridgeAPI?: MatchBridgeAPI },
  timeoutMs = 15000
): Promise<MatchBridgeAPI> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const api = win.MatchBridgeAPI;
      if (hasBridgeApi(api)) return resolve(api);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('MatchBridgeAPI timeout'));
      if (typeof (win as any).requestAnimationFrame === 'function') (win as any).requestAnimationFrame(tick);
      else setTimeout(tick, 50);
    };
    tick();
  });
}

function hasBridgeApi(api: MatchBridgeAPI | undefined): api is MatchBridgeAPI {
  if (!api) return false;
  return (
    typeof api.sendTeams === 'function' ||
    typeof api.showTeams === 'function' ||
    typeof api.loadByKeys === 'function' ||
    typeof api.publishTeams === 'function'
  );
}
