import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useInventory } from '@/contexts/InventoryContext';
import { useTranslation } from '@/contexts/LanguageContext';
import { useClubFinance } from '@/hooks/useClubFinance';
import { useCollection } from '@/hooks/useCollection';
import {
  applySponsorEarnings,
  activateSponsor,
  claimVipDailyCredits,
  ClaimVipDailyCreditResponse,
  CreditPackage,
  ensureMonthlySalaryCharge,
  getVipDailyCreditAvailability,
  SponsorCatalogEntry,
  StadiumLevel,
  STADIUM_LEVELS,
  syncTeamSalaries,
  upgradeStadiumLevel,
  VIP_DAILY_CREDIT_AMOUNT,
  VIP_DAILY_CREDIT_DIAMOND_COST,
  type VipDailyCreditSummary,
} from '@/services/finance';
import { db } from '@/services/firebase';
import {
  getPlayBillingUnavailableMessage,
  isNativeAndroidPlayBillingSupported,
  loadPlayBillingProducts,
  startPlayBillingPurchase,
  type PlayBillingProduct,
} from '@/services/playBilling';
import {
  finalizeAndroidCreditPurchase,
  syncPendingAndroidCreditPurchases,
} from '@/services/creditPurchases';
import {
  finalizeAndroidSponsorPurchase,
  syncPendingAndroidSponsorPurchases,
} from '@/services/sponsorPurchases';
import { CREDIT_PACKAGES } from './creditPacks';
import { buildSponsorStoreProductId, mapSponsorCatalogSnapshot } from './sponsorCatalogUtils';
import { FinanceHeader, formatCurrency } from './components/FinanceHeader';
import { SummaryTab } from './components/SummaryTab';
import { StadiumTab } from './components/StadiumTab';
import { SalaryTab } from './components/SalaryTab';
import { SponsorTab } from './components/SponsorTab';
import { CreditTab } from './components/CreditTab';

const getErrorCode = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';

const getErrorDetails = (error: unknown): Record<string, unknown> | null => {
  if (typeof error !== 'object' || error === null || !('details' in error)) {
    return null;
  }

  const details = (error as { details?: unknown }).details;
  return typeof details === 'object' && details !== null
    ? (details as Record<string, unknown>)
    : null;
};

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const readVipDailyCreditSummary = (value: unknown): VipDailyCreditSummary => {
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const rawLastClaimAt = data.lastClaimAt;
  const lastClaimAt =
    rawLastClaimAt instanceof Timestamp
      ? rawLastClaimAt
      : rawLastClaimAt && typeof rawLastClaimAt === 'object' && 'toDate' in rawLastClaimAt
        ? (rawLastClaimAt as Timestamp)
        : null;

  return {
    lastClaimDate: typeof data.lastClaimDate === 'string' ? data.lastClaimDate : null,
    lastClaimAmount:
      typeof data.lastClaimAmount === 'number' && Number.isFinite(data.lastClaimAmount)
        ? data.lastClaimAmount
        : null,
    claimCostDiamonds:
      typeof data.claimCostDiamonds === 'number' && Number.isFinite(data.claimCostDiamonds)
        ? data.claimCostDiamonds
        : null,
    lastClaimAt,
  };
};

