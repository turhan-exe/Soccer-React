import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { auth } from '@/services/firebase';
import type { ClubTeam, Player as ClubPlayer } from '@/types';
import { collection, getCountFromServer } from 'firebase/firestore';
import { db } from '@/services/firebase';

function resolveMatchControlBaseUrl(): string {
  const raw = (import.meta.env.VITE_MATCH_CONTROL_BASE_URL || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return raw.replace(/\/$/, '');
    }
  } catch {
    return '';
  }

  return '';
}

const BASE_URL = resolveMatchControlBaseUrl();
const STATIC_BEARER = (import.meta.env.VITE_MATCH_CONTROL_BEARER || '').trim();
const USE_NATIVE_HTTP =
  Capacitor.isNativePlatform() &&
  (BASE_URL.startsWith('http://') || BASE_URL.startsWith('https://'));

export type FriendlyRequestResponse = {
  requestId: string;
  status: 'pending' | 'accepted' | 'expired' | string;
  expiresAt: string;
  acceptMode?: 'manual' | 'offline_auto' | string;
  autoAcceptAt?: string | null;
};

export type PresenceHeartbeatResponse = {
  ok?: boolean;
  expiresAt?: string;
  reliable?: boolean;
};

export type PresenceStatsResponse = {
  ok?: boolean;
  onlineUsers?: number;
  reliable?: boolean;
  ttlSec?: number;
  timestamp?: string;
};

export type UnityRuntimePlayerPayload = {
  playerId: string;
  name: string;
  order: number;
  attributes: Record<string, number>;
  visual?: UnityRuntimePlayerVisualPayload;
};

export type UnityRuntimePlayerVisualPayload = {
  skinColor: string;
  hairStyle: string;
  hairColor: string;
  facialHairStyle: string;
  facialHairColor: string;
  bootColor: string;
  sockAccessoryColor: string;
};

export type UnityRuntimeKitPayload = {
  primary: string;
  secondary: string;
  text: string;
  gkPrimary: string;
  gkSecondary: string;
};

export type UnityRuntimeTeamPayload = {
  teamKey: string;
  teamName: string;
  formation: string;
  kit: UnityRuntimeKitPayload;
  lineup: UnityRuntimePlayerPayload[];
  bench: UnityRuntimePlayerPayload[];
};

export type FriendlyRequestListItem = {
  requestId: string;
  status: 'pending' | 'accepted' | 'expired' | string;
  acceptMode?: 'manual' | 'offline_auto' | string;
  autoAcceptAt?: string | null;
  requesterUserId: string;
  opponentUserId?: string | null;
  homeTeamId?: string;
  awayTeamId?: string;
  acceptedBy?: string | null;
  acceptedByKind?: 'user' | 'system' | string | null;
  matchId?: string | null;
  expiresAt?: string;
  createdAt?: string | null;
  match?: {
    matchId: string;
    state: string;
    serverIp: string;
    serverPort: number;
  };
};

export type FriendlyRequestStatusResponse = {
  requestId: string;
  status: 'pending' | 'accepted' | 'expired' | string;
  acceptMode?: 'manual' | 'offline_auto' | string;
  autoAcceptAt?: string | null;
  requesterUserId?: string;
  opponentUserId?: string | null;
  homeTeamId?: string;
  awayTeamId?: string;
  acceptedBy?: string | null;
  acceptedByKind?: 'user' | 'system' | string | null;
  matchId?: string | null;
  expiresAt?: string;
  match?: {
    matchId: string;
    state: string;
    serverIp: string;
    serverPort: number;
  };
};

export type MatchAllocationResponse = {
  requestId?: string;
  matchId: string;
  state: string;
  serverIp: string;
  serverPort: number;
  joinTicket?: string;
  expiresAt?: string;
};

export type JoinTicketResponse = {
  matchId: string;
  joinTicket: string;
  serverIp: string;
  serverPort: number;
  expiresAt: string;
};

