import { collection, deleteDoc, doc, getDocs, runTransaction, Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import { getTeam, saveTeamPlayers } from './team';
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
    ageUpdatedAt: new Date().toISOString(),
    height: 180,
    weight: 75,
    squadRole: 'reserve',
    health: 1,
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

const parseLegendExpiration = (value: unknown): Date | null => {
  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
};

export type RentLegendResult = {
  player: Player;
  expiresAt: Date;
  status: 'created' | 'repaired' | 'existing';
};

export async function rentLegend(
  uid: string,
  legend: LegendPlayer,
  expiresAt: Date,
): Promise<RentLegendResult> {
  const playerId = `legend-${legend.id}-${Date.now()}`;
  const player = legendToPlayer(playerId, legend);
  const rentalPlayer: Player = {
    ...player,
    contract: {
      expiresAt: expiresAt.toISOString(),
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
  const teamRef = doc(db, 'teams', uid);

  return runTransaction(db, async (tx) => {
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists()) {
      throw new Error('Takim bulunamadi');
    }

    const teamData = teamSnap.data() as { players?: Player[] } | undefined;
    const currentPlayers = Array.isArray(teamData?.players) ? teamData.players : [];
    const existingLegendPlayer =
      currentPlayers.find(existing => getLegendIdFromPlayer(existing) === legend.id) ?? null;

    if (existingLegendPlayer) {
      const rentalRef = doc(db, 'users', uid, 'rentedLegends', existingLegendPlayer.id);
      const rentalSnap = await tx.get(rentalRef);
      const existingExpiresAt =
        parseLegendExpiration((rentalSnap.data() as { expiresAt?: unknown } | undefined)?.expiresAt) ??
        parseLegendExpiration(existingLegendPlayer.contract?.expiresAt) ??
        expiresAt;

      if (!rentalSnap.exists()) {
        tx.set(rentalRef, {
          legendId: legend.id,
          playerId: existingLegendPlayer.id,
          expiresAt: Timestamp.fromDate(existingExpiresAt),
        });
        return {
          player: existingLegendPlayer,
          expiresAt: existingExpiresAt,
          status: 'repaired' as const,
        };
      }

      return {
        player: existingLegendPlayer,
        expiresAt: existingExpiresAt,
        status: 'existing' as const,
      };
    }

    tx.set(teamRef, { players: [...currentPlayers, rentalPlayer] }, { merge: true });
    tx.set(doc(db, 'users', uid, 'rentedLegends', playerId), {
      legendId: legend.id,
      playerId,
      expiresAt: Timestamp.fromDate(expiresAt),
    });

    return {
      player: rentalPlayer,
      expiresAt,
      status: 'created' as const,
    };
  });
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

    const expiresAt = parseLegendExpiration(data.expiresAt);
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
