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
import {
  clampVitalGauge,
  HEALTH_KIT_MINIMUM_AFTER_HEAL,
  normalizeTeamPlayers,
  resolvePlayerHealth,
} from '@/lib/playerVitals';
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

const readGauge = (value: number | undefined | null): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0.75;
};

const sanitizeFirestoreData = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeFirestoreData(item)) as unknown as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, itemValue]) => itemValue !== undefined)
      .map(([key, itemValue]) => [key, sanitizeFirestoreData(itemValue)] as const);

    return Object.fromEntries(entries) as T;
  }

  return value;
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

export async function grantDailyRewardKits(
  uid: string,
  rewards: Partial<Record<KitType, number>>,
  dateKey: string,
): Promise<{ claimed: boolean; kits: KitInventory; lastDailyRewardDate: string }> {
  return runTransaction(db, async (tx) => {
    const currentUserRef = userRef(uid);
    const currentInventoryRef = inventoryRef(uid);
    const [userSnap, inventorySnap] = await Promise.all([
      tx.get(currentUserRef),
      tx.get(currentInventoryRef),
    ]);

    const lastDailyRewardDate =
      typeof userSnap.data()?.lastDailyRewardDate === 'string'
        ? userSnap.data()?.lastDailyRewardDate
        : null;

    const currentKits = inventorySnap.exists()
      ? readConsumables(inventorySnap.data()).kits
      : DEFAULT_KIT_INVENTORY;

    if (lastDailyRewardDate === dateKey) {
      return {
        claimed: false,
        kits: currentKits,
        lastDailyRewardDate: dateKey,
      };
    }

    const nextKits: KitInventory = { ...currentKits };
    (Object.entries(rewards) as Array<[KitType, number | undefined]>).forEach(([type, amount]) => {
      const safeAmount = sanitizeCount(amount);
      if (safeAmount <= 0) {
        return;
      }
      nextKits[type] = sanitizeCount((nextKits[type] ?? 0) + safeAmount);
    });

    tx.set(
      currentInventoryRef,
      {
        kits: nextKits,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      currentUserRef,
      {
        lastDailyRewardDate: dateKey,
        dailyRewardUpdatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return {
      claimed: true,
      kits: nextKits,
      lastDailyRewardDate: dateKey,
    };
  });
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
    const currentHealth = resolvePlayerHealth(player.health, player.injuryStatus);
    const nextHealth =
      config.healsInjury
        ? Math.max(
            HEALTH_KIT_MINIMUM_AFTER_HEAL,
            clampVitalGauge(currentHealth + config.healthDelta, 1),
          )
        : clampVitalGauge(currentHealth + config.healthDelta, 1);
    const nextPlayer: Player = {
      ...player,
      health: nextHealth,
      condition: clampVitalGauge(readGauge(player.condition) + config.conditionDelta),
      motivation: clampVitalGauge(readGauge(player.motivation) + config.motivationDelta),
      injuryStatus: config.healsInjury ? 'healthy' : player.injuryStatus ?? 'healthy',
    };

    players[playerIndex] = nextPlayer;
    const nextKits: KitInventory = {
      ...currentKits,
      [type]: Math.max(0, available - 1),
    };

    tx.set(
      currentTeamRef,
      { players: sanitizeFirestoreData(normalizeTeamPlayers(players)) },
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

    return {
      playerName: nextPlayer.name,
      kits: nextKits,
    };
  });
}
