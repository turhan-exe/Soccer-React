import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

const INITIAL_CLUB_BALANCE = 75_000;
const CONTRACT_MIN_YEARS = 2;
const CONTRACT_MAX_YEARS = 4;
const DEFAULT_FORMATION = '4-4-2';

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CM', 'LM', 'RM', 'CAM', 'LW', 'RW', 'ST'] as const;
type Position = (typeof POSITIONS)[number];

type SquadRole = 'starting' | 'bench' | 'reserve';

type PlayerAttributes = {
  strength: number;
  acceleration: number;
  topSpeed: number;
  dribbleSpeed: number;
  jump: number;
  tackling: number;
  ballKeeping: number;
  passing: number;
  longBall: number;
  agility: number;
  shooting: number;
  shootPower: number;
  positioning: number;
  reaction: number;
  ballControl: number;
};

type GeneratedPlayer = {
  id: string;
  name: string;
  position: Position;
  roles: Position[];
  overall: number;
  potential: number;
  attributes: PlayerAttributes;
  age: number;
  ageUpdatedAt: string;
  height: number;
  weight: number;
  health: number;
  squadRole: SquadRole;
  condition: number;
  motivation: number;
  injuryStatus: 'healthy';
  contract: {
    expiresAt: string;
    status: 'active';
    salary: number;
    extensions: number;
  };
  rename: {
    adAvailableAt: string;
  };
};

type ExistingTeamData = Record<string, unknown>;

type HumanTeamBootstrapInput = {
  uid: string;
  teamName?: string | null;
  managerName?: string | null;
};

type HumanTeamBootstrapResult = {
  teamName: string;
  created: boolean;
  repairedRoster: boolean;
  wrote: boolean;
};

const STARTING_POSITIONS: Position[] = ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST'];

const POSITION_ATTRIBUTES: Record<Position, (keyof PlayerAttributes)[]> = {
  GK: ['positioning', 'reaction', 'longBall', 'strength', 'jump'],
  CB: ['strength', 'tackling', 'jump', 'positioning', 'reaction'],
  LB: ['acceleration', 'topSpeed', 'tackling', 'passing', 'agility'],
  RB: ['acceleration', 'topSpeed', 'tackling', 'passing', 'agility'],
  CM: ['passing', 'ballControl', 'ballKeeping', 'agility', 'reaction'],
  LM: ['acceleration', 'topSpeed', 'dribbleSpeed', 'passing', 'ballControl'],
  RM: ['acceleration', 'topSpeed', 'dribbleSpeed', 'passing', 'ballControl'],
  CAM: ['passing', 'ballControl', 'shooting', 'agility', 'reaction'],
  LW: ['topSpeed', 'dribbleSpeed', 'shooting', 'ballControl', 'passing'],
  RW: ['topSpeed', 'dribbleSpeed', 'shooting', 'ballControl', 'passing'],
  ST: ['shooting', 'shootPower', 'positioning', 'strength', 'topSpeed'],
};

const POSITION_ROLES: Record<Position, Position[]> = {
  GK: ['GK'],
  CB: ['CB'],
  LB: ['LB', 'LM'],
  RB: ['RB', 'RM'],
  CM: ['CM', 'CAM'],
  LM: ['LM', 'LW'],
  RM: ['RM', 'RW'],
  CAM: ['CAM', 'CM'],
  LW: ['LW', 'LM', 'ST'],
  RW: ['RW', 'RM', 'ST'],
  ST: ['ST', 'CAM'],
};

const FIRST_PREFIXES = [
  'Al', 'Ar', 'Ay', 'Ba', 'Be', 'Bu', 'Ca', 'Ce', 'Da', 'De',
  'El', 'Em', 'Fa', 'Fe', 'Ga', 'Ge', 'Ha', 'He', 'Il', 'Is',
  'Ka', 'Ke', 'Le', 'Ma', 'Me',
] as const;

const LAST_PREFIXES = [
  'Ak', 'Bal', 'Can', 'Dem', 'Er', 'Fer', 'Gul', 'Hak', 'Ilg', 'Kar',
  'Lem', 'Mor', 'Naz', 'Oz', 'Pol', 'Quz', 'Ras', 'Sar', 'Tas', 'Uzg',
  'Var', 'Yen', 'Zor', 'Bar', 'Cel',
] as const;

const SUFFIXES = [
  'a', 'e', 'i', 'o', 'u', 'an', 'en', 'in', 'on', 'un',
  'ar', 'er', 'ir', 'or', 'ur', 'am', 'em', 'im', 'om', 'um',
] as const;