export type MatchStatusResponse = {
  matchId: string;
  state: string;
  serverIp: string;
  serverPort: number;
  updatedAt: string;
};

export type MatchControlHealthResponse = {
  ok?: boolean;
  pgReady?: boolean;
  redisReady?: boolean;
  nodeAgents?: number;
  nodeAgentsFriendly?: number;
  nodeAgentsLeague?: number;
  timestamp?: string;
};

const MATCH_READY_STATES = new Set(['server_started', 'running']);
const MATCH_TERMINAL_STATES = new Set(['failed', 'ended', 'released', 'client_disconnected']);
const FRIENDLY_MATCH_READY_STATES = new Set(['server_started', 'running']);

export type FriendlyMatchHistoryItem = {
  matchId: string;
  playedAt: string | null;
  homeUserId: string | null;
  awayUserId: string | null;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  resultForUser: 'win' | 'draw' | 'loss' | string;
  videoStatus: 'none' | 'processing' | 'ready' | 'failed' | string;
  videoAvailable: boolean;
  videoWatchUrl: string | null;
  replayStatus: 'none' | 'processing' | 'ready' | 'failed' | string;
};

export function isMatchControlConfigured(): boolean {
  return BASE_URL.length > 0;
}

async function resolveAuthHeader(): Promise<string | null> {
  if (typeof (auth as { authStateReady?: () => Promise<void> }).authStateReady === 'function') {
    try {
      await (auth as { authStateReady: () => Promise<void> }).authStateReady();
    } catch {
      // no-op
    }
  }

  if (STATIC_BEARER) {
    return `Bearer ${STATIC_BEARER}`;
  }

  const user = auth.currentUser;
  if (!user) {
    return null;
  }

  try {
    const idToken = await user.getIdToken();
    return idToken ? `Bearer ${idToken}` : null;
  } catch {
    return null;
  }
}

async function resolveAuthHeaderWithRefresh(): Promise<string | null> {
  if (STATIC_BEARER) {
    return `Bearer ${STATIC_BEARER}`;
  }

  const user = auth.currentUser;
  if (!user) {
    return null;
  }

  try {
    const idToken = await user.getIdToken(true);
    return idToken ? `Bearer ${idToken}` : null;
  } catch {
    return null;
  }
}

type MatchControlRequestInit = RequestInit & {
  timeoutMs?: number;
};

type NativeHttpResult = {
  status: number;
  data: unknown;
};

async function executeNativeHttp(
  path: string,
  init: MatchControlRequestInit | undefined,
  authHeader: string | null,
): Promise<NativeHttpResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  const timeoutMs = Math.max(1000, Number(init?.timeoutMs || 10000));
  const method = String(init?.method || 'GET').toUpperCase();
  let data: unknown = undefined;
  const body = init?.body;

  if (typeof body === 'string' && body.length > 0) {
    try {
      data = JSON.parse(body);
    } catch {
      data = body;
    }
  } else if (body != null) {
    data = body as unknown;
  }

  const response = await CapacitorHttp.request({
    url: `${BASE_URL.replace(/\/$/, '')}${path}`,
    method,
    headers,
    data,
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
  });

  return {
    status: Number(response.status || 0),
    data: response.data,
  };
}