const formatSponsorErrorMessage = (
  error: unknown,
  fallback: string,
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string => {
  const details = getErrorDetails(error);
  const nextPayoutAtRaw = typeof details?.nextPayoutAt === 'string' ? details.nextPayoutAt : '';
  if (nextPayoutAtRaw) {
    const nextPayoutAt = new Date(nextPayoutAtRaw);
    if (!Number.isNaN(nextPayoutAt.getTime())) {
      return t('finance.errors.sponsorNextReady', {
        date: formatDate(nextPayoutAt, {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    }
  }

  return getErrorMessage(error, fallback);
};

const formatVipDailyCreditErrorMessage = (
  error: unknown,
  fallback: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string => {
  const details = getErrorDetails(error);
  if (details?.reason === 'already_claimed') {
    return t('finance.errors.vipAlreadyClaimed');
  }
  if (details?.reason === 'vip_inactive') {
    return t('finance.errors.vipInactive');
  }
  if (details?.reason === 'insufficient_diamonds') {
    return t('finance.errors.vipInsufficientDiamonds');
  }

  return getErrorMessage(error, fallback);
};

const logSponsorActionError = ({
  action,
  path,
  sponsorId,
  sponsorType,
  error,
}: {
  action: 'activate' | 'collect';
  path: 'free' | 'premium' | 'collect';
  sponsorId: string;
  sponsorType?: SponsorCatalogEntry['type'];
  error: unknown;
}) => {
  const payload = {
    action,
    path,
    sponsorId,
    sponsorType: sponsorType ?? null,
    code: getErrorCode(error) || null,
    message: getErrorMessage(error, 'Unknown sponsor error.'),
    details: getErrorDetails(error),
  };
  console.error(`[FinanceScreen] sponsor action failed ${JSON.stringify(payload)}`);
};

const getPurchaseErrorMessage = (
  error: unknown,
  fallback: string,
  permissionFallback?: string,
): string => {
  const rawMessage = getErrorMessage(error, fallback);
  const normalized = rawMessage.toLowerCase();
  const firebaseCode = getErrorCode(error);

  if (
    normalized.includes('missing or insufficient permissions') ||
    normalized.includes('insufficient permissions')
  ) {
    return permissionFallback ?? fallback;
  }

  if (firebaseCode === 'functions/permission-denied') {
    return rawMessage || fallback;
  }

  return rawMessage;
};

export default function FinanceSummaryScreen() {
  const { user } = useAuth();
  const { vipActive } = useInventory();
  const { t, formatDate } = useTranslation();
  const [activeTab, setActiveTab] = useState('summary');
  const [isTeamOwner, setIsTeamOwner] = useState<boolean | null>(null);
  const [creditLoading, setCreditLoading] = useState<string | null>(null);
  const [sponsorLoading, setSponsorLoading] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [productsById, setProductsById] = useState<Record<string, PlayBillingProduct>>({});
  const [isStoreLoading, setIsStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [vipDailyCreditSummary, setVipDailyCreditSummary] = useState<VipDailyCreditSummary | null>(null);
  const {
    cashBalance: balance,
    expectedRevenue,
    history,
    salaries,
    stadium,
    sponsors: userSponsors,
    teamPlayers: players,
    teamOwnerId,
    last30dIncome,
    last30dExpense,
    last30dNet,
  } = useClubFinance({ includeDetails: true });
  const {
    data: sponsorCatalogEntries,
    loading: sponsorCatalogLoading,
    error: sponsorCatalogError,
  } = useCollection<SponsorCatalogEntry>('sponsorship_catalog', mapSponsorCatalogSnapshot);

  useEffect(() => {
    if (!user) {
      setIsTeamOwner(null);
      return;
    }

    const ownerId = teamOwnerId;
    setIsTeamOwner(!ownerId || ownerId === user.id);
  }, [teamOwnerId, user]);

  useEffect(() => {
    if (!user) {
      setVipDailyCreditSummary(null);
      return;
    }

    return onSnapshot(doc(db, 'users', user.id), (snapshot) => {
      const data = (snapshot.data() as { vipDailyCredit?: unknown } | undefined) ?? undefined;
      setVipDailyCreditSummary(readVipDailyCreditSummary(data?.vipDailyCredit));
    });
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    void syncTeamSalaries(user.id).catch((err) => console.warn('[FinanceScreen] sync salaries failed', err));
  }, [user, players]);

  useEffect(() => {
    if (!user) {
      return;
    }
    void ensureMonthlySalaryCharge(user.id).catch((err) => {
      if (
        err instanceof Error &&
        err.message !== t('finance.stadium.insufficientBalance')
      ) {
        console.warn('[FinanceScreen] ensure salary charge failed', err);
      }
    });
  }, [t, user]);

  const stadiumLevel = stadium?.level ?? 1;
  const stadiumConfig = STADIUM_LEVELS[stadiumLevel];
  const nextLevelConfig = STADIUM_LEVELS[Math.min(5, stadiumLevel + 1) as StadiumLevel];

  const totals = useMemo(() => {
    return {
      totalIncome: last30dIncome,
      totalExpense: last30dExpense,
      net: last30dNet,
      incomeTotals: {},
      expenseTotals: {},
    };
  }, [last30dExpense, last30dIncome, last30dNet]);

  const dateFormatter = useMemo(
    () => ({
      format: (value: Date) =>
        formatDate(value, {
          day: '2-digit',
          month: '2-digit',
        }),
    }),
    [formatDate],
  );

  const chartData = useMemo(() => {
    const buckets = new Map<string, { income: number; expense: number; date: Date }>();

    history.forEach((entry) => {
      const ts = entry.timestamp?.toDate?.();
      if (!ts) {
        return;
      }

      const day = new Date(ts);
      day.setHours(0, 0, 0, 0);
      const key = day.toISOString().slice(0, 10);
      const bucket = buckets.get(key) ?? { income: 0, expense: 0, date: day };

      if (entry.type === 'income') {
        bucket.income += entry.amount;
      } else {
        bucket.expense += entry.amount;
      }

      buckets.set(key, bucket);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Array.from({ length: 30 }, (_, index) => {
      const day = new Date(today);
      day.setDate(today.getDate() - (29 - index));
      const key = day.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      const income = bucket?.income ?? 0;
      const expense = bucket?.expense ?? 0;

      return {
        label: dateFormatter.format(day),
        income: Math.round(income),
        expense: Math.round(expense),
        net: Math.round(income - expense),
      };
    });
  }, [history, dateFormatter]);

  const premiumSponsorEntries = useMemo(
    () => sponsorCatalogEntries.filter((entry) => entry.type === 'premium'),
    [sponsorCatalogEntries],
  );
  const premiumSponsorProductIds = useMemo(
    () => premiumSponsorEntries.map((entry) => buildSponsorStoreProductId(entry)).filter(Boolean),
    [premiumSponsorEntries],
  );
  const premiumSponsorKey = useMemo(
    () => premiumSponsorProductIds.join('|'),
    [premiumSponsorProductIds],
  );

  useEffect(() => {
    let isCancelled = false;

    async function prepareStore() {
      if (!user) {
        setProductsById({});
        setStoreError(null);
        setIsStoreLoading(false);
        return;
      }

      if (!isNativeAndroidPlayBillingSupported()) {
        setProductsById({});
        setStoreError(getPlayBillingUnavailableMessage());
        setIsStoreLoading(false);
        return;
      }

      const productIds = [
        ...new Set([...CREDIT_PACKAGES.map((pack) => pack.productId), ...premiumSponsorProductIds]),
      ];

      setStoreError(null);
      setIsStoreLoading(true);

      try {
        const products = await loadPlayBillingProducts(productIds);
        if (!isCancelled) {
          setProductsById(products);
        }
      } catch (error) {
        console.warn('[FinanceScreen] prepare store failed', error);
        if (!isCancelled) {
          setStoreError(
            error instanceof Error
              ? error.message
              : t('finance.errors.playStorePrepare'),
          );
        }
      } finally {
        if (!isCancelled) {
          setIsStoreLoading(false);
        }
      }

      try {
        const creditSync = await syncPendingAndroidCreditPurchases();
        if (!isCancelled) {
          if (creditSync.processed > 0) {
            toast.success(t('finance.errors.pendingCreditSync', { count: creditSync.processed }));
          }
          if (creditSync.pending > 0) {
            toast(t('finance.errors.pendingCreditWait', { count: creditSync.pending }));
          }
        }
      } catch (error) {
        console.warn('[FinanceScreen] pending credit purchase sync failed', error);
      }

      if (premiumSponsorEntries.length === 0) {
        return;
      }

      try {
        const sponsorSync = await syncPendingAndroidSponsorPurchases(premiumSponsorEntries);
        if (!isCancelled) {
          if (sponsorSync.processed > 0) {
            toast.success(t('finance.errors.pendingSponsorSync', { count: sponsorSync.processed }));
          }
          if (sponsorSync.pending > 0) {
            toast(t('finance.errors.pendingSponsorWait', { count: sponsorSync.pending }));
          }
        }
      } catch (error) {
        console.warn('[FinanceScreen] pending sponsor purchase sync failed', error);
      }
    }

    void prepareStore();

    return () => {
      isCancelled = true;
    };
  }, [user, premiumSponsorEntries, premiumSponsorProductIds, premiumSponsorKey]);

  const averageMatchIncome = expectedRevenue.matchEstimate;
  const dailyIncomeEstimate = expectedRevenue.projectedDailyIncome;
  const vipDailyCreditAvailability = useMemo(
    () => getVipDailyCreditAvailability(vipActive, vipDailyCreditSummary),
    [vipActive, vipDailyCreditSummary],
  );

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <Card className="border-white/10 bg-slate-900">
          <CardContent className="space-y-4 p-8 text-center">
            <h2 className="text-xl font-bold">{t('finance.page.loginTitle')}</h2>
            <p className="text-slate-400">{t('finance.page.loginDescription')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const beginPlayBillingPurchase = async (productId: string) => {
    if (!isNativeAndroidPlayBillingSupported()) {
      throw new Error(getPlayBillingUnavailableMessage());
    }

    return startPlayBillingPurchase({
      productId,
      obfuscatedAccountId: user.id,
      obfuscatedProfileId: user.id,
    });
  };

  const handleUpgrade = async () => {
    if (isTeamOwner !== true) {
      toast.error(t('finance.errors.ownerOnlyTitle'), {
        description: t('finance.errors.ownerOnlyDescription'),
      });
      return;
    }

    setUpgrading(true);
    try {
      await upgradeStadiumLevel(user.id);
      toast.success(t('finance.errors.upgradeSuccessTitle'), {
        description: t('finance.errors.upgradeSuccessDescription'),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('missing or insufficient permissions')
      ) {
        toast.error(t('finance.errors.ownerOnlyTitle'), {
          description: t('finance.errors.ownerOnlyDescription'),
        });
      } else {
        toast.error(t('finance.errors.genericTitle'), {
          description: error instanceof Error ? error.message : t('finance.errors.upgradeFailed'),
        });
      }
    } finally {
      setUpgrading(false);
    }
  };

  const handleActivateSponsor = async (entry: SponsorCatalogEntry) => {
    setSponsorLoading(entry.id);
    try {
      if (entry.type !== 'premium') {
        const activated = await activateSponsor(entry);
        toast.success(t('finance.errors.upgradeSuccessTitle'), {
          description: t('finance.errors.sponsorActivated', { name: activated.sponsorName }),
        });
        return;
      }

      const productId = buildSponsorStoreProductId(entry);
      const storeProduct = productId ? productsById[productId] ?? null : null;
      if (!productId || !storeProduct) {
        throw new Error(t('finance.errors.sponsorPremiumProductMissing'));
      }

      const purchaseResult = await beginPlayBillingPurchase(productId);
      if (purchaseResult.status === 'cancelled') {
        return;
      }

      if (purchaseResult.status === 'pending' || purchaseResult.purchaseState === 'PENDING') {
        toast(t('finance.errors.sponsorPending'));
        return;
      }

      if (!purchaseResult.purchaseToken) {
        throw new Error('purchase_token_missing');
      }

      const finalized = await finalizeAndroidSponsorPurchase({
        sponsorId: entry.id,
        productId,
        purchaseToken: purchaseResult.purchaseToken,
        orderId: purchaseResult.orderId ?? null,
        packageName: purchaseResult.packageName ?? null,
      });

      if (finalized.granted) {
        if (finalized.consumeAttempted && !finalized.consumed) {
          toast.warning(t('finance.errors.sponsorActivated', { name: finalized.sponsorName }));
          return;
        }

        toast.success(t('finance.errors.upgradeSuccessTitle'), {
          description: t('finance.errors.sponsorActivated', { name: finalized.sponsorName }),
        });
        return;
      }

      if (finalized.alreadyProcessed) {
        toast.success(t('finance.errors.sponsorAlreadyProcessed'));
        return;
      }

      toast.success(t('finance.errors.sponsorValidated'));
    } catch (error) {
      logSponsorActionError({
        action: 'activate',
        path: entry.type === 'premium' ? 'premium' : 'free',
        sponsorId: entry.id,
        sponsorType: entry.type,
        error,
      });
      toast.error(t('finance.errors.genericTitle'), {
        description: getPurchaseErrorMessage(
          error,
          t('finance.errors.sponsorPremiumProductMissing'),
          t('finance.errors.purchasePermissionDetailed'),
        ),
      });
    } finally {
      setSponsorLoading(null);
    }
  };

  const handleCollectSponsor = async (sponsorId: string) => {
    setSponsorLoading(sponsorId);
    try {
      const payout = await applySponsorEarnings(sponsorId);
      toast.success(t('finance.errors.sponsorCollectTitle'), {
        description: t('finance.errors.sponsorCollectDescription', {
          value: formatCurrency(payout.payout),
        }),
      });
    } catch (error) {
      logSponsorActionError({
        action: 'collect',
        path: 'collect',
        sponsorId,
        error,
      });
      toast.error(t('finance.errors.genericTitle'), {
        description: formatSponsorErrorMessage(
          error,
          t('finance.errors.sponsorCollectFailed'),
          formatDate,
          t,
        ),
      });
    } finally {
      setSponsorLoading(null);
    }
  };

  const handleCreditPurchase = async (pack: CreditPackage) => {
    setCreditLoading(pack.id);
    try {
      const storeProduct = productsById[pack.productId] ?? null;
      if (!storeProduct) {
        throw new Error(t('finance.errors.creditProductMissing'));
      }

      const purchaseResult = await beginPlayBillingPurchase(pack.productId);
      if (purchaseResult.status === 'cancelled') {
        return;
      }

      if (purchaseResult.status === 'pending' || purchaseResult.purchaseState === 'PENDING') {
        toast(t('finance.errors.creditPending'));
        return;
      }

      if (!purchaseResult.purchaseToken) {
        throw new Error('purchase_token_missing');
      }

      const finalized = await finalizeAndroidCreditPurchase({
        productId: pack.productId,
        purchaseToken: purchaseResult.purchaseToken,
        orderId: purchaseResult.orderId ?? null,
        packageName: purchaseResult.packageName ?? null,
      });

      if (finalized.granted) {
        if (finalized.consumeAttempted && !finalized.consumed) {
          toast.warning(
            t('finance.errors.creditLoadedDescription', {
              value: formatCurrency(pack.amount),
            }),
          );
          return;
        }

        toast.success(t('finance.errors.creditLoadedTitle'), {
          description: t('finance.errors.creditLoadedDescription', {
            value: formatCurrency(pack.amount),
          }),
        });
        return;
      }

      if (finalized.alreadyProcessed) {
        toast.success(t('finance.errors.creditAlreadyProcessed'));
        return;
      }

      toast.success(t('finance.errors.sponsorValidated'));
    } catch (error) {
      toast.error(t('finance.errors.genericTitle'), {
        description: getPurchaseErrorMessage(
          error,
          t('finance.errors.creditProductMissing'),
          t('finance.errors.purchasePermissionDetailed'),
        ),
      });
    } finally {
      setCreditLoading(null);
    }
  };

  const handleClaimVipDailyCredit = async () => {
    setCreditLoading('vip-daily-credit');
    try {
      const claimed: ClaimVipDailyCreditResponse = await claimVipDailyCredits();
      toast.success(t('finance.errors.vipClaimTitle'), {
        description: t('finance.errors.vipClaimDescription', {
          value: formatCurrency(claimed.amount),
        }),
      });
    } catch (error) {
      toast.error(t('finance.errors.genericTitle'), {
        description: formatVipDailyCreditErrorMessage(
          error,
          t('finance.errors.vipClaimFailed'),
          t,
        ),
      });
    } finally {
      setCreditLoading(null);
    }
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950 pb-20 md:pb-6">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[-10%] top-[-10%] h-[50%] w-[50%] rounded-full bg-emerald-900/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[50%] w-[50%] rounded-full bg-indigo-900/10 blur-[120px]" />
      </div>

      <div className="relative z-10 flex h-full flex-col">
        <FinanceHeader balance={balance} />

        <main className="mx-auto flex-1 w-full max-w-5xl px-4 py-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <div className="-mx-4 overflow-x-auto px-4 pb-2 scrollbar-hide">
              <TabsList className="flex h-auto w-max rounded-full border border-white/5 bg-slate-900/80 p-1 backdrop-blur">
                <TabItem value="summary" label={t('finance.tabs.summary')} />
                <TabItem value="stadium" label={t('finance.tabs.stadium')} />
                <TabItem value="salaries" label={t('finance.tabs.salaries')} />
                <TabItem value="sponsors" label={t('finance.tabs.sponsors')} />
                <TabItem value="credits" label={t('finance.tabs.credits')} />
              </TabsList>
            </div>

            <TabsContent value="summary" className="mt-0 focus-visible:outline-none">
              <SummaryTab
                totals={totals}
                history={history}
                chartData={chartData}
                averageMatchIncome={averageMatchIncome}
                dailyIncomeEstimate={dailyIncomeEstimate}
                expectedRevenue={expectedRevenue}
                balance={balance}
                stadiumLevel={stadiumLevel}
                stadiumCapacity={stadiumConfig.capacity}
                onBuyCredit={() => setActiveTab('credits')}
              />
            </TabsContent>

            <TabsContent value="stadium" className="mt-0 focus-visible:outline-none">
              <StadiumTab
                config={stadiumConfig}
                level={stadiumLevel}
                nextConfig={nextLevelConfig}
                estimatedMatchIncome={expectedRevenue.matchEstimate}
                attendanceRate={expectedRevenue.attendanceRate}
                occupiedSeats={expectedRevenue.occupiedSeats}
                balance={balance}
                upgrading={upgrading}
                onUpgrade={handleUpgrade}
                hasPermission={isTeamOwner}
              />
            </TabsContent>

            <TabsContent value="salaries" className="mt-0 focus-visible:outline-none">
              <SalaryTab salaries={salaries} />
            </TabsContent>

            <TabsContent value="sponsors" className="mt-0 focus-visible:outline-none">
              <SponsorTab
                sponsors={userSponsors}
                catalogEntries={sponsorCatalogEntries}
                catalogLoading={sponsorCatalogLoading}
                catalogError={sponsorCatalogError}
                onActivate={handleActivateSponsor}
                onCollect={handleCollectSponsor}
                loadingId={sponsorLoading}
                storeProductsById={productsById}
                isStoreLoading={isStoreLoading}
                storeError={storeError}
              />
            </TabsContent>

            <TabsContent value="credits" className="mt-0 focus-visible:outline-none">
              <CreditTab
                packages={CREDIT_PACKAGES}
                loadingId={creditLoading}
                onPurchase={handleCreditPurchase}
                productsById={productsById}
                isStoreLoading={isStoreLoading}
                storeError={storeError}
                vipActive={vipActive}
                vipClaimAvailable={vipDailyCreditAvailability.canClaim}
                vipClaimedToday={vipDailyCreditAvailability.claimedToday}
                vipClaimLoading={creditLoading === 'vip-daily-credit'}
                vipBonusAmount={VIP_DAILY_CREDIT_AMOUNT}
                vipBonusDiamondCost={VIP_DAILY_CREDIT_DIAMOND_COST}
                vipNextClaimDateKey={vipDailyCreditAvailability.nextClaimDateKey}
                onClaimVipBonus={handleClaimVipDailyCredit}
              />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}

function TabItem({ value, label }: { value: string; label: string }) {
  return (
    <TabsTrigger
      value={value}
      className="rounded-full px-6 py-2 text-xs font-bold text-slate-400 transition-all hover:text-white data-[state=active]:bg-emerald-500 data-[state=active]:text-white data-[state=active]:shadow-lg active:scale-95"
    >
      {label}
    </TabsTrigger>
  );
}
