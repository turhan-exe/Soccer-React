type TeamPlanPayload = {
  formation?: string;
  shape?: string;
  tactics?: Record<string, any>;
  starters?: string[];
  subs?: string[];
  reserves?: string[];
  bench?: string[];
  slotAssignments?: TeamSlotAssignmentPayload[];
  customFormations?: Record<string, Record<string, { x?: number; y?: number; position?: string }>>;
};

type TeamSlotAssignmentPayload = {
  playerId: string;
  slotIndex: number;
  position: string;
  x: number;
  y: number;
};

type UnityRuntimePlayerPayload = {
  playerId: string;
  name: string;
  order: number;
  attributes: Record<string, number>;
};

type UnityRuntimeKitPayload = {
  primary: string;
  secondary: string;
  text: string;
  gkPrimary: string;
  gkSecondary: string;
};

export type UnityRuntimeTeamPayload = {
  id: string;
  teamId: string;
  name: string;
  clubName: string;
  manager?: string;
  isBot?: boolean;
  botId?: string;
  badge?: unknown;
  logo?: unknown;
  players?: any[];
  plan?: TeamPlanPayload;
  teamKey: string;
  teamName: string;
  formation: string;
  shape?: string;
  kit: UnityRuntimeKitPayload;
  lineup: UnityRuntimePlayerPayload[];
  bench: UnityRuntimePlayerPayload[];
  slotAssignments?: TeamSlotAssignmentPayload[];
};

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number) => clampByte(value).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function hsvToRgb(h: number, s: number, v: number) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
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
}

function luminance(rgb: { r: number; g: number; b: number }) {
  return ((0.2126 * rgb.r) + (0.7152 * rgb.g) + (0.0722 * rgb.b)) / 255;
}

function deriveKitColors(seedSource: string): UnityRuntimeKitPayload {
  const hash = hashString(seedSource || 'team');
  const hue = hash % 360;
  const primary = hsvToRgb(hue, 0.72, 0.82);
  const primaryLuma = luminance(primary);
  let secondary = hsvToRgb(
    hue,
    primaryLuma > 0.45 ? 0.3 : 0.18,
    primaryLuma > 0.45 ? 0.22 : 0.84,
  );

  if (Math.abs(primaryLuma - luminance(secondary)) < 0.28) {
    secondary = hsvToRgb((hue + 180) % 360, 0.18, primaryLuma > 0.45 ? 0.2 : 0.86);
  }

  const keeper = hsvToRgb((hue + 110) % 360, 0.68, 0.7);
  const keeperAlt = hsvToRgb((hue + 140) % 360, 0.35, 0.28);

  return {
    primary: rgbToHex(primary.r, primary.g, primary.b),
    secondary: rgbToHex(secondary.r, secondary.g, secondary.b),
    text: primaryLuma > 0.62 ? '#111111' : '#ffffff',
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

function toUnityHeightValue(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 180;
  return Math.max(150, Math.min(210, Math.round(numeric)));
}

function toUnityWeightValue(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 75;
  return Math.max(45, Math.min(110, Math.round(numeric)));
}

function normalizeIdList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value)).filter(Boolean);
}

function stableSortPlayers(players: any[]): any[] {
  return [...players].sort((left, right) => {
    const roleRank = (player: any) => {
      if (player?.squadRole === 'starting') return 0;
      if (player?.squadRole === 'bench') return 1;
      return 2;
    };

    const leftOrder = Number.isFinite(left?.order) ? Number(left.order) : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right?.order) ? Number(right.order) : Number.MAX_SAFE_INTEGER;
    return (
      roleRank(left) - roleRank(right) ||
      leftOrder - rightOrder ||
      String(left?.id || '').localeCompare(String(right?.id || ''))
    );
  });
}

function pickPlayersById(ids: string[], pool: any[]): any[] {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const byId = new Map(pool.map((player) => [String(player?.id ?? player?.uniqueId ?? ''), player]));
  const result: any[] = [];
  for (const id of ids) {
    const player = byId.get(String(id));
    if (player) {
      result.push(player);
    }
  }
  return result;
}

