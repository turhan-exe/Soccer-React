import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BatteryCharging, Smile, HeartPulse, Gift } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import type { KitType, Player } from '@/types';
import { KIT_CONFIG } from '@/lib/kits';
import { getTeam, saveTeamPlayers } from '@/services/team';

export type KitInventory = Record<KitType, number>;
export type KitPurchaseMethod = 'ad' | 'diamonds';

export type VipPlan = 'weekly' | 'monthly' | 'yearly';

export interface VipPlanConfig {
  label: string;
  description: string;
  durationDays: number;
  diamondCost: number;
  perks: string[];
}

export const VIP_PLAN_CONFIG: Record<VipPlan, VipPlanConfig> = {
  weekly: {
    label: 'Haftalik VIP',
    description: 'Kisa sureli avantajlar icin ideal.',
    durationDays: 7,
    diamondCost: 900,
    perks: [
      'Gunluk +1 enerji, moral ve saglik kiti',
      '%5 sure kisalmasi',
      'Aylik 1 yildiz oyuncu karti',
    ],
  },
  monthly: {
    label: 'Aylik VIP',
    description: 'Daha uzun sureli premium destek.',
    durationDays: 30,
    diamondCost: 2800,
    perks: [
      'Gunluk +1 enerji, moral ve saglik kiti',
      '%5 sure kisalmasi',
      'Her ay 1 yildiz oyuncu karti',
    ],
  },
  yearly: {
    label: 'Yillik VIP',
    description: 'En iyi fiyat/performans paketi.',
    durationDays: 365,
    diamondCost: 28000,
    perks: [
      'Gunluk +1 enerji, moral ve saglik kiti',
      '%5 sure kisalmasi',
      'Her ay 1 yildiz oyuncu karti',
      'Ozel sezon ici kampanyalar',
    ],
  },
};

interface VipState {
  isActive: boolean;
  activatedAt: string | null;
  expiresAt: string | null;
  durationReductionPercent: number;
  lastMonthlyStarCardDate: string | null;
  starCardCredits: number;
  plan: VipPlan | null;
  nostalgiaFreeAvailable: boolean;
  nostalgiaFreeClaimedAt: string | null;
}

interface InventoryStorage {
  kits: KitInventory;
  lastDailyRewardDate: string | null;
  vip: VipState;
}

export interface InventoryContextValue {
  kits: KitInventory;
  purchaseKit: (type: KitType, method: KitPurchaseMethod) => Promise<void>;
  applyKitToPlayer: (type: KitType, playerId: string) => Promise<void>;
  isProcessing: boolean;
  lastDailyRewardDate: string | null;
  processDailyReward: () => void;
  vipStatus: VipState;
  vipActive: boolean;
  vipPlans: Record<VipPlan, VipPlanConfig>;
  vipDurationMultiplier: number;
  vipNostalgiaFreeAvailable: boolean;
  activateVip: (plan?: VipPlan) => Promise<void>;
  deactivateVip: () => void;
  claimMonthlyStarCard: () => void;
  canClaimMonthlyStarCard: boolean;
  consumeVipNostalgiaReward: () => void;
  isHydrated: boolean;
}

const KIT_TYPES: KitType[] = ['energy', 'morale', 'health'];
const KIT_REWARD_META: Record<KitType, { label: string; icon: LucideIcon; accent: string }> = {
  energy: { label: 'Enerji Kiti', icon: BatteryCharging, accent: 'text-emerald-300' },
  morale: { label: 'Moral Kiti', icon: Smile, accent: 'text-amber-300' },
  health: { label: 'Saglik Kiti', icon: HeartPulse, accent: 'text-rose-300' },
};

type RewardToastConfig = {
  title: string;
  subtitle: string;
  kits: Array<{ type: KitType; amount: number }>;
};

