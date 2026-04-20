export type TeamPlanPayload = {
  formation?: string;
  shape?: string;
  tactics?: Record<string, any>;
  starters?: string[];
  subs?: string[];
  reserves?: string[];
  bench?: string[];
  slotAssignments?: TeamSlotAssignmentPayload[];
  customFormations?: Record<
    string,
    Record<string, { x?: number; y?: number; position?: string; zoneId?: string }>
  >;
};

export type TeamSlotAssignmentPayload = {
  playerId: string;
  slotIndex: number;
  position: string;
  x: number;
  y: number;
  zoneId?: string;
};

type UnityRuntimePlayerPayload = {
  playerId: string;
  name: string;
  order: number;
  attributes: Record<string, number>;
  visual?: UnityRuntimePlayerVisualPayload;
};

type UnityRuntimePlayerVisualPayload = {
  skinColor: string;
  hairStyle: string;
  hairColor: string;
  facialHairStyle: string;
  facialHairColor: string;
  bootColor: string;
  sockAccessoryColor: string;
};

type UnityRuntimeKitPayload = {
  primary: string;
  secondary: string;
  text: string;
  gkPrimary: string;
  gkSecondary: string;
};

export type FormationSlot = {
  position: string;
  x: number;
  y: number;
};

type ManualFormationMap = Record<
  string,
  { x?: number; y?: number; position?: string; zoneId?: string }
>;

