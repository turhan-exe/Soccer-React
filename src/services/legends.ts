import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import { addPlayerToTeam } from './team';
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
  };
}

export async function rentLegend(
  uid: string,
  legend: LegendPlayer,
  expiresAt: Date,
): Promise<Player> {
  const playerId = `legend-${legend.id}-${Date.now()}`;
  const player = legendToPlayer(playerId, legend);
  await addPlayerToTeam(uid, player);
  await setDoc(
    doc(db, 'users', uid, 'rentedLegends', playerId),
    { legendId: legend.id, expiresAt: Timestamp.fromDate(expiresAt) },
  );
  return player;
}