const showKitRewardToast = (config: RewardToastConfig) => {
  if (typeof window === 'undefined') {
    return;
  }

  toast.custom(() => (
    <div className="w-80 rounded-2xl border border-emerald-300/40 bg-slate-950/95 p-4 shadow-xl shadow-emerald-500/20">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-200">
          <Gift className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-emerald-100">{config.title}</p>
          <p className="text-xs text-slate-300">{config.subtitle}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {config.kits.map(({ type, amount }, index) => {
          const meta = KIT_REWARD_META[type];
          const Icon = meta.icon;
          return (
            <div
              key={`${type}-${index}`}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
            >
              <Icon className={`h-4 w-4 ${meta.accent}`} />
              <div>
                <p className="text-xs font-semibold text-white">+{amount} {meta.label}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ), {
    duration: 6000,
    position: 'top-center',
    className: 'bg-transparent shadow-none',
  });
};

const DEFAULT_INVENTORY: KitInventory = {
  energy: 0,
  morale: 0,
  health: 0,
};

const DEFAULT_VIP_STATE: VipState = {
  isActive: false,
  activatedAt: null,
  expiresAt: null,
  durationReductionPercent: 0.05,
  lastMonthlyStarCardDate: null,
  starCardCredits: 0,
  plan: null,
  nostalgiaFreeAvailable: false,
  nostalgiaFreeClaimedAt: null,
};

const createDefaultInventory = (): InventoryStorage => ({
  kits: { ...DEFAULT_INVENTORY },
  lastDailyRewardDate: null,
  vip: { ...DEFAULT_VIP_STATE },
});

const DEFAULT_GAUGE = 0.75;

const formatDateKey = (date: Date): string => date.toISOString().split('T')[0] ?? '';
const formatMonthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const getMonthKeyFromIso = (value: string | null): string | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return formatMonthKey(parsed);
};
const isValidVipPlan = (value: unknown): value is VipPlan =>
  value === 'weekly' || value === 'monthly' || value === 'yearly';

const computeVipActive = (state: { isActive: boolean; expiresAt: string | null }): boolean => {
  if (!state.isActive) {
    return false;
  }
  if (!state.expiresAt) {
    return true;
  }
  const expiresAt = new Date(state.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return false;
  }
  return expiresAt.getTime() > Date.now();
};

const sanitizeVip = (candidate: Partial<VipState> | null | undefined): VipState => {
  const activatedAt = typeof candidate?.activatedAt === 'string' ? candidate?.activatedAt : null;
  const expiresAt = typeof candidate?.expiresAt === 'string' ? candidate.expiresAt : null;
  const plan = isValidVipPlan(candidate?.plan) ? candidate?.plan : null;
  const durationReductionPercent =
    typeof candidate?.durationReductionPercent === 'number'
      ? candidate.durationReductionPercent
      : DEFAULT_VIP_STATE.durationReductionPercent;
  const lastMonthlyStarCardDate =
    typeof candidate?.lastMonthlyStarCardDate === 'string'
      ? candidate.lastMonthlyStarCardDate
      : null;
  const starCardCredits =
    typeof candidate?.starCardCredits === 'number' && Number.isFinite(candidate.starCardCredits)
      ? candidate.starCardCredits
      : DEFAULT_VIP_STATE.starCardCredits;
  const nostalgiaFreeClaimedAt =
    typeof candidate?.nostalgiaFreeClaimedAt === 'string'
      ? candidate.nostalgiaFreeClaimedAt
      : null;
  const rawFreeAvailable = Boolean(candidate?.nostalgiaFreeAvailable);

  const base: VipState = {
    isActive: Boolean(candidate?.isActive),
    activatedAt,
    expiresAt,
    durationReductionPercent,
    lastMonthlyStarCardDate,
    starCardCredits,
    plan,
    nostalgiaFreeAvailable: rawFreeAvailable,
    nostalgiaFreeClaimedAt,
  };

  const isActive = computeVipActive(base);
  return {
    ...base,
    isActive,
    nostalgiaFreeAvailable: isActive && rawFreeAvailable,
  };
};

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
  const [inventory, setInventory] = useState<InventoryStorage>(createDefaultInventory());
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  const kits = inventory.kits;
  const storageKey = user ? `kits:${user.id}` : null;

  useEffect(() => {
    if (typeof window === 'undefined') {
      setHasHydrated(true);
      return;
    }

    if (!storageKey) {
      setInventory(createDefaultInventory());
      setHasHydrated(true);
      return;
    }

    setHasHydrated(false);

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setInventory(createDefaultInventory());
      } else {
        const parsed = JSON.parse(raw) as unknown;

        if (parsed && typeof parsed === 'object' && 'kits' in (parsed as Record<string, unknown>)) {
          const data = parsed as Partial<InventoryStorage>;
          const persistedKits =
            data.kits && typeof data.kits === 'object'
              ? (data.kits as Partial<KitInventory>)
              : undefined;

          setInventory({
            kits: { ...DEFAULT_INVENTORY, ...(persistedKits ?? {}) },
            lastDailyRewardDate:
              typeof data.lastDailyRewardDate === 'string' ? data.lastDailyRewardDate : null,
            vip: sanitizeVip(data.vip),
          });
        } else {
          const legacy = parsed as Partial<KitInventory> | null;
          setInventory({
            kits: { ...DEFAULT_INVENTORY, ...(legacy ?? {}) },
            lastDailyRewardDate: null,
            vip: { ...DEFAULT_VIP_STATE },
          });
        }
      }
    } catch (error) {
      console.warn('[InventoryProvider] failed to read inventory', error);
      setInventory(createDefaultInventory());
    } finally {
      setHasHydrated(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hasHydrated || !storageKey || typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(inventory));
    } catch (error) {
      console.warn('[InventoryProvider] failed to persist inventory', error);
    }
  }, [hasHydrated, inventory, storageKey]);

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

      setInventory((prev) => ({
        ...prev,
        kits: {
          ...prev.kits,
          [type]: (prev.kits[type] ?? 0) + gained,
        },
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

      setInventory((prev) => ({
        ...prev,
        kits: {
          ...prev.kits,
          [type]: Math.max(0, (prev.kits[type] ?? 0) - 1),
        },
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

  const processDailyReward = useCallback(() => {
    if (!user) {
      return;
    }

    const todayKey = formatDateKey(new Date());
    let reward: RewardToastConfig | null = null;

    setInventory((prev) => {
      if (prev.lastDailyRewardDate === todayKey) {
        return prev;
      }

      const nextKits = { ...prev.kits };
      const vipState = sanitizeVip(prev.vip);
      const vipActive = computeVipActive(vipState);

      if (vipActive) {
        KIT_TYPES.forEach((kitType) => {
          nextKits[kitType] = (nextKits[kitType] ?? 0) + 1;
        });
        reward = {
          title: 'VIP gunluk bonusu',
          subtitle: 'Enerji, moral ve saglik kitlerinden birer adet eklendi.',
          kits: KIT_TYPES.map((type) => ({ type, amount: 1 })),
        };
      } else {
        const kitType = KIT_TYPES[Math.floor(Math.random() * KIT_TYPES.length)];
        nextKits[kitType] = (nextKits[kitType] ?? 0) + 1;
        reward = {
          title: 'Gunluk giris odulu',
          subtitle: `${KIT_CONFIG[kitType].label} envanterine eklendi.`,
          kits: [{ type: kitType, amount: 1 }],
        };
      }

      return {
        ...prev,
        kits: nextKits,
        lastDailyRewardDate: todayKey,
        vip: vipState,
      };
    });

    if (reward) {
      showKitRewardToast(reward);
    }
  }, [user]);

  useEffect(() => {
    if (!hasHydrated || !user) {
      return;
    }
    processDailyReward();
  }, [hasHydrated, processDailyReward, user?.id]);

  const activateVip = useCallback(
    async (plan: VipPlan = 'monthly') => {
      if (!user) {
        toast.error('VIP ozelligini acmak icin giris yapmalisin.');
        return;
      }

      const config = VIP_PLAN_CONFIG[plan] ?? VIP_PLAN_CONFIG.monthly;
      const durationMs = config.durationDays * 24 * 60 * 60 * 1000;
      setIsProcessing(true);

      try {
        await spend(config.diamondCost);

        const now = new Date();
        const activatedIso = now.toISOString();
        let grantedWelcomeBundle = false;
        let nostalgiaUnlocked = false;

        setInventory((prev) => {
          const vipState = sanitizeVip(prev.vip);
          const wasActive = vipState.isActive;
          const currentExpiry = vipState.expiresAt ? new Date(vipState.expiresAt).getTime() : 0;
          const nowTime = now.getTime();
          const baseTime = currentExpiry > nowTime ? currentExpiry : nowTime;
          const nextExpiry = new Date(baseTime + durationMs).toISOString();
          const shouldGrantFreeNostalgia = !vipState.nostalgiaFreeClaimedAt;

          const nextVip: VipState = {
            ...vipState,
            isActive: true,
            plan,
            activatedAt: activatedIso,
            expiresAt: nextExpiry,
            nostalgiaFreeAvailable: shouldGrantFreeNostalgia,
          };

          const nextKits = wasActive
            ? prev.kits
            : {
                ...prev.kits,
                energy: (prev.kits.energy ?? 0) + 1,
                morale: (prev.kits.morale ?? 0) + 1,
                health: (prev.kits.health ?? 0) + 1,
              };

          grantedWelcomeBundle = !wasActive;
          nostalgiaUnlocked = shouldGrantFreeNostalgia;

          return {
            ...prev,
            kits: nextKits,
            vip: nextVip,
          };
        });

        toast.success(`${config.label} aktif edildi.`, {
          description: `VIP avantajlarin ${config.durationDays} gun boyunca acik.`,
        });
        if (grantedWelcomeBundle) {
          showKitRewardToast({
            title: 'VIP hosgeldin bonusu',
            subtitle: 'Enerji, moral ve saglik kitlerinden birer adet kazandin.',
            kits: KIT_TYPES.map((type) => ({ type, amount: 1 })),
          });
        }
        if (nostalgiaUnlocked) {
          toast.success('VIP nostalji hediyesi', {
            description: 'Nostalji paketini bir kere ucretsiz acabilirsin.',
          });
        }
        processDailyReward();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'VIP satin alinamadi.';
        toast.error(message || 'VIP satin alinamadi.');
      } finally {
        setIsProcessing(false);
      }
    },
    [processDailyReward, spend, user],
  );

  const deactivateVip = useCallback(() => {
    if (!user) {
      toast.error('VIP uyeligini kapatmak icin giris yapmalisin.');
      return;
    }

    let outcome: 'deactivated' | 'already' = 'already';

    setInventory((prev) => {
      const vipState = sanitizeVip(prev.vip);
      if (!vipState.isActive) {
        outcome = 'already';
        return prev;
      }
      outcome = 'deactivated';
      return {
        ...prev,
        vip: {
          ...vipState,
          isActive: false,
          expiresAt: null,
          plan: null,
          nostalgiaFreeAvailable: false,
        },
      };
    });

    if (outcome === 'deactivated') {
      toast.success('VIP uyeligi devre disi birakildi.');
    } else {
      toast('VIP uyeligin zaten devre disi.');
    }
  }, [user]);

  const claimMonthlyStarCard = useCallback(() => {
    if (!user) {
      toast.error('Yildiz oyuncu kartini almak icin giris yapmalisin.');
      return;
    }

    let outcome: 'success' | 'notVip' | 'already' = 'already';

    setInventory((prev) => {
      const vipState = sanitizeVip(prev.vip);
      if (!computeVipActive(vipState)) {
        outcome = 'notVip';
        return prev;
      }
      const currentMonth = formatMonthKey(new Date());
      const lastClaim = getMonthKeyFromIso(vipState.lastMonthlyStarCardDate);
      if (lastClaim === currentMonth) {
        outcome = 'already';
        return prev;
      }
      outcome = 'success';
      return {
        ...prev,
        vip: {
          ...vipState,
          lastMonthlyStarCardDate: new Date().toISOString(),
          starCardCredits: (vipState.starCardCredits ?? 0) + 1,
        },
      };
    });

    if (outcome === 'success') {
      toast.success('VIP yildiz oyuncu karti hesabina eklendi.');
    } else if (outcome === 'notVip') {
      toast.error('Bu ozellik sadece VIP uyeler icin.');
    } else {
      toast.error('Bu ayki yildiz oyuncu kartini zaten aldin.');
    }
  }, [user]);

  const consumeVipNostalgiaReward = useCallback(() => {
    setInventory((prev) => {
      const vipState = sanitizeVip(prev.vip);
      if (!vipState.nostalgiaFreeAvailable) {
        return prev;
      }
      return {
        ...prev,
        vip: {
          ...vipState,
          nostalgiaFreeAvailable: false,
          nostalgiaFreeClaimedAt: new Date().toISOString(),
        },
      };
    });
  }, []);

  const { lastDailyRewardDate } = inventory;
  const vipStatus = useMemo(() => sanitizeVip(inventory.vip), [inventory.vip]);
  const vipActive = computeVipActive(vipStatus);
  const vipDurationMultiplier = vipActive
    ? Math.max(0.1, 1 - vipStatus.durationReductionPercent)
    : 1;
  const vipNostalgiaFreeAvailable = vipStatus.nostalgiaFreeAvailable && vipActive;
  const currentMonthKey = formatMonthKey(new Date());
  const canClaimMonthlyStarCard =
    hasHydrated &&
    vipActive &&
    getMonthKeyFromIso(vipStatus.lastMonthlyStarCardDate) !== currentMonthKey;

  const value = useMemo<InventoryContextValue>(() => ({
    kits,
    purchaseKit,
    applyKitToPlayer,
    isProcessing,
    lastDailyRewardDate,
    processDailyReward,
    vipStatus,
    vipActive,
    vipPlans: VIP_PLAN_CONFIG,
    vipDurationMultiplier,
    vipNostalgiaFreeAvailable,
    activateVip,
    deactivateVip,
    claimMonthlyStarCard,
    canClaimMonthlyStarCard,
    consumeVipNostalgiaReward,
    isHydrated: hasHydrated,
  }), [
    kits,
    purchaseKit,
    applyKitToPlayer,
    isProcessing,
    lastDailyRewardDate,
    processDailyReward,
    vipStatus,
    vipActive,
    vipDurationMultiplier,
    vipNostalgiaFreeAvailable,
    activateVip,
    deactivateVip,
    claimMonthlyStarCard,
    canClaimMonthlyStarCard,
    consumeVipNostalgiaReward,
    hasHydrated,
  ]);

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
};

export const useInventory = (): InventoryContextValue => {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error('useInventory must be used within InventoryProvider');
  }
  return context;
};
