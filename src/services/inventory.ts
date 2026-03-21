import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';

import { KIT_CONFIG } from '@/lib/kits';
import type { ClubTeam, KitType, Player } from '@/types';
import { db } from '@/services/firebase';

export type KitInventory = Record<KitType, number>;

export type ConsumablesInventoryDoc = {
  kits: KitInventory;
  updatedAt?: unknown;
  migratedAt?: unknown;
  source?: string;
};

export const DEFAULT_KIT_INVENTORY: KitInventory = {
  energy: 0,
  morale: 0,
  health: 0,
};

const userRef = (uid: string) => doc(db, 'users', uid);
const inventoryRef = (uid: string) => doc(db, 'users', uid, 'inventory', 'consumables');
const teamRef = (uid: string) => doc(db, 'teams', uid);

const sanitizeCount = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
};

export const sanitizeKitInventory = (value: unknown): KitInventory => {
  const candidate = value && typeof value === 'object' ? (value as Partial<KitInventory>) : {};
  return {
    energy: sanitizeCount(candidate.energy),
    morale: sanitizeCount(candidate.morale),
    health: sanitizeCount(candidate.health),
  };
};

const clampGauge = (value: number): number => {
  if (!Number.isFinite(value)) return 0.75;
  const normalized = Number(value.toFixed(3));
  if (normalized < 0) return 0;
  if (normalized > 1) return 1;
  return normalized;
};

const readGauge = (value: number | undefined | null): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0.75;
};

const normalizePlayers = (players: Player[]): Player[] => {
  let starters = 0;
  return players.map((player) => {
    const normalized: Player = {
      ...player,
      condition: clampGauge(readGauge(player.condition)),
      motivation: clampGauge(readGauge(player.motivation)),
      injuryStatus: player.injuryStatus ?? 'healthy',
    };

    if (normalized.squadRole !== 'starting') {
      return normalized;
    }

    starters += 1;
    if (starters <= 11) {
      return normalized;
    }

    return {
      ...normalized,
      squadRole: 'bench',
    };
  });
};

const readConsumables = (raw: unknown): ConsumablesInventoryDoc => {
  const data = raw && typeof raw === 'object' ? (raw as Partial<ConsumablesInventoryDoc>) : {};
  return {
    kits: sanitizeKitInventory(data.kits),
    updatedAt: data.updatedAt,
    migratedAt: data.migratedAt,
    source: typeof data.source === 'string' ? data.source : undefined,
  };
};

export async function getUserConsumables(uid: string): Promise<ConsumablesInventoryDoc | null> {
  const snap = await getDoc(inventoryRef(uid));
  if (!snap.exists()) {
    return null;
  }
  return readConsumables(snap.data());
}

export function listenUserConsumables(
  uid: string,
  cb: (inventory: ConsumablesInventoryDoc | null) => void,
): Unsubscribe {
  return onSnapshot(inventoryRef(uid), (snap) => {
    cb(snap.exists() ? readConsumables(snap.data()) : null);
  });
}

export async function replaceUserConsumables(
  uid: string,
  kits: KitInventory,
  options?: { source?: string; migrated?: boolean },
): Promise<void> {
  const payload: Record<string, unknown> = {
    kits: sanitizeKitInventory(kits),
    updatedAt: serverTimestamp(),
  };

  if (options?.source) {
    payload.source = options.source;
  }
  if (options?.migrated) {
    payload.migratedAt = serverTimestamp();
  }

  await setDoc(inventoryRef(uid), payload, { merge: true });
}

export async function grantKits(
  uid: string,
  rewards: Partial<Record<KitType, number>>,
): Promise<KitInventory> {
  const nextInventory = await runTransaction(db, async (tx) => {
    const ref = inventoryRef(uid);
    const snap = await tx.get(ref);
    const current = snap.exists() ? readConsumables(snap.data()).kits : DEFAULT_KIT_INVENTORY;
    const next: KitInventory = { ...current };

    (Object.entries(rewards) as Array<[KitType, number | undefined]>).forEach(([type, amount]) => {
      const safeAmount = sanitizeCount(amount);
      if (safeAmount <= 0) {
        return;
      }
      next[type] = sanitizeCount((next[type] ?? 0) + safeAmount);
    });

    tx.set(
      ref,
      {
        kits: next,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return next;
  });

  return nextInventory;
}

export async function spendDiamondsAndGrantKit(
  uid: string,
  type: KitType,
  amount: number,
  diamondCost: number,
): Promise<KitInventory> {
  return runTransaction(db, async (tx) => {
    const currentUserRef = userRef(uid);
    const currentInventoryRef = inventoryRef(uid);
    const [userSnap, inventorySnap] = await Promise.all([
      tx.get(currentUserRef),
      tx.get(currentInventoryRef),
    ]);

    const balance = Number(userSnap.data()?.diamondBalance ?? 0);
    if (!Number.isFinite(balance) || balance < diamondCost) {
      throw new Error('Yeterli elmas yok');
    }

    const currentKits = inventorySnap.exists()
      ? readConsumables(inventorySnap.data()).kits
      : DEFAULT_KIT_INVENTORY;
    const nextKits: KitInventory = {
      ...currentKits,
      [type]: sanitizeCount((currentKits[type] ?? 0) + sanitizeCount(amount)),
    };

    tx.set(
      currentUserRef,
      {
        diamondBalance: Math.max(0, Math.round(balance - diamondCost)),
      },
      { merge: true },
    );
    tx.set(
      currentInventoryRef,
      {
        kits: nextKits,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return nextKits;
  });
}

export async function applyKitToPlayerInInventory(
  uid: string,
  type: KitType,
  playerId: string,
): Promise<{ playerName: string; kits: KitInventory }> {
  return runTransaction(db, async (tx) => {
    const currentInventoryRef = inventoryRef(uid);
    const currentTeamRef = teamRef(uid);
    const [inventorySnap, teamSnap] = await Promise.all([
      tx.get(currentInventoryRef),
      tx.get(currentTeamRef),
    ]);

    if (!teamSnap.exists()) {
      throw new Error('Takim bulunamadi.');
    }

    const currentKits = inventorySnap.exists()
      ? readConsumables(inventorySnap.data()).kits
      : DEFAULT_KIT_INVENTORY;
    const available = sanitizeCount(currentKits[type]);
    if (available <= 0) {
      throw new Error('Bu kitten stokta kalmadi.');
    }

    const team = teamSnap.data() as ClubTeam;
    const players = Array.isArray(team.players) ? [...team.players] : [];
    const playerIndex = players.findIndex((player) => String(player.id) === String(playerId));
    if (playerIndex === -1) {
      throw new Error('Oyuncu bulunamadi.');
    }

    const player = players[playerIndex] as Player;
    const config = KIT_CONFIG[type];
    const nextPlayer: Player = {
      ...player,
      condition: clampGauge(readGauge(player.condition) + config.conditionDelta),
      motivation: clampGauge(readGauge(player.motivation) + config.motivationDelta),
      injuryStatus: config.healsInjury ? 'healthy' : player.injuryStatus ?? 'healthy',
    };

    players[playerIndex] = nextPlayer;
    const nextKits: KitInventory = {
      ...currentKits,
      [type]: Math.max(0, available - 1),
    };

    tx.set(currentTeamRef, { players: normalizePlayers(players) }, { merge: true });
    tx.set(
      currentInventoryRef,
      {
        kits: nextKits,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return {
      playerName: nextPlayer.name,
      kits: nextKits,
    };
  });
}
