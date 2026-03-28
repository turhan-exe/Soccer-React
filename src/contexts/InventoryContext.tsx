import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { BatteryCharging, Gift, HeartPulse, Smile } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { db } from '@/services/firebase';
import { KIT_CONFIG } from '@/lib/kits';
import type { KitType } from '@/types';
import {
  applyKitToPlayerInInventory,
  DEFAULT_KIT_INVENTORY,
  grantDailyRewardKits,
  getUserConsumables,
  grantKits,
  listenUserConsumables,
  replaceUserConsumables,
  sanitizeKitInventory,
  spendDiamondsAndGrantKit,
  type KitInventory,
} from '@/services/inventory';

export type { KitInventory } from '@/services/inventory';
export type KitPurchaseMethod = 'ad' | 'diamonds';
export type VipPlan = 'monthly' | 'semiAnnual' | 'yearly';

export interface VipPlanConfig {
  label: string;
  description: string;
  durationDays: number;
  diamondCost: number;
  perks: string[];
}

export const VIP_PLAN_CONFIG: Record<VipPlan, VipPlanConfig> = {
  monthly: {
    label: 'Aylik VIP',
    description: 'Haftalik avantajlari aylik olarak devam ettir.',
    durationDays: 30,
    diamondCost: 2800,
    perks: [
      'Gunluk +1 kondisyon, motivasyon ve saglik kiti',
      '%5 sure kisalmasi',
      'Her ay 1 yildiz oyuncu karti',
    ],
  },
  semiAnnual: {
    label: '6 Aylik VIP',
    description: 'Uzun vadeli premium destek ve ekstra hediyeler.',
    durationDays: 180,
    diamondCost: 15000,
    perks: [
      'Gunluk +1 kondisyon, motivasyon ve saglik kiti',
      '%5 sure kisalmasi',
      'Her ay 1 yildiz oyuncu karti',
      'Aninda 2 yildiz oyuncu karti',
      'Aninda her kitten 5 adet',
    ],
  },
  yearly: {
    label: 'Yillik VIP',
    description: 'En iyi fiyat/performans paketi.',
    durationDays: 365,
    diamondCost: 28000,
    perks: [
      'Gunluk +1 kondisyon, motivasyon ve saglik kiti',
      '%5 sure kisalmasi',
      'Her ay 2 yildiz oyuncu karti',
      'Aninda 3 yildiz oyuncu karti',
      'Aninda her kitten 10 adet',
      'Ozel sezon ici kampanyalar',
    ],
  },
};

const VIP_ACTIVATION_BONUSES: Record<
  VipPlan,
  { kitAmount: number; starCards: number; nostalgiaTokens: number }
> = {
  monthly: { kitAmount: 1, starCards: 0, nostalgiaTokens: 1 },
  semiAnnual: { kitAmount: 5, starCards: 2, nostalgiaTokens: 2 },
  yearly: { kitAmount: 10, starCards: 3, nostalgiaTokens: 3 },
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
  nostalgiaFreeTokens: number;
}

interface PersistedInventoryStorage {
  kits: KitInventory;
  lastDailyRewardDate: string | null;
  vip: VipState;
}

type InventoryMetaState = {
  lastDailyRewardDate: string | null;
  vip: VipState;
};

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
  energy: { label: 'Kondisyon Kiti', icon: BatteryCharging, accent: 'text-emerald-300' },
  morale: { label: 'Motivasyon Kiti', icon: Smile, accent: 'text-amber-300' },
  health: { label: 'Sağlık Kiti', icon: HeartPulse, accent: 'text-rose-300' },
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

  toast.custom(
    () => (
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
                  <p className="text-xs font-semibold text-white">
                    +{amount} {meta.label}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ),
    {
      duration: 6000,
      position: 'top-center',
      className: 'bg-transparent shadow-none',
    },
  );
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
  nostalgiaFreeTokens: 0,
};

const DEFAULT_META_STATE: InventoryMetaState = {
  lastDailyRewardDate: null,
  vip: { ...DEFAULT_VIP_STATE },
};

const istanbulDateKeyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const getDatePartValue = (
  parts: Intl.DateTimeFormatPart[],
  type: 'year' | 'month' | 'day',
): string => parts.find((part) => part.type === type)?.value ?? '';

const formatDateKey = (date: Date): string => {
  const parts = istanbulDateKeyFormatter.formatToParts(date);
  const year = getDatePartValue(parts, 'year');
  const month = getDatePartValue(parts, 'month');
  const day = getDatePartValue(parts, 'day');
  return `${year}-${month}-${day}`;
};
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
  value === 'monthly' || value === 'semiAnnual' || value === 'yearly';

const normalizeVipPlan = (value: unknown): VipPlan | null => {
  if (value === 'weekly') {
    return 'monthly';
  }
  return isValidVipPlan(value) ? value : null;
};

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
  const activatedAt = typeof candidate?.activatedAt === 'string' ? candidate.activatedAt : null;
  const expiresAt = typeof candidate?.expiresAt === 'string' ? candidate.expiresAt : null;
  const plan = normalizeVipPlan(candidate?.plan);
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
  const nostalgiaFreeTokens =
    typeof candidate?.nostalgiaFreeTokens === 'number' && Number.isFinite(candidate.nostalgiaFreeTokens)
      ? Math.max(0, Math.floor(candidate.nostalgiaFreeTokens))
      : rawFreeAvailable
        ? 1
        : DEFAULT_VIP_STATE.nostalgiaFreeTokens;

  const base: VipState = {
    isActive: Boolean(candidate?.isActive),
    activatedAt,
    expiresAt,
    durationReductionPercent,
    lastMonthlyStarCardDate,
    starCardCredits,
    plan,
    nostalgiaFreeAvailable: rawFreeAvailable || nostalgiaFreeTokens > 0,
    nostalgiaFreeClaimedAt,
    nostalgiaFreeTokens,
  };

  const isActive = computeVipActive(base);
  return {
    ...base,
    isActive,
    nostalgiaFreeAvailable: isActive && nostalgiaFreeTokens > 0,
  };
};

const normalizePersistedInventory = (raw: string | null): PersistedInventoryStorage => {
  if (!raw) {
    return {
      kits: { ...DEFAULT_KIT_INVENTORY },
      lastDailyRewardDate: null,
      vip: { ...DEFAULT_VIP_STATE },
    };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && 'kits' in (parsed as Record<string, unknown>)) {
      const data = parsed as Partial<PersistedInventoryStorage>;
      return {
        kits: sanitizeKitInventory(data.kits),
        lastDailyRewardDate:
          typeof data.lastDailyRewardDate === 'string' ? data.lastDailyRewardDate : null,
        vip: sanitizeVip(data.vip),
      };
    }

    return {
      kits: sanitizeKitInventory(parsed),
      lastDailyRewardDate: null,
      vip: { ...DEFAULT_VIP_STATE },
    };
  } catch (error) {
    console.warn('[InventoryProvider] failed to parse persisted inventory', error);
    return {
      kits: { ...DEFAULT_KIT_INVENTORY },
      lastDailyRewardDate: null,
      vip: { ...DEFAULT_VIP_STATE },
    };
  }
};

const userMetaRef = (uid: string) => doc(db, 'users', uid);

const hasMeaningfulVipState = (vip: VipState): boolean =>
  Boolean(vip.isActive)
  || Boolean(vip.plan)
  || Boolean(vip.activatedAt)
  || Boolean(vip.expiresAt)
  || Boolean(vip.lastMonthlyStarCardDate)
  || (vip.starCardCredits ?? 0) > 0
  || Boolean(vip.nostalgiaFreeClaimedAt)
  || (vip.nostalgiaFreeTokens ?? 0) > 0;

const persistUserVipState = async (uid: string, vip: VipState): Promise<void> => {
  await setDoc(
    userMetaRef(uid),
    {
      vip: sanitizeVip(vip),
      vipUpdatedAt: serverTimestamp(),
    },
    { merge: true },
  );
};