const FIRST_NAMES = FIRST_PREFIXES.flatMap((prefix) => SUFFIXES.map((suffix) => `${prefix}${suffix}`));
const LAST_NAMES = LAST_PREFIXES.flatMap((prefix) => SUFFIXES.map((suffix) => `${prefix}${suffix}`));

const normalizeString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const hasNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

const hasRoster = (value: unknown): value is unknown[] => (
  Array.isArray(value) && value.length > 0
);

const hashString = (input: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createSeededRandom = (seedInput: string) => {
  let state = hashString(seedInput) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = <T>(list: readonly T[], random: () => number): T => (
  list[Math.floor(random() * list.length)] ?? list[0]
);

const randomAttr = (random: () => number): number => Number(random().toFixed(3));
const randomGauge = (random: () => number): number => Number((0.6 + random() * 0.4).toFixed(3));

const normalizeRatingTo100 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 2.0) return Math.max(0, Math.min(99, Math.round(value * 100)));
  if (value <= 10.0) return Math.max(0, Math.min(99, Math.round(value * 10)));
  return Math.max(0, Math.min(99, Math.round(value)));
};

const roundSalary = (value: number): number => {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return Math.max(250, Math.round(normalized / 250) * 250);
};

const interpolate = (
  rating: number,
  minRating: number,
  maxRating: number,
  minSalary: number,
  maxSalary: number,
): number => {
  if (maxRating <= minRating) return minSalary;
  const progress = Math.max(0, Math.min(1, (rating - minRating) / (maxRating - minRating)));
  return minSalary + (maxSalary - minSalary) * progress;
};

const getSalaryForOverall = (overall: number): number => {
  const rating = normalizeRatingTo100(overall);

  if (rating <= 45) return roundSalary(interpolate(rating, 0, 45, 1800, 4000));
  if (rating <= 55) return roundSalary(interpolate(rating, 45, 55, 4000, 6500));
  if (rating <= 65) return roundSalary(interpolate(rating, 55, 65, 6500, 9500));
  if (rating <= 75) return roundSalary(interpolate(rating, 65, 75, 9500, 14500));
  if (rating <= 85) return roundSalary(interpolate(rating, 75, 85, 14500, 22000));
  if (rating <= 95) return roundSalary(interpolate(rating, 85, 95, 22000, 34000));

  return roundSalary(interpolate(rating, 95, 99, 34000, 42000));
};

const calculateOverall = (position: Position, attributes: PlayerAttributes): number => {
  const keys = POSITION_ATTRIBUTES[position];
  const total = keys.reduce((sum, key) => sum + attributes[key], 0);
  return Number((total / keys.length).toFixed(3));
};

const addGameYears = (date: Date, years: number): Date => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + years);
  return result;
};

const createInitialContract = (overall: number, random: () => number, now: Date) => {
  const years = Math.floor(random() * (CONTRACT_MAX_YEARS - CONTRACT_MIN_YEARS + 1)) + CONTRACT_MIN_YEARS;
  return {
    expiresAt: addGameYears(now, years).toISOString(),
    status: 'active' as const,
    salary: getSalaryForOverall(overall),
    extensions: 0,
  };
};

const generateRandomName = (random: () => number): string => (
  `${pick(FIRST_NAMES, random)} ${pick(LAST_NAMES, random)}`
);

const generatePlayer = (
  id: number,
  random: () => number,
  now: Date,
  forcedPosition?: Position,
): GeneratedPlayer => {
  const position = forcedPosition ?? pick(POSITIONS, random);
  const attributes: PlayerAttributes = {
    strength: randomAttr(random),
    acceleration: randomAttr(random),
    topSpeed: randomAttr(random),
    dribbleSpeed: randomAttr(random),
    jump: randomAttr(random),
    tackling: randomAttr(random),
    ballKeeping: randomAttr(random),
    passing: randomAttr(random),
    longBall: randomAttr(random),
    agility: randomAttr(random),
    shooting: randomAttr(random),
    shootPower: randomAttr(random),
    positioning: randomAttr(random),
    reaction: randomAttr(random),
    ballControl: randomAttr(random),
  };
  const overall = calculateOverall(position, attributes);
  const potential = Math.min(1, Number((overall + random() * (1 - overall)).toFixed(3)));

  return {
    id: String(id),
    name: generateRandomName(random),
    position,
    roles: POSITION_ROLES[position] ?? [position],
    overall,
    potential,
    attributes,
    age: Math.floor(random() * 17) + 18,
    ageUpdatedAt: now.toISOString(),
    height: 180,
    weight: 75,
    health: 1,
    squadRole: 'reserve',
    condition: randomGauge(random),
    motivation: randomGauge(random),
    injuryStatus: 'healthy',
    contract: createInitialContract(overall, random, now),
    rename: {
      adAvailableAt: new Date(0).toISOString(),
    },
  };
};