const UNITY_SKIN_COLORS = ['Bright', 'White', 'Brown', 'Black'] as const;
const UNITY_HAIR_STYLES = [
  'ShortHair',
  'LongHair',
  'Ponytail',
  'PartedHair',
  'Mohawk',
  'Bald',
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

export type UnityRuntimeTeamPayload = {
  teamKey: string;
  teamName: string;
  formation: string;
  shape?: string;
  kit: UnityRuntimeKitPayload;
  lineup: UnityRuntimePlayerPayload[];
  bench: UnityRuntimePlayerPayload[];
  slotAssignments?: TeamSlotAssignmentPayload[];
  plan?: TeamPlanPayload;
};

const FORMATION_SLOTS: Record<string, FormationSlot[]> = {
  '4-4-2': [
    { position: 'GK', x: 45, y: 95 },
    { position: 'LB', x: 15, y: 70 },
    { position: 'CB', x: 35, y: 65 },
    { position: 'CB', x: 65, y: 65 },
    { position: 'RB', x: 85, y: 70 },
    { position: 'LM', x: 15, y: 45 },
    { position: 'CM', x: 40, y: 45 },
    { position: 'CM', x: 60, y: 45 },
    { position: 'RM', x: 85, y: 45 },
    { position: 'ST', x: 40, y: 20 },
    { position: 'ST', x: 60, y: 20 },
  ],
  '4-3-3': [
    { position: 'GK', x: 45, y: 95 },
    { position: 'LB', x: 15, y: 70 },
    { position: 'CB', x: 35, y: 65 },
    { position: 'CB', x: 65, y: 65 },
    { position: 'RB', x: 85, y: 70 },
    { position: 'CM', x: 30, y: 45 },
    { position: 'CM', x: 50, y: 40 },
    { position: 'CM', x: 70, y: 45 },
    { position: 'LW', x: 20, y: 25 },
    { position: 'ST', x: 50, y: 15 },
    { position: 'RW', x: 80, y: 25 },
  ],
  '3-5-2': [
    { position: 'GK', x: 45, y: 95 },
    { position: 'CB', x: 30, y: 70 },
    { position: 'CB', x: 50, y: 65 },
    { position: 'CB', x: 70, y: 70 },
    { position: 'LM', x: 10, y: 45 },
    { position: 'CM', x: 30, y: 45 },
    { position: 'CM', x: 50, y: 40 },
    { position: 'CM', x: 70, y: 45 },
    { position: 'RM', x: 90, y: 45 },
    { position: 'ST', x: 40, y: 20 },
    { position: 'ST', x: 60, y: 20 },
  ],
  '4-5-1': [
    { position: 'GK', x: 45, y: 95 },
    { position: 'LB', x: 15, y: 70 },
    { position: 'CB', x: 35, y: 65 },
    { position: 'CB', x: 65, y: 65 },
    { position: 'RB', x: 85, y: 70 },
    { position: 'LM', x: 15, y: 50 },
    { position: 'CM', x: 35, y: 50 },
    { position: 'CAM', x: 50, y: 45 },
    { position: 'CM', x: 65, y: 50 },
    { position: 'RM', x: 85, y: 50 },
    { position: 'ST', x: 50, y: 20 },
  ],
  '4-2-3-1': [
    { position: 'GK', x: 45, y: 95 },
    { position: 'LB', x: 15, y: 70 },
    { position: 'CB', x: 35, y: 65 },
    { position: 'CB', x: 65, y: 65 },
    { position: 'RB', x: 85, y: 70 },
    { position: 'CM', x: 40, y: 55 },
    { position: 'CM', x: 60, y: 55 },
    { position: 'LW', x: 20, y: 35 },
    { position: 'CAM', x: 50, y: 35 },
    { position: 'RW', x: 80, y: 35 },
    { position: 'ST', x: 50, y: 20 },
  ],
  '5-3-2': [
    { position: 'GK', x: 45, y: 95 },
    { position: 'LB', x: 10, y: 70 },
    { position: 'CB', x: 30, y: 65 },
    { position: 'CB', x: 50, y: 60 },
    { position: 'CB', x: 70, y: 65 },
    { position: 'RB', x: 90, y: 70 },
    { position: 'CM', x: 35, y: 45 },
    { position: 'CM', x: 50, y: 40 },
    { position: 'CM', x: 65, y: 45 },
    { position: 'ST', x: 40, y: 20 },
    { position: 'ST', x: 60, y: 20 },
  ],
  '5-4-1': [
    { position: 'GK', x: 45, y: 95 },
    { position: 'LB', x: 10, y: 70 },
    { position: 'CB', x: 30, y: 65 },
    { position: 'CB', x: 50, y: 60 },
    { position: 'CB', x: 70, y: 65 },
    { position: 'RB', x: 90, y: 70 },
    { position: 'LM', x: 20, y: 50 },
    { position: 'CM', x: 40, y: 50 },
    { position: 'CM', x: 60, y: 50 },
    { position: 'RM', x: 80, y: 50 },
    { position: 'ST', x: 50, y: 20 },
  ],
  '3-4-3': [
    { position: 'GK', x: 45, y: 95 },
    { position: 'CB', x: 30, y: 70 },
    { position: 'CB', x: 50, y: 65 },
    { position: 'CB', x: 70, y: 70 },
    { position: 'LM', x: 10, y: 50 },
    { position: 'CM', x: 40, y: 50 },
    { position: 'CM', x: 60, y: 50 },
    { position: 'RM', x: 90, y: 50 },
    { position: 'LW', x: 20, y: 25 },
    { position: 'ST', x: 50, y: 15 },
    { position: 'RW', x: 80, y: 25 },
  ],
  '4-1-4-1': [
    { position: 'GK', x: 45, y: 95 },
    { position: 'LB', x: 15, y: 70 },
    { position: 'CB', x: 35, y: 65 },
    { position: 'CB', x: 65, y: 65 },
    { position: 'RB', x: 85, y: 70 },
    { position: 'CM', x: 50, y: 55 },
    { position: 'LM', x: 15, y: 40 },
    { position: 'CM', x: 35, y: 40 },
    { position: 'CM', x: 65, y: 40 },
    { position: 'RM', x: 85, y: 40 },
    { position: 'ST', x: 50, y: 20 },
  ],
};

export function normalizePositionKey(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

export function canonicalizePosition(value: unknown, fallback = 'CM'): string {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  const normalized = normalizePositionKey(value);
  if (!normalized) {
    return fallback;
  }

  const aliases: Record<string, string> = {
    GK: 'GK',
    KL: 'GK',
    GOALKEEPER: 'GK',
    GOALIE: 'GK',
    CB: 'CB',
    STP: 'CB',
    STOPER: 'CB',
    DEF: 'CB',
    RCB: 'CB',
    LCB: 'CB',
    LB: 'LB',
    SLB: 'LB',
    LWB: 'LB',
    RB: 'RB',
    SGB: 'RB',
    RWB: 'RB',
    CM: 'CM',
    MO: 'CM',
    CMF: 'CM',
    MID: 'CM',
    DM: 'CM',
    DMF: 'CM',
    CDM: 'CM',
    LM: 'LM',
    SLO: 'LM',
    LMF: 'LM',
    RM: 'RM',
    SGO: 'RM',
    RMF: 'RM',
    CAM: 'CAM',
    OOS: 'CAM',
    AM: 'CAM',
    AMF: 'CAM',
    LW: 'LW',
    SLK: 'LW',
    LWF: 'LW',
    RW: 'RW',
    SGK: 'RW',
    RWF: 'RW',
    ST: 'ST',
    SF: 'ST',
    SANTRAFOR: 'ST',
    FORVET: 'ST',
    STRIKER: 'ST',
    SS: 'ST',
  };

  return aliases[normalized] || fallback;
}

function clampPercentage(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Number(Math.max(0, Math.min(100, numeric)).toFixed(4));
}

const ZONE_POSITION_MAP: Record<string, string> = {
  'santrafor': 'ST',
  'gizli forvet': 'CAM',
  'sol açık': 'LW',
  'sağ açık': 'RW',
  'sol kanat': 'LM',
  'sağ kanat': 'RM',
  'ofansif orta saha': 'CAM',
  'merkez orta saha': 'CM',
  'defansif orta saha sol': 'CM',
  'defansif orta saha sağ': 'CM',
  'ön libero': 'CM',
  'sol bek': 'LB',
  'sağ bek': 'RB',
  'stoper sol': 'CB',
  'stoper sağ': 'CB',
  'kaleci': 'GK',
};

const LEGACY_ZONE_ID_MAP: Record<string, string> = {
  'sol aÃ§Ä±k': 'sol açık',
  'sol aÃƒÂ§Ã„Â±k': 'sol açık',
  'sol aÃƒÆ’Ã‚Â§Ãƒâ€Ã‚Â±k': 'sol açık',
  'saÄŸ açık': 'sağ açık',
  'saÃ„Å¸ aÃƒÂ§Ã„Â±k': 'sağ açık',
  'saÃƒâ€Ã…Â¸ aÃƒÆ’Ã‚Â§Ãƒâ€Ã‚Â±k': 'sağ açık',
  'saÄŸ kanat': 'sağ kanat',
  'saÃ„Å¸ kanat': 'sağ kanat',
  'saÃƒâ€Ã…Â¸ kanat': 'sağ kanat',
  'defansif orta saha sağ': 'defansif orta saha sağ',
  'defansif orta saha saÃ„Å¸': 'defansif orta saha sağ',
  'defansif orta saha saÃƒâ€Ã…Â¸': 'defansif orta saha sağ',
  'ön libero': 'ön libero',
  'Ã¶n libero': 'ön libero',
  'ÃƒÂ¶n libero': 'ön libero',
  'ÃƒÆ’Ã‚Â¶n libero': 'ön libero',
  'sağ bek': 'sağ bek',
  'saÃ„Å¸ bek': 'sağ bek',
  'saÃƒâ€Ã…Â¸ bek': 'sağ bek',
  'stoper sağ': 'stoper sağ',
  'stoper saÃ„Å¸': 'stoper sağ',
  'stoper saÃƒâ€Ã…Â¸': 'stoper sağ',
};

function normalizeZoneId(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed in ZONE_POSITION_MAP) {
    return trimmed;
  }

  return LEGACY_ZONE_ID_MAP[trimmed] ?? null;
}

function resolveZoneIdFromCoordinates(x: number, y: number): string {
  const visualX = 100 - y;
  const visualY = x;

  if (visualY <= 20) {
    if (visualX < 35) return 'sol bek';
    if (visualX > 60) return 'sol açık';
    return 'sol kanat';
  }

  if (visualY >= 80) {
    if (visualX < 35) return 'sağ bek';
    if (visualX > 60) return 'sağ açık';
    return 'sağ kanat';
  }

  if (visualX < 14) return 'kaleci';
  if (visualX < 28) return visualY <= 50 ? 'stoper sol' : 'stoper sağ';
  if (visualX < 38) return 'ön libero';
  if (visualX < 45) {
    return visualY <= 50
      ? 'defansif orta saha sol'
      : 'defansif orta saha sağ';
  }
  if (visualX < 58) return 'merkez orta saha';
  if (visualX < 70) return 'ofansif orta saha';
  if (visualX < 75) return 'gizli forvet';
  return 'santrafor';
}

export function findFormationSlots(formation?: string | null): FormationSlot[] {
  const normalized = String(formation || '').trim();
  return FORMATION_SLOTS[normalized] || FORMATION_SLOTS['4-2-3-1'];
}

function sanitizeManualAssignment(
  value: unknown,
  fallback: string,
): { x: number; y: number; position: string; zoneId?: string } | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const x = clampPercentage((value as { x?: unknown }).x);
  const y = clampPercentage((value as { y?: unknown }).y);
  const explicitZoneId = normalizeZoneId((value as { zoneId?: unknown }).zoneId);
  const derivedZoneId = explicitZoneId ?? resolveZoneIdFromCoordinates(x, y);
  const zonePosition = ZONE_POSITION_MAP[derivedZoneId] || fallback;

  return {
    x,
    y,
    position: canonicalizePosition(zonePosition, fallback),
    ...(derivedZoneId ? { zoneId: derivedZoneId } : {}),
  };
}