async function requestPublicJson<T>(path: string, timeoutMs = 6000): Promise<T> {
  if (!BASE_URL) {
    throw new Error('Match Control API base URL tanimli degil.');
  }

  if (USE_NATIVE_HTTP) {
    const response = await executeNativeHttp(path, { method: 'GET', timeoutMs }, null);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Request failed (${response.status})`);
    }
    return response.data as T;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BASE_URL.replace(/\/$/, '')}${path}`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function requestJson<T>(path: string, init?: MatchControlRequestInit): Promise<T> {
  if (!BASE_URL) {
    throw new Error('Match Control API base URL tanimli degil.');
  }

  if (!USE_NATIVE_HTTP && typeof window !== 'undefined' && window.location.protocol === 'https:' && BASE_URL.startsWith('http://')) {
    throw new Error('Match Control API production icin HTTPS uzerinden tanimlanmali.');
  }

  const buildHeaders = (authHeader: string | null): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (authHeader) {
      headers.Authorization = authHeader;
    }
    return headers;
  };

  let authHeader = await resolveAuthHeader();
  const timeoutMs = Math.max(1000, Number(init?.timeoutMs || 10000));

  if (USE_NATIVE_HTTP) {
    let response: NativeHttpResult;
    try {
      response = await executeNativeHttp(path, init, authHeader);

      if (response.status === 401 && !STATIC_BEARER) {
        const refreshedAuthHeader = await resolveAuthHeaderWithRefresh();
        const retryAuthHeader = refreshedAuthHeader || authHeader;
        if (retryAuthHeader) {
          response = await executeNativeHttp(path, init, retryAuthHeader);
          authHeader = retryAuthHeader;
        }
      }
    } catch {
      throw new Error(`Match Control API ulasilamiyor: ${BASE_URL}`);
    }

    if (response.status < 200 || response.status >= 300) {
      const text =
        typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
      let parsed: Record<string, unknown> | null = null;
      if (response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
        parsed = response.data as Record<string, unknown>;
      } else if (text) {
        try {
          const candidate = JSON.parse(text);
          if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
            parsed = candidate as Record<string, unknown>;
          }
        } catch {
          // keep plain-text fallback below
        }
      }

      const errorCode = typeof parsed?.error === 'string' ? parsed.error.trim() : '';
      if (errorCode === 'friendly_servers_busy' || errorCode === 'no_free_slot') {
        throw new Error('Dostluk maci icin sunucu dolu, lutfen bekleyin.');
      }
      if (errorCode === 'friendly_server_unavailable' || errorCode === 'allocation_failed') {
        throw new Error('Dostluk maci sunucusuna ulasilamiyor, lutfen tekrar deneyin.');
      }
      if (errorCode) {
        throw new Error(errorCode);
      }

      const message = typeof parsed?.message === 'string' ? parsed.message.trim() : '';
      throw new Error(message || text || `Request failed (${response.status})`);
    }

    return response.data as T;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: buildHeaders(authHeader),
      signal: controller.signal,
    });

    if (response.status === 401 && !STATIC_BEARER) {
      const refreshedAuthHeader = await resolveAuthHeaderWithRefresh();
      const retryAuthHeader = refreshedAuthHeader || authHeader;
      if (retryAuthHeader) {
        response = await fetch(`${BASE_URL.replace(/\/$/, '')}${path}`, {
          ...init,
          headers: buildHeaders(retryAuthHeader),
          signal: controller.signal,
        });
        authHeader = retryAuthHeader;
      }
    }
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Match Control API timeout (${Math.round(timeoutMs / 1000)}s).`);
    }
    throw new Error(`Match Control API ulasilamiyor: ${BASE_URL}`);
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let parsed: Record<string, unknown> | null = null;
    if (text) {
      try {
        const candidate = JSON.parse(text);
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          parsed = candidate as Record<string, unknown>;
        }
      } catch {
        // keep plain-text fallback below
      }
    }

    const errorCode = typeof parsed?.error === 'string' ? parsed.error.trim() : '';
    if (errorCode === 'friendly_servers_busy' || errorCode === 'no_free_slot') {
      throw new Error('Dostluk maci icin sunucu dolu, lutfen bekleyin.');
    }
    if (errorCode === 'friendly_server_unavailable' || errorCode === 'allocation_failed') {
      throw new Error('Dostluk maci sunucusuna ulasilamiyor, lutfen tekrar deneyin.');
    }

    if (errorCode) {
      throw new Error(errorCode);
    }

    const message = typeof parsed?.message === 'string' ? parsed.message.trim() : '';
    throw new Error(message || text || `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

export async function createFriendlyRequest(payload: {
  requesterUserId: string;
  opponentUserId?: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamPayload?: UnityRuntimeTeamPayload;
  awayTeamPayload?: UnityRuntimeTeamPayload;
}): Promise<FriendlyRequestResponse> {
  return requestJson<FriendlyRequestResponse>('/v1/friendly/requests', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 20000,
  });
}