const persistLastDailyRewardDate = async (
  uid: string,
  lastDailyRewardDate: string,
): Promise<void> => {
  await setDoc(
    userMetaRef(uid),
    {
      lastDailyRewardDate,
      dailyRewardUpdatedAt: serverTimestamp(),
    },
    { merge: true },
  );
};

const InventoryContext = createContext<InventoryContextValue | undefined>(undefined);

export const InventoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { spend } = useDiamonds();

  const [kits, setKits] = useState<KitInventory>({ ...DEFAULT_KIT_INVENTORY });
  const [meta, setMeta] = useState<InventoryMetaState>({ ...DEFAULT_META_STATE });
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  const storageKey = user ? `kits:${user.id}` : null;

  useEffect(() => {
    if (typeof window === 'undefined') {
      setHasHydrated(true);
      return;
    }

    if (!user || !storageKey) {
      setKits({ ...DEFAULT_KIT_INVENTORY });
      setMeta({ ...DEFAULT_META_STATE });
      setHasHydrated(true);
      return;
    }

    let isMounted = true;
    let unsubscribe = () => undefined;
    const persisted = normalizePersistedInventory(window.localStorage.getItem(storageKey));

    setMeta({
      lastDailyRewardDate: persisted.lastDailyRewardDate,
      vip: persisted.vip,
    });
    setHasHydrated(false);

    const bootstrap = async () => {
      try {
        const [remote, userSnap] = await Promise.all([
          getUserConsumables(user.id),
          getDoc(userMetaRef(user.id)),
        ]);
        if (!isMounted) {
          return;
        }

        const remoteUserData =
          (userSnap.data() as {
            vip?: Partial<VipState> | null;
            lastDailyRewardDate?: string | null;
          } | undefined) ?? undefined;
        const remoteVipCandidate = remoteUserData?.vip;
        const remoteDailyRewardDate =
          typeof remoteUserData?.lastDailyRewardDate === 'string'
            ? remoteUserData.lastDailyRewardDate
            : null;
        const hasRemoteVipState =
          remoteVipCandidate != null &&
          typeof remoteVipCandidate === 'object' &&
          Object.keys(remoteVipCandidate as Record<string, unknown>).length > 0;

        if (!hasRemoteVipState && hasMeaningfulVipState(persisted.vip)) {
          await persistUserVipState(user.id, persisted.vip).catch((error) => {
            console.warn('[InventoryProvider] failed to migrate vip state to Firestore', error);
          });
        }

        if (!remoteDailyRewardDate && persisted.lastDailyRewardDate) {
          await persistLastDailyRewardDate(user.id, persisted.lastDailyRewardDate).catch((error) => {
            console.warn('[InventoryProvider] failed to migrate daily reward date to Firestore', error);
          });
        }

        const effectiveVip = hasRemoteVipState
          ? sanitizeVip(remoteVipCandidate ?? undefined)
          : sanitizeVip(persisted.vip);
        if (isMounted) {
          setMeta((previous) => ({
            ...previous,
            lastDailyRewardDate: remoteDailyRewardDate ?? previous.lastDailyRewardDate,
            vip: effectiveVip,
          }));
        }

        if (remote) {
          setKits(remote.kits);
        } else {
          const migratedKits = sanitizeKitInventory(persisted.kits);
          await replaceUserConsumables(user.id, migratedKits, {
            source: 'localStorage-migration',
            migrated: true,
          });
          if (!isMounted) {
            return;
          }
          setKits(migratedKits);
        }

        unsubscribe = listenUserConsumables(user.id, (inventory) => {
          if (!isMounted) {
            return;
          }
          setKits(inventory?.kits ?? { ...DEFAULT_KIT_INVENTORY });
        });
      } catch (error) {
        console.warn('[InventoryProvider] failed to bootstrap remote consumables', error);
        if (isMounted) {
          setKits(sanitizeKitInventory(persisted.kits));
        }
      } finally {
        if (isMounted) {
          setHasHydrated(true);
        }
      }
    };

    void bootstrap();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [storageKey, user?.id]);

  useEffect(() => {
    if (!hasHydrated || !storageKey || typeof window === 'undefined') {
      return;
    }

    const snapshot: PersistedInventoryStorage = {
      kits,
      lastDailyRewardDate: meta.lastDailyRewardDate,
      vip: meta.vip,
    };

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch (error) {
      console.warn('[InventoryProvider] failed to persist local inventory cache', error);
    }
  }, [hasHydrated, kits, meta, storageKey]);

  const purchaseKit = useCallback(
    async (type: KitType, method: KitPurchaseMethod) => {
      if (!user) {
        toast.error('Kit almak icin giris yapmalisin.');
        throw new Error('auth-required');
      }

      if (method === 'ad') {
        const error = new Error('rewarded-flow-required');
        toast.error('Kit reklamlari odullu reklam akisindan veriliyor.');
        throw error;
      }

      const config = KIT_CONFIG[type];
      setIsProcessing(true);
      try {
        await spendDiamondsAndGrantKit(user.id, type, 1, config.diamondCost);
        toast.success(`${config.label} satin alindi.`);
      } catch (error) {
        console.warn('[InventoryProvider] diamond kit purchase failed', error);
        if (error instanceof Error && error.message !== 'auth-required') {
          toast.error(error.message || 'Kit satin alinamadi.');
        }
        throw error;
      } finally {
        setIsProcessing(false);
      }
    },
    [user],
  );

  const applyKitToPlayer = useCallback(
    async (type: KitType, playerId: string) => {
      if (!user) {
        toast.error('Kit kullanmak icin giris yapmalisin.');
        throw new Error('auth-required');
      }

      setIsProcessing(true);
      try {
        const result = await applyKitToPlayerInInventory(user.id, type, playerId);
        toast.success(`${KIT_CONFIG[type].label} ${result.playerName} icin uygulandi.`);
      } catch (error) {
        console.warn('[InventoryProvider] apply kit failed', error);
        if (error instanceof Error && error.message !== 'auth-required') {
          toast.error(error.message || 'Kit kullanilamadi.');
        }
        throw error;
      } finally {
        setIsProcessing(false);
      }
    },
    [user],
  );

  const processDailyReward = useCallback(() => {
    if (!user) {
      return;
    }

    const todayKey = formatDateKey(new Date());
    if (meta.lastDailyRewardDate === todayKey) {
      return;
    }

    const vipState = sanitizeVip(meta.vip);
    const vipIsActive = computeVipActive(vipState);
    const rewards: Partial<Record<KitType, number>> = vipIsActive
      ? { energy: 1, morale: 1, health: 1 }
      : { [KIT_TYPES[Math.floor(Math.random() * KIT_TYPES.length)]]: 1 };

    void grantDailyRewardKits(user.id, rewards, todayKey)
      .then((result) => {
        if (!result.claimed) {
          setMeta((previous) => ({
            ...previous,
            lastDailyRewardDate: result.lastDailyRewardDate,
            vip: vipState,
          }));
          return;
        }

        setMeta((previous) => ({
          ...previous,
          lastDailyRewardDate: todayKey,
          vip: vipState,
        }));

        if (vipIsActive) {
          showKitRewardToast({
            title: 'VIP gunluk bonusu',
            subtitle: 'Kondisyon, motivasyon ve saglik kitlerinden birer adet eklendi.',
            kits: KIT_TYPES.map((type) => ({ type, amount: 1 })),
          });
          return;
        }

        const rewardedType = Object.keys(rewards)[0] as KitType;
        showKitRewardToast({
          title: 'Gunluk giris odulu',
          subtitle: `${KIT_CONFIG[rewardedType].label} envanterine eklendi.`,
          kits: [{ type: rewardedType, amount: 1 }],
        });
      })
      .catch((error) => {
        console.warn('[InventoryProvider] daily reward grant failed', error);
      });
  }, [meta.lastDailyRewardDate, meta.vip, user]);

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
      const activationBonus = VIP_ACTIVATION_BONUSES[plan] ?? VIP_ACTIVATION_BONUSES.monthly;
      const durationMs = config.durationDays * 24 * 60 * 60 * 1000;
      setIsProcessing(true);

      try {
        await spend(config.diamondCost);

        const now = new Date();
        const activatedIso = now.toISOString();
        const currentVip = sanitizeVip(meta.vip);
        const wasActive = currentVip.isActive;
        const currentExpiry = currentVip.expiresAt ? new Date(currentVip.expiresAt).getTime() : 0;
        const nowTime = now.getTime();
        const baseTime = currentExpiry > nowTime ? currentExpiry : nowTime;
        const nextExpiry = new Date(baseTime + durationMs).toISOString();

        const nextVip: VipState = {
          ...currentVip,
          isActive: true,
          plan,
          activatedAt: activatedIso,
          expiresAt: nextExpiry,
          nostalgiaFreeTokens: currentVip.nostalgiaFreeTokens ?? 0,
          nostalgiaFreeAvailable: currentVip.nostalgiaFreeAvailable,
          starCardCredits: currentVip.starCardCredits ?? 0,
        };

        const shouldGrantKits =
          activationBonus.kitAmount > 0 && (plan !== 'monthly' || !wasActive);

        if (shouldGrantKits) {
          await grantKits(user.id, {
            energy: activationBonus.kitAmount,
            morale: activationBonus.kitAmount,
            health: activationBonus.kitAmount,
          });
        }

        if (activationBonus.starCards > 0 && plan !== 'monthly') {
          nextVip.starCardCredits = (nextVip.starCardCredits ?? 0) + activationBonus.starCards;
        }

        const nostalgiaTokensGranted = Math.max(0, activationBonus.nostalgiaTokens ?? 0);
        if (nostalgiaTokensGranted > 0) {
          const currentTokens = Math.max(0, nextVip.nostalgiaFreeTokens ?? 0);
          const updatedTokens = currentTokens + nostalgiaTokensGranted;
          nextVip.nostalgiaFreeTokens = updatedTokens;
          nextVip.nostalgiaFreeAvailable = updatedTokens > 0;
        } else {
          nextVip.nostalgiaFreeAvailable = nextVip.nostalgiaFreeTokens > 0;
        }

        await persistUserVipState(user.id, nextVip);

        setMeta((previous) => ({
          ...previous,
          vip: nextVip,
        }));

        toast.success(`${config.label} aktif edildi.`, {
          description: `VIP avantajlarin ${config.durationDays} gun boyunca acik.`,
        });

        if (shouldGrantKits) {
          showKitRewardToast({
            title: 'VIP bonus hediyesi',
            subtitle: `Kondisyon, motivasyon ve saglik kitlerinden ${activationBonus.kitAmount} adet kazandin.`,
            kits: KIT_TYPES.map((type) => ({ type, amount: activationBonus.kitAmount })),
          });
        }

        if (activationBonus.starCards > 0 && plan !== 'monthly') {
          toast.success('VIP yildiz oyuncu bonusu', {
            description: `${activationBonus.starCards} yildiz oyuncu karti hesabina eklendi.`,
          });
        }

        if (activationBonus.nostalgiaTokens > 0) {
          toast.success('VIP nostalji hediyesi', {
            description:
              activationBonus.nostalgiaTokens === 1
                ? 'Nostalji paketini bir kez ucretsiz acabilirsin.'
                : `Nostalji paketlerini ${activationBonus.nostalgiaTokens} kez ucretsiz acabilirsin.`,
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
    [meta.vip, processDailyReward, spend, user],
  );

  const deactivateVip = useCallback(() => {
    if (!user) {
      toast.error('VIP uyeligini kapatmak icin giris yapmalisin.');
      return;
    }

    const isActive = sanitizeVip(meta.vip).isActive;
    if (!isActive) {
      toast('VIP uyeligin zaten devre disi.');
      return;
    }

    const nextVip = {
      ...sanitizeVip(meta.vip),
      isActive: false,
      expiresAt: null,
      plan: null,
      nostalgiaFreeAvailable: false,
    };

    setMeta((previous) => ({
      ...previous,
      vip: nextVip,
    }));
    void persistUserVipState(user.id, nextVip).catch((error) => {
      console.warn('[InventoryProvider] failed to persist vip deactivation', error);
    });

    toast.success('VIP uyeligi devre disi birakildi.');
  }, [meta.vip, user]);

  const claimMonthlyStarCard = useCallback(() => {
    if (!user) {
      toast.error('Yildiz oyuncu kartini almak icin giris yapmalisin.');
      return;
    }

    const currentVipStatus = sanitizeVip(meta.vip);
    const currentVipActive = computeVipActive(currentVipStatus);
    const currentMonth = formatMonthKey(new Date());

    if (!currentVipActive) {
      toast.error('Bu ozellik sadece VIP uyeler icin.');
      return;
    }

    if (getMonthKeyFromIso(currentVipStatus.lastMonthlyStarCardDate) === currentMonth) {
      toast.error('Bu ayki yildiz oyuncu kartini zaten aldin.');
      return;
    }

    const grantedAmount = currentVipStatus.plan === 'yearly' ? 2 : 1;
    let nextVipState: VipState | null = null;

    setMeta((previous) => {
      const vipState = sanitizeVip(previous.vip);
      const claimAmount = vipState.plan === 'yearly' ? 2 : 1;
      nextVipState = {
        ...vipState,
        lastMonthlyStarCardDate: new Date().toISOString(),
        starCardCredits: (vipState.starCardCredits ?? 0) + claimAmount,
      };
      return {
        ...previous,
        vip: nextVipState,
      };
    });
    if (nextVipState) {
      void persistUserVipState(user.id, nextVipState).catch((error) => {
        console.warn('[InventoryProvider] failed to persist monthly star card claim', error);
      });
    }

    const message =
      grantedAmount === 1
        ? 'VIP yildiz oyuncu karti hesabina eklendi.'
        : `${grantedAmount} VIP yildiz oyuncu karti hesabina eklendi.`;
    toast.success(message);
  }, [meta.vip, user]);

  const consumeVipNostalgiaReward = useCallback(() => {
    let nextVipState: VipState | null = null;
    setMeta((previous) => {
      const vipState = sanitizeVip(previous.vip);
      if (!vipState.nostalgiaFreeAvailable) {
        return previous;
      }
      const currentTokens = Math.max(0, vipState.nostalgiaFreeTokens ?? 0);
      if (currentTokens <= 0) {
        return previous;
      }
      const nextTokens = currentTokens - 1;
      nextVipState = {
        ...vipState,
        nostalgiaFreeTokens: nextTokens,
        nostalgiaFreeAvailable: nextTokens > 0,
        nostalgiaFreeClaimedAt: new Date().toISOString(),
      };
      return {
        ...previous,
        vip: nextVipState,
      };
    });
    if (user?.id && nextVipState) {
      void persistUserVipState(user.id, nextVipState).catch((error) => {
        console.warn('[InventoryProvider] failed to persist nostalgia reward consumption', error);
      });
    }
  }, [user?.id]);

  const lastDailyRewardDate = meta.lastDailyRewardDate;
  const vipStatus = useMemo(() => sanitizeVip(meta.vip), [meta.vip]);
  const vipActive = computeVipActive(vipStatus);
  const vipDurationMultiplier = vipActive
    ? Math.max(0.1, 1 - vipStatus.durationReductionPercent)
    : 1;
  const vipNostalgiaFreeAvailable = vipStatus.nostalgiaFreeAvailable && vipActive;
  const currentMonthKey = formatMonthKey(new Date());
  const canClaimMonthlyStarCard =
    hasHydrated
    && vipActive
    && getMonthKeyFromIso(vipStatus.lastMonthlyStarCardDate) !== currentMonthKey;

  const value = useMemo<InventoryContextValue>(
    () => ({
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
    }),
    [
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
    ],
  );

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
};

export const useInventory = (): InventoryContextValue => {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error('useInventory must be used within InventoryProvider');
  }
  return context;
};
