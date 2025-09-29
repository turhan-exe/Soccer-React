import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import { addPlayerToTeam, getTeam } from './team';
import type { LegendPlayer } from '@/features/legends/players';
import type { Player } from '@/types';
import { getRoles } from '@/lib/player';

function legendToPlayer(id: string, legend: LegendPlayer): Player {
  const rating = legend.rating / 100;
  const attributes: Player['attributes'] = {
    strength: rating,
    acceleration: rating,
    topSpeed: rating,
    dribbleSpeed: rating,
    jump: rating,
    tackling: rating,
    ballKeeping: rating,
    passing: rating,
    longBall: rating,
    agility: rating,
    shooting: rating,
    shootPower: rating,
    positioning: rating,
    reaction: rating,
    ballControl: rating,
  };
  return {
    id,
    name: legend.name,
    position: legend.position,
    roles: getRoles(legend.position),
    overall: rating,
    potential: rating,
    attributes,
    age: 35,
    height: 180,
    weight: 75,
    squadRole: 'reserve',
    condition: 0.96,
    motivation: 0.98,
    avatar: legend.image,
    uniqueId: `legend-${legend.id}`,
  };
}

export function getLegendIdFromPlayer(player: Player): number | null {
  const uniqueMatch = player.uniqueId?.match(/^legend-(\d+)$/);
  if (uniqueMatch) {
    return Number(uniqueMatch[1]);
  }

  const idMatch = String(player.id).match(/^legend-(\d+)-/);
  if (idMatch) {
    return Number(idMatch[1]);
  }

  return null;
}

export async function rentLegend(
  uid: string,
  legend: LegendPlayer,
  expiresAt: Date,
): Promise<Player> {
  const playerId = `legend-${legend.id}-${Date.now()}`;
  const player = legendToPlayer(playerId, legend);
  const team = await getTeam(uid);
  if (!team) {
    throw new Error('Takım bulunamadı');
  }

  const hasLegend = Array.isArray(team.players)
    ? team.players.some(existing => getLegendIdFromPlayer(existing) === legend.id)
    : false;

  if (hasLegend) {
    throw new Error('Bu yıldız oyuncu zaten takımında');
  }

  await addPlayerToTeam(uid, player);
  await setDoc(
    doc(db, 'users', uid, 'rentedLegends', playerId),
    { legendId: legend.id, expiresAt: Timestamp.fromDate(expiresAt) },
  );
  return player;
}

