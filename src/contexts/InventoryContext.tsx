import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import type { KitType, Player } from '@/types';
import { KIT_CONFIG } from '@/lib/kits';
import { getTeam, saveTeamPlayers } from '@/services/team';

export type KitInventory = Record<KitType, number>;
export type KitPurchaseMethod = 'ad' | 'diamonds';

interface InventoryContextValue {
  kits: KitInventory;
  purchaseKit: (type: KitType, method: KitPurchaseMethod) => Promise<void>;
  applyKitToPlayer: (type: KitType, playerId: string) => Promise<void>;
  isProcessing: boolean;
}

const DEFAULT_INVENTORY: KitInventory = {
  energy: 0,
  morale: 0,
  health: 0,
};

const DEFAULT_GAUGE = 0.75;

const clampGauge = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_GAUGE;
  const normalized = Number(value.toFixed(3));
  if (normalized < 0) return 0;
  if (normalized > 1) return 1;
  return normalized;
};

const readGauge = (value: number | undefined | null): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return DEFAULT_GAUGE;
};

const InventoryContext = createContext<InventoryContextValue | undefined>(undefined);

export const InventoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { spend } = useDiamonds();
  const [kits, setKits] = useState<KitInventory>(DEFAULT_INVENTORY);
  const [isProcessing, setIsProcessing] = useState(false);

  const storageKey = user ? `kits:${user.id}` : null;

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') {
      if (!user) {
        setKits(DEFAULT_INVENTORY);
      }
      return;
    }

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setKits(DEFAULT_INVENTORY);
        return;
      }
      const parsed = JSON.parse(raw) as Partial<KitInventory> | null;
      setKits({ ...DEFAULT_INVENTORY, ...(parsed ?? {}) });
    } catch (error) {
      console.warn('[InventoryProvider] failed to read kits', error);
      setKits(DEFAULT_INVENTORY);
    }
  }, [storageKey, user]);

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(kits));
    } catch (error) {
      console.warn('[InventoryProvider] failed to persist kits', error);
    }
  }, [kits, storageKey]);

  const purchaseKit = useCallback(async (type: KitType, method: KitPurchaseMethod) => {
    if (!user) {
      toast.error('Kit satın almak için giriş yapmalısın.');
      throw new Error('auth-required');
    }

    const config = KIT_CONFIG[type];
    setIsProcessing(true);

    try {
      const gained = method === 'diamonds' ? 1 : config.adReward;
      if (method === 'diamonds') {
        await spend(config.diamondCost);
        toast.success(`${config.label} satın alındı.`);
      } else {
        toast.success(`Reklam ödülü: +${gained} ${config.label}.`);
      }

      setKits((prev) => ({
        ...prev,
        [type]: (prev[type] ?? 0) + gained,
      }));
    } catch (error) {
      if (method === 'diamonds') {
        console.warn('[InventoryProvider] diamond purchase failed', error);
      }
      if (error instanceof Error && error.message !== 'auth-required') {
        toast.error(error.message || 'Kit satın alınamadı.');
      }
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [spend, user]);

  const applyKitToPlayer = useCallback(async (type: KitType, playerId: string) => {
    if (!user) {
      toast.error('Kit kullanmak için giriş yapmalısın.');
      throw new Error('auth-required');
    }

    const available = kits[type] ?? 0;
    if (available <= 0) {
      toast.error('Bu kitten stoğunuz kalmadı.');
      return;
    }

    setIsProcessing(true);

    try {
      const team = await getTeam(user.id);
      if (!team || !Array.isArray(team.players)) {
        throw new Error('Takım bulunamadı.');
      }

      const index = team.players.findIndex((player) => String(player.id) === String(playerId));
      if (index === -1) {
        throw new Error('Oyuncu bulunamadı.');
      }

      const player = team.players[index] as Player;
      const config = KIT_CONFIG[type];

      const nextPlayer: Player = {
        ...player,
        condition: clampGauge(readGauge(player.condition) + config.conditionDelta),
        motivation: clampGauge(readGauge(player.motivation) + config.motivationDelta),
        injuryStatus: config.healsInjury ? 'healthy' : player.injuryStatus ?? 'healthy',
      };

      const updatedPlayers = [...team.players];
      updatedPlayers[index] = nextPlayer;

      await saveTeamPlayers(user.id, updatedPlayers);

      setKits((prev) => ({
        ...prev,
        [type]: Math.max(0, (prev[type] ?? 0) - 1),
      }));

      toast.success(`${config.label} ${player.name} için uygulandı.`);
    } catch (error) {
      console.warn('[InventoryProvider] apply kit failed', error);
      if (error instanceof Error && error.message !== 'auth-required') {
        toast.error(error.message || 'Kit kullanılamadı.');
      }
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [kits, user]);

  const value = useMemo<InventoryContextValue>(() => ({
    kits,
    purchaseKit,
    applyKitToPlayer,
    isProcessing,
  }), [kits, purchaseKit, applyKitToPlayer, isProcessing]);

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
};

export const useInventory = (): InventoryContextValue => {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error('useInventory must be used within InventoryProvider');
  }
  return context;
};