export function buildResolvedSlotAssignments(args: {
  formation?: string | null;
  players: any[];
  starters: string[];
  customFormations?: Record<string, ManualFormationMap>;
}): TeamSlotAssignmentPayload[] | undefined {
  const slots = findFormationSlots(args.formation);
  if (!Array.isArray(args.players) || args.players.length === 0 || slots.length === 0) {
    return undefined;
  }

  const playersById = new Map(
    args.players.map((player) => [String(player?.id ?? player?.uniqueId ?? ''), player] as const),
  );
  const starterIds = Array.from(new Set((args.starters || []).map(String))).filter((playerId) =>
    playersById.has(playerId),
  );
  if (starterIds.length === 0) {
    return undefined;
  }

  const manualFormation =
    args.customFormations && args.formation
      ? args.customFormations[String(args.formation).trim()] || {}
      : {};
  const resolved = starterIds
    .map((playerId, index) => {
      const player = playersById.get(playerId);
      if (!player) {
        return null;
      }

      const fallbackSlot = slots[index] ?? slots[slots.length - 1];
      const manual = sanitizeManualAssignment(
        manualFormation[playerId],
        canonicalizePosition(player?.position, canonicalizePosition(fallbackSlot?.position, 'CM')),
      );
      const x = manual?.x ?? clampPercentage(fallbackSlot?.x ?? 50);
      const y = manual?.y ?? clampPercentage(fallbackSlot?.y ?? 50);
      const zoneId = manual?.zoneId ?? resolveZoneIdFromCoordinates(x, y);

      return {
        playerId: String(player?.id ?? player?.uniqueId ?? ''),
        slotIndex: index,
        position: canonicalizePosition(
          ZONE_POSITION_MAP[zoneId] || manual?.position || fallbackSlot?.position || 'CM',
          'CM',
        ),
        x,
        y,
        ...(zoneId ? { zoneId } : {}),
      } satisfies TeamSlotAssignmentPayload;
    })
    .filter((value): value is TeamSlotAssignmentPayload => value !== null && !!value.playerId);

  return resolved.length > 0 ? resolved : undefined;
}

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

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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

