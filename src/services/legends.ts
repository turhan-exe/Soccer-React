import { collection, deleteDoc, doc, getDocs, setDoc, Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import { addPlayerToTeam, getTeam, saveTeamPlayers } from './team';
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
    injuryStatus: 'healthy',
    avatar: legend.image,
    uniqueId: `legend-${legend.id}`,
    market: { active: false, listingId: null, locked: true, lockReason: 'legend-pack' },
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
  const contractExpiresAt = expiresAt.toISOString();
  const rentalPlayer: Player = {
    ...player,
    contract: {
      expiresAt: contractExpiresAt,
      status: 'active',
      salary: 0,
      extensions: 0,
    },
    market: {
      ...(player.market ?? { active: false, listingId: null }),
      active: false,
      listingId: null,
      locked: true,
      lockReason: 'legend-pack',
    },
  };
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

  await addPlayerToTeam(uid, rentalPlayer);
  await setDoc(
    doc(db, 'users', uid, 'rentedLegends', playerId),
    { legendId: legend.id, playerId, expiresAt: Timestamp.fromDate(expiresAt) },
  );
  return rentalPlayer;
}

export type RentedLegendRecord = {
  legendId: number;
  playerId: string;
  expiresAt: Date;
};

export async function getRentedLegends(uid: string): Promise<RentedLegendRecord[]> {
  const snapshot = await getDocs(collection(db, 'users', uid, 'rentedLegends'));
  const rented: RentedLegendRecord[] = [];
  const expiredIds: string[] = [];
  let teamPlayers: Player[] | undefined;
  const now = Date.now();

  snapshot.forEach(docSnap => {
    const data = docSnap.data() as { legendId?: unknown; expiresAt?: unknown };
    if (typeof data.legendId !== 'number') {
      return;
    }

    let expiresAt: Date | null = null;
    const rawExpiresAt = data.expiresAt;

    if (rawExpiresAt instanceof Timestamp) {
      expiresAt = rawExpiresAt.toDate();
    } else if (typeof rawExpiresAt === 'string' || typeof rawExpiresAt === 'number') {
      const parsed = new Date(rawExpiresAt);
      if (!Number.isNaN(parsed.getTime())) {
        expiresAt = parsed;
      }
    }

    if (!expiresAt) {
      return;
    }

    const playerId = docSnap.id;
    if (expiresAt.getTime() <= now) {
      expiredIds.push(playerId);
      return;
    }

    rented.push({ legendId: data.legendId, playerId, expiresAt });
  });

  if (expiredIds.length > 0) {
    const team = await getTeam(uid);
    teamPlayers = team?.players ?? [];
    for (const playerId of expiredIds) {
      teamPlayers = await completeLegendRental(uid, playerId, { players: teamPlayers });
    }
  }

  return rented.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
}

export async function completeLegendRental(
  uid: string,
  playerId: string,
  options?: { players?: Player[] },
): Promise<Player[]> {
  let sourcePlayers = options?.players;
  if (!sourcePlayers) {
    const team = await getTeam(uid);
    sourcePlayers = team?.players ?? [];
  }

  const filteredPlayers = sourcePlayers.filter(player => player.id !== playerId);

  if (filteredPlayers.length !== sourcePlayers.length) {
    await saveTeamPlayers(uid, filteredPlayers);
  }

  try {
    await deleteDoc(doc(db, 'users', uid, 'rentedLegends', playerId));
  } catch (error) {
    console.warn('[legends.completeLegendRental] failed to delete rental record', error);
  }

  return filteredPlayers;
}