function createFallbackPlayer(id: string, name: string, squadRole: 'starting' | 'bench') {
  return {
    id,
    name,
    position: 'CM',
    roles: ['CM'],
    overall: 50,
    potential: 50,
    attributes: {
      strength: 50,
      acceleration: 50,
      topSpeed: 50,
      dribbleSpeed: 50,
      jump: 50,
      tackling: 50,
      ballKeeping: 50,
      passing: 50,
      longBall: 50,
      agility: 50,
      shooting: 50,
      shootPower: 50,
      positioning: 50,
      reaction: 50,
      ballControl: 50,
    },
    age: 20,
    height: 180,
    weight: 75,
    condition: 100,
    motivation: 100,
    squadRole,
  };
}

function toUnityPlayerPayload(player: any, order: number): UnityRuntimePlayerPayload {
  return {
    playerId: String(player?.uniqueId || player?.id || `p_${order}`),
    name: String(player?.name || `Player ${order + 1}`),
    order,
    attributes: {
      strength: toUnityStatValue(player?.attributes?.strength),
      acceleration: toUnityStatValue(player?.attributes?.acceleration),
      topSpeed: toUnityStatValue(player?.attributes?.topSpeed),
      dribbleSpeed: toUnityStatValue(player?.attributes?.dribbleSpeed),
      jump: toUnityStatValue(player?.attributes?.jump),
      tackling: toUnityStatValue(player?.attributes?.tackling),
      ballKeeping: toUnityStatValue(player?.attributes?.ballKeeping),
      passing: toUnityStatValue(player?.attributes?.passing),
      longBall: toUnityStatValue(player?.attributes?.longBall),
      agility: toUnityStatValue(player?.attributes?.agility),
      shooting: toUnityStatValue(player?.attributes?.shooting),
      shootPower: toUnityStatValue(player?.attributes?.shootPower),
      positioning: toUnityStatValue(player?.attributes?.positioning),
      reaction: toUnityStatValue(player?.attributes?.reaction),
      ballControl: toUnityStatValue(player?.attributes?.ballControl),
      height: toUnityHeightValue(player?.height),
      weight: toUnityWeightValue(player?.weight),
    },
  };
}

function resolveFormation(data: any): string {
  return String(
    data?.lineup?.formation ||
      data?.plan?.formation ||
      data?.lineup?.shape ||
      data?.plan?.shape ||
      '4-2-3-1',
  );
}

function resolveShape(data: any): string | undefined {
  const value =
    data?.lineup?.shape ||
    data?.plan?.shape;
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeSlotAssignments(values: unknown): TeamSlotAssignmentPayload[] | undefined {
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }

  const normalized = values
    .map((value) => {
      if (!value || typeof value !== 'object') {
        return null;
      }

      const playerId = String((value as { playerId?: unknown }).playerId || '').trim();
      const slotIndex = Number((value as { slotIndex?: unknown }).slotIndex);
      if (!playerId || !Number.isFinite(slotIndex) || slotIndex < 0) {
        return null;
      }

      const position = String((value as { position?: unknown }).position || '').trim() || 'CM';
      const x = Number((value as { x?: unknown }).x);
      const y = Number((value as { y?: unknown }).y);

      return {
        playerId,
        slotIndex: Math.floor(slotIndex),
        position,
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
      } satisfies TeamSlotAssignmentPayload;
    })
    .filter((value): value is TeamSlotAssignmentPayload => value !== null)
    .sort((left, right) => left.slotIndex - right.slotIndex);

  return normalized.length > 0 ? normalized : undefined;
}

function resolvePlan(data: any): TeamPlanPayload | undefined {
  const starters = normalizeIdList(data?.lineup?.starters || data?.plan?.starters);
  const subs = normalizeIdList(data?.lineup?.subs || data?.plan?.subs || data?.plan?.bench);
  const reserves = normalizeIdList(data?.lineup?.reserves || data?.plan?.reserves);
  const formation = resolveFormation(data);
  const shape = resolveShape(data);
  const tactics = data?.lineup?.tactics || data?.plan?.tactics;
  const slotAssignments = normalizeSlotAssignments(
    data?.lineup?.slotAssignments || data?.plan?.slotAssignments,
  );
  const customFormations =
    data?.lineup?.customFormations && typeof data.lineup.customFormations === 'object'
      ? data.lineup.customFormations
      : data?.plan?.customFormations && typeof data.plan.customFormations === 'object'
        ? data.plan.customFormations
        : undefined;

  if (
    !formation &&
    !shape &&
    starters.length === 0 &&
    subs.length === 0 &&
    reserves.length === 0 &&
    !tactics &&
    !slotAssignments
  ) {
    return undefined;
  }

  return {
    formation,
    shape,
    tactics: tactics && typeof tactics === 'object' ? tactics : undefined,
    starters: starters.length ? starters : undefined,
    subs: subs.length ? subs : undefined,
    bench: subs.length ? subs : undefined,
    reserves: reserves.length ? reserves : undefined,
    slotAssignments,
    customFormations,
  };
}