function buildUnityPlayerVisualPayload(player: any, order: number, teamSeed: string): UnityRuntimePlayerVisualPayload {
  const rawPlayer = player as Record<string, unknown>;
  const nestedVisual = asObjectRecord(rawPlayer?.visual);
  const nestedAppearance = asObjectRecord(rawPlayer?.appearance);
  const sources = [nestedVisual, nestedAppearance, rawPlayer];
  const seed = `${teamSeed}:${String(player?.uniqueId || player?.id || `p_${order}`)}:${String(player?.name || '')}:${order}`;

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

function toUnityPlayerPayload(player: any, order: number, teamSeed: string): UnityRuntimePlayerPayload {
  const playerSeed = `${teamSeed}:${String(player?.uniqueId || player?.id || `p_${order}`)}:${String(player?.name || '')}:${order}`;
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
      height: toUnityHeightValue(player?.height, playerSeed),
      weight: toUnityWeightValue(player?.weight, playerSeed),
    },
    visual: buildUnityPlayerVisualPayload(player, order, teamSeed),
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

export function normalizeSlotAssignments(values: unknown): TeamSlotAssignmentPayload[] | undefined {
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
      const rawZoneId = normalizeZoneId((value as { zoneId?: unknown }).zoneId);

      return {
        playerId,
        slotIndex: Math.floor(slotIndex),
        position,
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        ...(rawZoneId ? { zoneId: rawZoneId } : {}),
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
  const allPlayers = stableSortPlayers(Array.isArray(data?.players) ? data.players : []);
  const resolvedSlotAssignments =
    slotAssignments ||
    buildResolvedSlotAssignments({
      formation,
      players: allPlayers,
      starters,
      customFormations,
    });

  if (
    !formation &&
    !shape &&
    starters.length === 0 &&
    subs.length === 0 &&
    reserves.length === 0 &&
    !tactics &&
    !resolvedSlotAssignments
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
    slotAssignments: resolvedSlotAssignments,
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
  const customFormations =
    data?.lineup?.customFormations && typeof data.lineup.customFormations === 'object'
      ? data.lineup.customFormations
      : data?.plan?.customFormations && typeof data.plan.customFormations === 'object'
        ? data.plan.customFormations
        : undefined;
  const slotAssignments =
    normalizeSlotAssignments(
      data?.lineup?.slotAssignments || data?.plan?.slotAssignments,
    ) ||
    buildResolvedSlotAssignments({
      formation,
      players: allPlayers,
      starters: lineupIds,
      customFormations,
    });

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
        player?.squadRole === 'bench',
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
    if (benchPlayers.length >= 12) break;
    const playerId = String(player?.id ?? player?.uniqueId ?? '');
    if (benchSelectedIds.has(playerId)) continue;
    benchPlayers.push(player);
    benchSelectedIds.add(playerId);
  }

  while (benchPlayers.length < 12) {
    benchPlayers.push(
      createFallbackPlayer(`bot_bench_${benchPlayers.length}`, `Sub ${benchPlayers.length + 1}`, 'bench'),
    );
  }

  const seed = `${teamId}:${teamName}`;
  const plan = resolvePlan(data);
  return {
    teamKey: teamId,
    teamName,
    formation,
    ...(shape ? { shape } : {}),
    kit: deriveKitColors(seed),
    lineup: lineupPlayers.slice(0, 11).map((player, index) => toUnityPlayerPayload(player, index, seed)),
    bench: benchPlayers.slice(0, 12).map((player, index) => toUnityPlayerPayload(player, 11 + index, seed)),
    ...(slotAssignments ? { slotAssignments } : {}),
    ...(plan ? { plan } : {}),
  };
}