const buildGeneratedRoster = (uid: string) => {
  const now = new Date();
  const random = createSeededRandom(uid);
  const players: GeneratedPlayer[] = [];

  STARTING_POSITIONS.forEach((position, index) => {
    players.push(generatePlayer(index + 1, random, now, position));
  });

  for (let index = STARTING_POSITIONS.length; index < 30; index += 1) {
    players.push(generatePlayer(index + 1, random, now));
  }

  players.slice(0, 11).forEach((player) => {
    player.squadRole = 'starting';
  });
  players.slice(11, 22).forEach((player) => {
    player.squadRole = 'bench';
  });
  players.slice(22).forEach((player) => {
    player.squadRole = 'reserve';
  });

  const starters = players.filter((player) => player.squadRole === 'starting').map((player) => player.id);
  const bench = players.filter((player) => player.squadRole === 'bench').map((player) => player.id);
  const reserves = players.filter((player) => player.squadRole === 'reserve').map((player) => player.id);

  return {
    players,
    plan: {
      formation: DEFAULT_FORMATION,
      starters,
      bench,
      reserves,
      shape: DEFAULT_FORMATION,
      updatedAt: now.toISOString(),
    },
    lineup: {
      formation: DEFAULT_FORMATION,
      tactics: {},
      starters,
      subs: bench,
      reserves,
      shape: DEFAULT_FORMATION,
      updatedAt: now.toISOString(),
    },
  };
};

const teamNeedsRosterBootstrap = (teamData: ExistingTeamData | null): boolean => (
  !hasRoster(teamData?.players)
);

export const hasPlayableRoster = (teamData: ExistingTeamData | null | undefined): boolean => (
  hasRoster(teamData?.players)
);

export async function ensureHumanTeamDoc(
  input: HumanTeamBootstrapInput,
): Promise<HumanTeamBootstrapResult> {
  const uid = normalizeString(input.uid);
  if (!uid) {
    throw new Error('uid required');
  }

  const teamRef = db.collection('teams').doc(uid);
  const teamSnap = await teamRef.get();
  const teamData = teamSnap.exists ? (teamSnap.data() as ExistingTeamData) : null;

  const resolvedTeamName =
    normalizeString(teamData?.name) ||
    normalizeString(input.teamName) ||
    `Team ${uid.slice(0, 6)}`;
  const resolvedManagerName =
    normalizeString(teamData?.manager) ||
    normalizeString(input.managerName) ||
    resolvedTeamName;
  const repairedRoster = teamNeedsRosterBootstrap(teamData);

  const patch: Record<string, unknown> = {};

  if (normalizeString(teamData?.id) !== uid) {
    patch.id = uid;
  }
  if (normalizeString(teamData?.ownerUid) !== uid) {
    patch.ownerUid = uid;
  }
  if (!normalizeString(teamData?.name)) {
    patch.name = resolvedTeamName;
  }
  if (!normalizeString(teamData?.manager)) {
    patch.manager = resolvedManagerName;
  }
  if (!normalizeString(teamData?.kitHome)) {
    patch.kitHome = 'home';
  }
  if (!normalizeString(teamData?.kitAway)) {
    patch.kitAway = 'away';
  }
  if (teamData?.logo === undefined) {
    patch.logo = null;
  }
  if (!hasNumber(teamData?.budget)) {
    patch.budget = INITIAL_CLUB_BALANCE;
  }
  if (!hasNumber(teamData?.transferBudget)) {
    patch.transferBudget = hasNumber(teamData?.budget)
      ? teamData.budget
      : INITIAL_CLUB_BALANCE;
  }
  if (!teamSnap.exists || teamData?.createdAt == null) {
    patch.createdAt = FieldValue.serverTimestamp();
  }

  if (repairedRoster) {
    const generated = buildGeneratedRoster(uid);
    patch.players = generated.players;
    patch.plan = generated.plan;
    patch.lineup = generated.lineup;
  }

  const wrote = Object.keys(patch).length > 0;
  if (wrote) {
    patch.updatedAt = FieldValue.serverTimestamp();
    await teamRef.set(patch, { merge: true });
  }

  return {
    teamName: resolvedTeamName,
    created: !teamSnap.exists,
    repairedRoster,
    wrote,
  };
}