export function buildUnityRuntimeTeamPayload(teamId: string, data: any): UnityRuntimeTeamPayload {
  const teamName = String(data?.name || data?.clubName || teamId);
  const allPlayers = stableSortPlayers(Array.isArray(data?.players) ? data.players : []);
  const lineupIds = normalizeIdList(data?.lineup?.starters || data?.plan?.starters);
  const benchIds = normalizeIdList(data?.lineup?.subs || data?.plan?.bench || data?.plan?.subs);
  const reserveIds = normalizeIdList(data?.lineup?.reserves || data?.plan?.reserves);
  const formation = resolveFormation(data);
  const shape = resolveShape(data);
  const slotAssignments = normalizeSlotAssignments(
    data?.lineup?.slotAssignments || data?.plan?.slotAssignments,
  );

  let lineupPlayers = pickPlayersById(lineupIds, allPlayers);
  let benchPlayers = [
    ...pickPlayersById(benchIds, allPlayers),
    ...pickPlayersById(reserveIds, allPlayers),
  ];

  if (lineupPlayers.length === 0) {
    lineupPlayers = allPlayers.filter((player) => player?.squadRole === 'starting').slice(0, 11);
  }

  const selectedIds = new Set(lineupPlayers.map((player) => String(player?.id ?? player?.uniqueId ?? '')));

  if (benchPlayers.length === 0) {
    benchPlayers = allPlayers.filter(
      (player) =>
        !selectedIds.has(String(player?.id ?? player?.uniqueId ?? '')) &&
        player?.squadRole !== 'starting',
    );
  } else {
    benchPlayers = benchPlayers.filter(
      (player) => !selectedIds.has(String(player?.id ?? player?.uniqueId ?? '')),
    );
  }

  for (const player of allPlayers) {
    if (lineupPlayers.length >= 11) break;
    const playerId = String(player?.id ?? player?.uniqueId ?? '');
    if (!selectedIds.has(playerId)) {
      lineupPlayers.push(player);
      selectedIds.add(playerId);
    }
  }

  while (lineupPlayers.length < 11) {
    const fakeId = `bot_lineup_${lineupPlayers.length}`;
    lineupPlayers.push(createFallbackPlayer(fakeId, `Player ${lineupPlayers.length + 1}`, 'starting'));
    selectedIds.add(fakeId);
  }

  const benchSelectedIds = new Set(selectedIds);
  for (const player of allPlayers) {
    const playerId = String(player?.id ?? player?.uniqueId ?? '');
    if (benchSelectedIds.has(playerId)) continue;
    benchPlayers.push(player);
    benchSelectedIds.add(playerId);
  }

  const seed = `${teamId}:${teamName}`;
  return {
    id: teamId,
    teamId,
    name: teamName,
    clubName: String(data?.clubName || data?.name || teamId),
    manager: data?.manager,
    isBot: data?.isBot,
    botId: data?.botId,
    badge: data?.badge,
    logo: data?.logo ?? null,
    players: Array.isArray(data?.players) ? data.players : undefined,
    plan: resolvePlan(data),
    teamKey: teamId,
    teamName,
    formation,
    ...(shape ? { shape } : {}),
    kit: deriveKitColors(seed),
    lineup: lineupPlayers.slice(0, 11).map((player, index) => toUnityPlayerPayload(player, index)),
    bench: benchPlayers.map((player, index) => toUnityPlayerPayload(player, 11 + index)),
    ...(slotAssignments ? { slotAssignments } : {}),
  };
}
