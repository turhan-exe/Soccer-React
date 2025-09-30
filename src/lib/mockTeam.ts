import { ClubTeam, Player, Position } from '@/types';
import { formations } from '@/lib/formations';
import { generateRandomName } from '@/lib/names';

const allPositions: Position[] = [
  'GK', 'CB', 'LB', 'RB', 'CM', 'LM', 'RM', 'CAM', 'LW', 'RW', 'ST',
];

function rand01() {
  return Math.round(Math.random() * 1000) / 1000;
}

function makePlayer(id: number, forced?: Position): Player {
  const position: Position = forced || allPositions[Math.floor(Math.random() * allPositions.length)];
  const attributes = {
    strength: rand01(),
    acceleration: rand01(),
    topSpeed: rand01(),
    dribbleSpeed: rand01(),
    jump: rand01(),
    tackling: rand01(),
    ballKeeping: rand01(),
    passing: rand01(),
    longBall: rand01(),
    agility: rand01(),
    shooting: rand01(),
    shootPower: rand01(),
    positioning: rand01(),
    reaction: rand01(),
    ballControl: rand01(),
  } as Player['attributes'];
  const overall = Number(
    (
      0.25 * attributes.shooting +
      0.25 * attributes.passing +
      0.15 * attributes.ballControl +
      0.1 * attributes.topSpeed +
      0.1 * attributes.acceleration +
      0.15 * attributes.positioning
    ).toFixed(3)
  );
  return {
    id: String(id),
    name: generateRandomName(),
    position,
    roles: [position],
    overall,
    potential: Math.min(1, overall + Math.random() * (1 - overall)),
    attributes,
    age: 18 + Math.floor(Math.random() * 15),
    height: 170 + Math.floor(Math.random() * 20),
    weight: 65 + Math.floor(Math.random() * 20),
    squadRole: 'reserve',
    condition: parseFloat((0.6 + Math.random() * 0.4).toFixed(3)),
    motivation: parseFloat((0.55 + Math.random() * 0.45).toFixed(3)),
  };
}

export function makeMockTeam(id: string, name: string, manager = 'AI Coach'): ClubTeam {
  const players: Player[] = [];
  const firstFormation = formations[0];
  const startingPositions: Position[] = firstFormation.positions.map((p) => p.position as Position);
  startingPositions.forEach((pos, idx) => {
    players.push(makePlayer(idx + 1, pos));
  });
  for (let i = startingPositions.length; i < 30; i++) {
    players.push(makePlayer(i + 1));
  }
  players.slice(0, 11).forEach((p) => (p.squadRole = 'starting'));
  players.slice(11, 22).forEach((p) => (p.squadRole = 'bench'));
  players.slice(22).forEach((p) => (p.squadRole = 'reserve'));

  return {
    id,
    name,
    manager,
    kitHome: 'home',
    kitAway: 'away',
    budget: 0,
    players,
  };
}

