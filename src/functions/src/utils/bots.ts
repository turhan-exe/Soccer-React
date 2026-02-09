import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = getFirestore();
const BOT_TEAM_PREFIX = 'botteam-';
const DEFAULT_FORMATION = 'auto';
const STARTER_POSITIONS = ['GK', 'CB', 'CB', 'LB', 'RB', 'CM', 'CM', 'LM', 'RM', 'ST', 'ST'];
const EXTRA_POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CM', 'LM', 'RM', 'CAM', 'LW', 'RW', 'ST'];

type BotTeamInput = {
  botId: string;
  name?: string;
  rating?: number;
  slotIndex?: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hashSeed(value: string) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildAttributes(base: number, rand: () => number) {
  const next = () => clamp(base + (rand() - 0.5) * 0.2, 0.2, 0.99);
  return {
    strength: next(),
    acceleration: next(),
    topSpeed: next(),
    dribbleSpeed: next(),
    jump: next(),
    tackling: next(),
    ballKeeping: next(),
    passing: next(),
    longBall: next(),
    agility: next(),
    shooting: next(),
    shootPower: next(),
    positioning: next(),
    reaction: next(),
    ballControl: next(),
  };
}

function buildRoster(botId: string, rating?: number) {
  const seed = hashSeed(botId);
  const rand = mulberry32(seed);
  const base = clamp((Number.isFinite(rating) ? Number(rating) : 60) / 100, 0.45, 0.9);
  const players: any[] = [];

  const makePlayer = (id: number, position: string, role: string) => {
    const attributes = buildAttributes(base, rand);
    const avg = Object.values(attributes).reduce((sum, v) => sum + (v as number), 0) / 15;
    const overall = Number(avg.toFixed(3));
    const potential = clamp(overall + 0.05 + rand() * 0.1, 0.35, 1);
    return {
      id: String(id),
      name: `Bot ${botId.slice(0, 4)} #${id}`,
      position,
      roles: [position],
      overall,
      potential,
      attributes,
      age: Math.floor(rand() * 15) + 18,
      ageUpdatedAt: new Date().toISOString(),
      height: Math.round(170 + rand() * 25),
      weight: Math.round(65 + rand() * 20),
      condition: Number((0.7 + rand() * 0.3).toFixed(3)),
      motivation: Number((0.7 + rand() * 0.3).toFixed(3)),
      injuryStatus: 'healthy',
      squadRole: role,
    };
  };

  STARTER_POSITIONS.forEach((pos, idx) => {
    players.push(makePlayer(idx + 1, pos, 'starting'));
  });

  for (let i = 0; i < 7; i++) {
    const pos = EXTRA_POSITIONS[Math.floor(rand() * EXTRA_POSITIONS.length)];
    players.push(makePlayer(players.length + 1, pos, 'bench'));
  }

  for (let i = 0; i < 4; i++) {
    const pos = EXTRA_POSITIONS[Math.floor(rand() * EXTRA_POSITIONS.length)];
    players.push(makePlayer(players.length + 1, pos, 'reserve'));
  }

  const starters = players.filter((p) => p.squadRole === 'starting').map((p) => p.id);
  const subs = players.filter((p) => p.squadRole === 'bench').map((p) => p.id);
  const reserves = players.filter((p) => p.squadRole === 'reserve').map((p) => p.id);

  const lineup = {
    formation: DEFAULT_FORMATION,
    tactics: {},
    starters,
    subs,
    reserves,
    updatedAt: new Date().toISOString(),
  };

  return { players, lineup };
}

export function botTeamId(botId: string) {
  const clean = String(botId || '').trim();
  if (!clean) return '';
  return clean.startsWith(BOT_TEAM_PREFIX) ? clean : `${BOT_TEAM_PREFIX}${clean}`;
}

export async function ensureBotTeamDoc(input: BotTeamInput) {
  const teamId = botTeamId(input.botId);
  if (!teamId) return '';
  const teamRef = db.collection('teams').doc(teamId);
  const snap = await teamRef.get();
  if (snap.exists) return teamId;

  const botName =
    (input.name && input.name.trim()) ||
    (input.slotIndex ? `Bot ${input.slotIndex}` : `Bot ${input.botId.slice(0, 6)}`);
  const { players, lineup } = buildRoster(input.botId, input.rating);
  const now = FieldValue.serverTimestamp();

  await teamRef.set({
    id: teamId,
    name: botName,
    clubName: botName,
    manager: 'AI',
    kitHome: 'home',
    kitAway: 'away',
    logo: null,
    transferBudget: 0,
    budget: 0,
    isBot: true,
    botId: input.botId,
    players,
    lineup,
    plan: lineup,
    createdAt: now,
    updatedAt: now,
  });

  return teamId;
}
