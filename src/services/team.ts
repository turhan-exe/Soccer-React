import { doc, setDoc, getDoc, runTransaction } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/services/firebase';
import { Player, ClubTeam } from '@/types';
import { generateRandomName } from '@/lib/names';
import { calculateOverall, getRoles } from '@/lib/player';
import { formations } from '@/lib/formations';

const positions: Player['position'][] = ['GK','CB','LB','RB','CM','LM','RM','CAM','LW','RW','ST'];

const randomAttr = () => parseFloat(Math.random().toFixed(3));
const randomGauge = () => parseFloat((0.6 + Math.random() * 0.4).toFixed(3));

const generatePlayer = (
  id: number,
  forcedPosition?: Player['position'],
): Player => {
  const position =
    forcedPosition || positions[Math.floor(Math.random() * positions.length)];
  const attributes = {
    strength: randomAttr(),
    acceleration: randomAttr(),
    topSpeed: randomAttr(),
    dribbleSpeed: randomAttr(),
    jump: randomAttr(),
    tackling: randomAttr(),
    ballKeeping: randomAttr(),
    passing: randomAttr(),
    longBall: randomAttr(),
    agility: randomAttr(),
    shooting: randomAttr(),
    shootPower: randomAttr(),
    positioning: randomAttr(),
    reaction: randomAttr(),
    ballControl: randomAttr(),
  } as Player['attributes'];
  const overall = calculateOverall(position, attributes);
  const potential = Math.min(1, overall + Math.random() * (1 - overall));
  return {
    id: String(id),
    name: generateRandomName(),
    position,
    roles: getRoles(position),
    overall,
    potential,
    attributes,
    age: Math.floor(Math.random() * 17) + 18,
    height: 180,
    weight: 75,
    squadRole: 'reserve',
    condition: randomGauge(),
    motivation: randomGauge(),
  };
};

const generateTeamData = (id: string, name: string, manager: string): ClubTeam => {
  const players: Player[] = [];
  const startingPositions = formations[0].positions.map(p => p.position);
  startingPositions.forEach((pos, idx) => {
    players.push(generatePlayer(idx + 1, pos));
  });
  for (let i = startingPositions.length; i < 30; i++) {
    players.push(generatePlayer(i + 1));
  }
  players.slice(0, 11).forEach(p => (p.squadRole = 'starting'));
  players.slice(11, 22).forEach(p => (p.squadRole = 'bench'));
  players.slice(22).forEach(p => (p.squadRole = 'reserve'));
  return {
    id,
    name,
    manager,
    kitHome: 'home',
    kitAway: 'away',
    budget: 0,
    players,
  };
};

export const createInitialTeam = async (
  userId: string,
  teamName: string,
  manager: string,
): Promise<ClubTeam> => {
  const team = generateTeamData(userId, teamName, manager);
  // Firestore security rules require ownerUid on create and forbid setting leagueId from client
  await setDoc(
    doc(db, 'teams', userId),
    { ...team, ownerUid: userId },
  );
  return team;
};

export const getTeam = async (userId: string): Promise<ClubTeam | null> => {
  const snap = await getDoc(doc(db, 'teams', userId));
  return snap.exists() ? (snap.data() as ClubTeam) : null;
};

export const adjustTeamBudget = async (userId: string, amount: number): Promise<number> => {
  const teamRef = doc(db, 'teams', userId);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(teamRef);
    if (!snapshot.exists()) {
      throw new Error('Takım bulunamadı.');
    }

    const data = snapshot.data() as ClubTeam | undefined;
    const currentBudget = Number.isFinite(data?.budget) ? Number(data?.budget) : 0;
    const nextBudget = Math.max(0, Math.round(currentBudget + amount));

    transaction.update(teamRef, { budget: nextBudget });
    return nextBudget;
  });
};

type TeamPlanUpdate = {
  formation?: string;
  tactics?: Record<string, unknown>;
  squads?: {
    starters?: string[];
    bench?: string[];
    reserves?: string[];
  };
};

export const saveTeamPlayers = async (userId: string, players: Player[], plan?: TeamPlanUpdate) => {
  const payload: Record<string, unknown> = { players };

  if (plan) {
    const { formation, squads, tactics } = plan;
    const dedupe = (list?: string[]) =>
      Array.from(new Set((list ?? []).map(id => String(id)))).filter(Boolean);

    const sanitizedFormation =
      typeof formation === 'string' && formation.trim().length > 0
        ? formation.trim()
        : 'auto';

    const sanitizedSquads = {
      starters: dedupe(squads?.starters),
      bench: dedupe(squads?.bench),
      reserves: dedupe(squads?.reserves),
    };

    const rosterIds = new Set(players.map(player => String(player.id)));
    const unknownIds = [
      ...sanitizedSquads.starters,
      ...sanitizedSquads.bench,
      ...sanitizedSquads.reserves,
    ].filter(id => !rosterIds.has(id));

    if (unknownIds.length > 0) {
      throw new Error('Unknown player ids: ' + unknownIds.join(', '));
    }

    const timestamp = new Date().toISOString();
    const sanitizedTactics =
      tactics && typeof tactics === 'object' ? (tactics as Record<string, unknown>) : {};

    payload.plan = {
      formation: sanitizedFormation,
      starters: sanitizedSquads.starters,
      bench: sanitizedSquads.bench,
      reserves: sanitizedSquads.reserves,
      updatedAt: timestamp,
    };

    payload.lineup = {
      formation: sanitizedFormation,
      tactics: sanitizedTactics,
      starters: sanitizedSquads.starters,
      subs: sanitizedSquads.bench,
      reserves: sanitizedSquads.reserves,
      updatedAt: timestamp,
    };
  }

  await setDoc(doc(db, 'teams', userId), payload, { merge: true });
};

export const addPlayerToTeam = async (userId: string, player: Player) => {
  const team = await getTeam(userId);
  if (!team) return;
  const updatedPlayers = [
    ...team.players,
    { ...player, squadRole: 'reserve' as const },
  ];
  await setDoc(doc(db, 'teams', userId), { players: updatedPlayers }, { merge: true });
  return updatedPlayers;
};

/**
 * Server-side lineup setter (calls Cloud Function 'setLineup')
 */
export async function setLineupServer(params: {
  teamId: string;
  formation?: string;
  tactics?: Record<string, any>;
  starters: string[];
  subs?: string[];
  reserves?: string[];
}): Promise<void> {
  const dedupe = (list?: string[]) => Array.from(new Set((list ?? []).map(String))).filter(Boolean);
  const starters = dedupe(params.starters);
  const subs = dedupe(params.subs);
  const reserves = dedupe(params.reserves);

  const fn = httpsCallable(functions, 'setLineup');
  await fn({
    teamId: params.teamId,
    formation: params.formation || 'auto',
    tactics: params.tactics || {},
    starters,
    subs,
    reserves,
  });
}
