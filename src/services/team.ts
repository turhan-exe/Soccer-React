import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '@/services/firebase';
import { Player, ClubTeam } from '@/types';
import { generateRandomName } from '@/lib/names';

const positions: Player['position'][] = ['GK','CB','LB','RB','CM','LM','RM','CAM','LW','RW','ST'];

const randomAttr = () => parseFloat(Math.random().toFixed(3));

const generatePlayer = (id: number): Player => ({
  id: String(id),
  name: generateRandomName(),
  position: positions[Math.floor(Math.random() * positions.length)],
  overall: randomAttr(),
  attributes: {
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
  },
  age: Math.floor(Math.random() * 17) + 18,
  height: 180,
  weight: 75,
  squadRole: 'reserve',
});

const generateTeamData = (id: string, name: string, manager: string): ClubTeam => {
  const players: Player[] = Array.from({ length: 30 }, (_, i) => generatePlayer(i + 1));
  players.slice(0, 11).forEach(p => (p.squadRole = 'starting'));
  players.slice(11, 22).forEach(p => (p.squadRole = 'bench'));
  players.slice(22).forEach(p => (p.squadRole = 'reserve'));
  return {
    id,
    name,
    manager,
    kitHome: 'home',
    kitAway: 'away',
    players,
  };
};

export const createInitialTeam = async (
  userId: string,
  teamName: string,
  manager: string,
): Promise<ClubTeam> => {
  const team = generateTeamData(userId, teamName, manager);
  await setDoc(doc(db, 'teams', userId), team);
  return team;
};

export const getTeam = async (userId: string): Promise<ClubTeam | null> => {
  const snap = await getDoc(doc(db, 'teams', userId));
  return snap.exists() ? (snap.data() as ClubTeam) : null;
};

export const saveTeamPlayers = async (userId: string, players: Player[]) => {
  await setDoc(doc(db, 'teams', userId), { players }, { merge: true });
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