export async function heartbeatMatchControlPresence(
  userId: string,
): Promise<PresenceHeartbeatResponse> {
  return requestJson<PresenceHeartbeatResponse>('/v1/presence/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ userId }),
    timeoutMs: 12000,
  });
}

export async function getMatchControlPresenceStats(): Promise<PresenceStatsResponse> {
  return requestJson<PresenceStatsResponse>('/v1/presence/stats', {
    method: 'GET',
    timeoutMs: 12000,
  });
}

export async function getRegisteredUsersCount(): Promise<number> {
  const snapshot = await getCountFromServer(collection(db, 'users'));
  return snapshot.data().count;
}

function toByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexChannel(value: number): string {
  return toByte(value).toString(16).padStart(2, '0');
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${hexChannel(r)}${hexChannel(g)}${hexChannel(b)}`;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const UNITY_SKIN_COLORS = [
  'SuperBright',
  'Bright',
  'LightBronze',
  'Bronze',
  'Dark',
  'SuperDark',
] as const;

const UNITY_HAIR_STYLES = [
  'None',
  'ShortHair',
  'StylishHair',
  'StylishUnordinaryHair',
  'Mohawk',
  'BobMarley',
  'ShortItalian',
] as const;

const UNITY_FACIAL_HAIR_STYLES = ['None', 'Mustache', 'Goatee', 'LongBeard'] as const;

const UNITY_HAIR_COLORS = [
  'Brown',
  'DarkBrown',
  'Black',
  'LightYellow',
  'Yellow',
  'Gray',
  'White',
  'Green',
  'DarkGreen',
  'Blue',
  'DarkBlue',
  'LightRed',
  'Red',
  'LightOrange',
  'Orange',
] as const;

const UNITY_BOOT_COLORS = ['Black', 'Red', 'Orange', 'Purple', 'Cyan', 'Gray', 'White'] as const;
const UNITY_SOCK_ACCESSORY_COLORS = ['None', 'Black', 'Gray', 'White'] as const;

type EnumValues<T extends readonly string[]> = T[number];

function normalizeEnumToken(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return raw.replace(/[\s_-]+/g, '').toLowerCase();
}

function parseExplicitIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function createEnumResolver<const T extends readonly string[]>(values: T) {
  const byNormalized = new Map<string, EnumValues<T>>();
  values.forEach((entry) => {
    byNormalized.set(normalizeEnumToken(entry) || entry.toLowerCase(), entry);
  });

  return (value: unknown): EnumValues<T> | null => {
    const numericIndex = parseExplicitIndex(value);
    if (numericIndex != null && numericIndex >= 0 && numericIndex < values.length) {
      return values[numericIndex];
    }

    const token = normalizeEnumToken(value);
    if (!token) return null;
    return byNormalized.get(token) ?? null;
  };
}

const resolveSkinColor = createEnumResolver(UNITY_SKIN_COLORS);
const resolveHairStyle = createEnumResolver(UNITY_HAIR_STYLES);
const resolveFacialHairStyle = createEnumResolver(UNITY_FACIAL_HAIR_STYLES);
const resolveHairColor = createEnumResolver(UNITY_HAIR_COLORS);
const resolveBootColor = createEnumResolver(UNITY_BOOT_COLORS);
const resolveSockAccessoryColor = createEnumResolver(UNITY_SOCK_ACCESSORY_COLORS);

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getCandidateValue(
  sources: Array<Record<string, unknown> | null>,
  keys: string[],
): unknown {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      if (key in source && source[key] != null) {
        return source[key];
      }
    }
  }
  return undefined;
}

function hashSeed(seed: string, salt: string): number {
  return hashString(`${seed}:${salt}`);
}

function pickDeterministic<const T extends readonly string[]>(
  seed: string,
  salt: string,
  values: T,
): EnumValues<T> {
  return values[hashSeed(seed, salt) % values.length];
}

function pickDeterministicInt(seed: string, salt: string, min: number, max: number): number {
  const span = Math.max(1, max - min + 1);
  return min + (hashSeed(seed, salt) % span);
}

function deterministicFacialHair(seed: string): EnumValues<typeof UNITY_FACIAL_HAIR_STYLES> {
  const roll = hashSeed(seed, 'facialHairWeighted') % 100;
  if (roll < 58) return 'None';
  if (roll < 73) return 'Mustache';
  if (roll < 91) return 'Goatee';
  return 'LongBeard';
}

function buildUnityPlayerVisualPayload(player: ClubPlayer, order: number, teamSeed: string): UnityRuntimePlayerVisualPayload {
  const rawPlayer = player as unknown as Record<string, unknown>;
  const nestedVisual = asObjectRecord(rawPlayer.visual);
  const nestedAppearance = asObjectRecord(rawPlayer.appearance);
  const sources = [nestedVisual, nestedAppearance, rawPlayer];
  const seed = `${teamSeed}:${String(player.uniqueId || player.id || `p_${order}`)}:${String(player.name || '')}:${order}`;

  const skinColor =
    resolveSkinColor(getCandidateValue(sources, ['skinColor', 'skin', 'skinTone'])) ??
    pickDeterministic(seed, 'skinColor', UNITY_SKIN_COLORS);
  const hairStyle =
    resolveHairStyle(getCandidateValue(sources, ['hairStyle', 'hairStyles'])) ??
    pickDeterministic(seed, 'hairStyle', UNITY_HAIR_STYLES);
  const hairColor =
    resolveHairColor(getCandidateValue(sources, ['hairColor'])) ??
    pickDeterministic(seed, 'hairColor', UNITY_HAIR_COLORS);
  const facialHairStyle =
    resolveFacialHairStyle(getCandidateValue(sources, ['facialHairStyle', 'facialHairStyles'])) ??
    deterministicFacialHair(seed);
  const facialHairColor =
    resolveHairColor(getCandidateValue(sources, ['facialHairColor'])) ??
    pickDeterministic(seed, 'facialHairColor', UNITY_HAIR_COLORS);
  const bootColor =
    resolveBootColor(getCandidateValue(sources, ['bootColor', 'bootsColor'])) ??
    pickDeterministic(seed, 'bootColor', UNITY_BOOT_COLORS);
  const sockAccessoryColor =
    resolveSockAccessoryColor(getCandidateValue(sources, ['sockAccessoryColor', 'sockColor'])) ??
    pickDeterministic(seed, 'sockAccessoryColor', UNITY_SOCK_ACCESSORY_COLORS);

  return {
    skinColor,
    hairStyle,
    hairColor,
    facialHairStyle,
    facialHairColor,
    bootColor,
    sockAccessoryColor,
  };
}

function deriveKitColors(seedSource: string): UnityRuntimeKitPayload {
  const hash = hashString(seedSource || 'team');
  const hue = hash % 360;

  const hsvToRgb = (h: number, s: number, v: number) => {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0; let g = 0; let b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return {
      r: (r + m) * 255,
      g: (g + m) * 255,
      b: (b + m) * 255,
    };
  };

  const luminance = (rgb: { r: number; g: number; b: number }) =>
    ((0.2126 * rgb.r) + (0.7152 * rgb.g) + (0.0722 * rgb.b)) / 255;

  const primary = hsvToRgb(hue, 0.72, 0.82);
  const primaryLuma = luminance(primary);

  let secondary = hsvToRgb(hue, primaryLuma > 0.45 ? 0.30 : 0.18, primaryLuma > 0.45 ? 0.22 : 0.84);
  if (Math.abs(primaryLuma - luminance(secondary)) < 0.28) {
    secondary = hsvToRgb((hue + 180) % 360, 0.18, primaryLuma > 0.45 ? 0.20 : 0.86);
  }

  const keeper = hsvToRgb((hue + 110) % 360, 0.68, 0.70);
  const keeperAlt = hsvToRgb((hue + 140) % 360, 0.35, 0.28);
  const text = primaryLuma > 0.62 ? '#111111' : '#ffffff';

  return {
    primary: rgbToHex(primary.r, primary.g, primary.b),
    secondary: rgbToHex(secondary.r, secondary.g, secondary.b),
    text,
    gkPrimary: rgbToHex(keeper.r, keeper.g, keeper.b),
    gkSecondary: rgbToHex(keeperAlt.r, keeperAlt.g, keeperAlt.b),
  };
}

function toUnityStatValue(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric <= 1.5) {
    return Math.max(0, Math.min(100, Math.round(numeric * 100)));
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function toUnityHeightValue(value: unknown, seed: string): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return pickDeterministicInt(seed, 'heightFallback', 170, 195);
  return Math.max(150, Math.min(210, Math.round(numeric)));
}

function toUnityWeightValue(value: unknown, seed: string): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return pickDeterministicInt(seed, 'weightFallback', 60, 90);
  return Math.max(45, Math.min(110, Math.round(numeric)));
}

function toUnityPlayerPayload(player: ClubPlayer, order: number, teamSeed: string): UnityRuntimePlayerPayload {
  const playerSeed = `${teamSeed}:${String(player.uniqueId || player.id || `p_${order}`)}:${String(player.name || '')}:${order}`;
  return {
    playerId: String(player.uniqueId || player.id || `p_${order}`),
    name: String(player.name || `Player ${order + 1}`),
    order,
    attributes: {
      strength: toUnityStatValue(player.attributes?.strength),
      acceleration: toUnityStatValue(player.attributes?.acceleration),
      topSpeed: toUnityStatValue(player.attributes?.topSpeed),
      dribbleSpeed: toUnityStatValue(player.attributes?.dribbleSpeed),
      jump: toUnityStatValue(player.attributes?.jump),
      tackling: toUnityStatValue(player.attributes?.tackling),
      ballKeeping: toUnityStatValue(player.attributes?.ballKeeping),
      passing: toUnityStatValue(player.attributes?.passing),
      longBall: toUnityStatValue(player.attributes?.longBall),
      agility: toUnityStatValue(player.attributes?.agility),
      shooting: toUnityStatValue(player.attributes?.shooting),
      shootPower: toUnityStatValue(player.attributes?.shootPower),
      positioning: toUnityStatValue(player.attributes?.positioning),
      reaction: toUnityStatValue(player.attributes?.reaction),
      ballControl: toUnityStatValue(player.attributes?.ballControl),
      height: toUnityHeightValue(player.height, playerSeed),
      weight: toUnityWeightValue(player.weight, playerSeed),
    },
    visual: buildUnityPlayerVisualPayload(player, order, teamSeed),
  };
}

function stableSortPlayers(players: ClubPlayer[]): ClubPlayer[] {
  return [...players].sort((a, b) => {
    const roleRank = (p: ClubPlayer) => {
      if (p.squadRole === 'starting') return 0;
      if (p.squadRole === 'bench') return 1;
      return 2;
    };
    const orderA = Number.isFinite(a.order as number) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(b.order as number) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
    return roleRank(a) - roleRank(b) || orderA - orderB || String(a.id).localeCompare(String(b.id));
  });
}

function pickPlayersById(ids: string[] | undefined, pool: ClubPlayer[]): ClubPlayer[] {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const byId = new Map(pool.map((p) => [String(p.id), p]));
  const result: ClubPlayer[] = [];
  for (const id of ids) {
    const player = byId.get(String(id));
    if (player) result.push(player);
  }
  return result;
}

export function buildUnityRuntimeTeamPayload(team: ClubTeam | null | undefined): UnityRuntimeTeamPayload | undefined {
  if (!team || !Array.isArray(team.players) || team.players.length === 0) {
    return undefined;
  }

  const allPlayers = stableSortPlayers(team.players);
  const lineupIds =
    team.lineup?.starters?.map(String) ||
    team.plan?.starters?.map(String) ||
    [];
  const benchIds =
    team.lineup?.subs?.map(String) ||
    team.plan?.bench?.map(String) ||
    [];

  let lineupPlayers = pickPlayersById(lineupIds, allPlayers);
  let benchPlayers = pickPlayersById(benchIds, allPlayers);

  if (lineupPlayers.length === 0) {
    lineupPlayers = allPlayers.filter((p) => p.squadRole === 'starting').slice(0, 11);
  }

  const selectedIds = new Set(lineupPlayers.map((p) => String(p.id)));
  if (benchPlayers.length === 0) {
    benchPlayers = allPlayers.filter((p) => !selectedIds.has(String(p.id)) && p.squadRole === 'bench');
  } else {
    benchPlayers = benchPlayers.filter((p) => !selectedIds.has(String(p.id)));
  }

  if (lineupPlayers.length < 11) {
    for (const player of allPlayers) {
      if (selectedIds.has(String(player.id))) continue;
      lineupPlayers.push(player);
      selectedIds.add(String(player.id));
      if (lineupPlayers.length >= 11) break;
    }
  }

  while (lineupPlayers.length < 11) {
    const fakeId = `bot_lineup_${lineupPlayers.length}`;
    const botPlayer: ClubPlayer = {
      id: fakeId,
      name: `Player ${lineupPlayers.length + 1}`,
      position: 'CM',
      roles: ['CM'],
      overall: 50,
      potential: 50,
      attributes: {
        strength: 50, acceleration: 50, topSpeed: 50, dribbleSpeed: 50,
        jump: 50, tackling: 50, ballKeeping: 50, passing: 50,
        longBall: 50, agility: 50, shooting: 50, shootPower: 50,
        positioning: 50, reaction: 50, ballControl: 50
      },
      age: 20,
      height: 180,
      weight: 75,
      condition: 100,
      motivation: 100,
      squadRole: 'starting',
    };
    lineupPlayers.push(botPlayer);
    selectedIds.add(fakeId);
  }

  const benchSelected = new Set<string>(selectedIds);
  if (benchPlayers.length < 12) {
    for (const player of allPlayers) {
      const id = String(player.id);
      if (benchSelected.has(id)) continue;
      benchPlayers.push(player);
      benchSelected.add(id);
      if (benchPlayers.length >= 12) break;
    }
  }

  while (benchPlayers.length < 12) {
    const fakeId = `bot_bench_${benchPlayers.length}`;
    const botPlayer: ClubPlayer = {
      id: fakeId,
      name: `Sub ${benchPlayers.length + 1}`,
      position: 'CM',
      roles: ['CM'],
      overall: 50,
      potential: 50,
      attributes: {
        strength: 50, acceleration: 50, topSpeed: 50, dribbleSpeed: 50,
        jump: 50, tackling: 50, ballKeeping: 50, passing: 50,
        longBall: 50, agility: 50, shooting: 50, shootPower: 50,
        positioning: 50, reaction: 50, ballControl: 50
      },
      age: 20,
      height: 180,
      weight: 75,
      condition: 100,
      motivation: 100,
      squadRole: 'bench',
    };
    benchPlayers.push(botPlayer);
    benchSelected.add(fakeId);
  }

  const seed = `${team.id}:${team.name}`;
  const kit = deriveKitColors(seed);

  return {
    teamKey: String(team.id || team.name),
    teamName: String(team.name || team.id || 'Team'),
    formation: String(team.lineup?.formation || team.plan?.formation || '4-2-3-1'),
    kit,
    lineup: lineupPlayers.slice(0, 11).map((player, idx) => toUnityPlayerPayload(player, idx, seed)),
    bench: benchPlayers.map((player, idx) => toUnityPlayerPayload(player, 11 + idx, seed)),
  };
}

export async function listFriendlyRequests(userId: string): Promise<FriendlyRequestListItem[]> {
  const response = await requestJson<{ items?: FriendlyRequestListItem[] }>(
    `/v1/friendly/requests?userId=${encodeURIComponent(userId)}`,
    { method: 'GET' },
  );
  return Array.isArray(response.items) ? response.items : [];
}

export async function getFriendlyRequestStatus(requestId: string): Promise<FriendlyRequestStatusResponse> {
  return requestJson<FriendlyRequestStatusResponse>(`/v1/friendly/requests/${encodeURIComponent(requestId)}`, {
    method: 'GET',
  });
}

export async function listFriendlyMatchHistory(payload: {
  userId: string;
  opponentUserId?: string | null;
  limit?: number;
}): Promise<FriendlyMatchHistoryItem[]> {
  const params = new URLSearchParams();
  params.set('userId', payload.userId);
  if (payload.opponentUserId?.trim()) {
    params.set('opponentUserId', payload.opponentUserId.trim());
  }
  if (payload.limit && Number.isFinite(payload.limit)) {
    params.set('limit', String(Math.max(1, Math.floor(payload.limit))));
  }

  const response = await requestJson<{ items?: FriendlyMatchHistoryItem[] }>(
    `/v1/friendly/history?${params.toString()}`,
    { method: 'GET' },
  );

  return Array.isArray(response.items) ? response.items : [];
}

export async function acceptFriendlyRequest(
  requestId: string,
  payload: { acceptingUserId: string; maxClients?: number; role?: 'player' | 'spectator' },
): Promise<MatchAllocationResponse> {
  return requestJson<MatchAllocationResponse>(
    `/v1/friendly/requests/${encodeURIComponent(requestId)}/accept`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 20000,
    },
  );
}

export async function requestJoinTicket(payload: {
  matchId: string;
  userId: string;
  role?: 'player' | 'spectator';
}): Promise<JoinTicketResponse> {
  return requestJson<JoinTicketResponse>(`/v1/matches/${encodeURIComponent(payload.matchId)}/join-ticket`, {
    method: 'POST',
    body: JSON.stringify({
      userId: payload.userId,
      role: payload.role || 'player',
    }),
    timeoutMs: 20000,
  });
}

export async function getMatchStatus(matchId: string): Promise<MatchStatusResponse> {
  return requestJson<MatchStatusResponse>(`/v1/matches/${encodeURIComponent(matchId)}/status`, {
    method: 'GET',
  });
}

export async function getMatchControlHealth(): Promise<MatchControlHealthResponse> {
  return requestPublicJson<MatchControlHealthResponse>('/health', 6000);
}

export async function waitForMatchReady(
  matchId: string,
  options?: {
    timeoutMs?: number;
    pollMs?: number;
    readyStates?: Iterable<string>;
  },
): Promise<MatchStatusResponse> {
  const timeoutMs = Math.max(1000, Number(options?.timeoutMs || 90000));
  const pollMs = Math.max(200, Number(options?.pollMs || 600));
  const readyStates = new Set(
    Array.from(options?.readyStates || MATCH_READY_STATES, (state) =>
      String(state || '').trim().toLowerCase(),
    ).filter(Boolean),
  );
  const deadline = Date.now() + timeoutMs;
  let lastStatus: MatchStatusResponse | null = null;

  while (Date.now() < deadline) {
    const status = await getMatchStatus(matchId);
    lastStatus = status;
    const normalizedState = String(status.state || '').trim().toLowerCase();

    if (readyStates.has(normalizedState)) {
      return status;
    }

    if (MATCH_TERMINAL_STATES.has(normalizedState)) {
      throw new Error(`Match hazir olmadan ${normalizedState} durumuna gecti.`);
    }

    await new Promise((resolve) => window.setTimeout(resolve, pollMs));
  }

  throw new Error(
    `Match hazir olmadi. Son durum: ${lastStatus?.state || 'unknown'}.`,
  );
}

export function getFriendlyMatchReadyStates(): Set<string> {
  return new Set(FRIENDLY_MATCH_READY_STATES);
}
