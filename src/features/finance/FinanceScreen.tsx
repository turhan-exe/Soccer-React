import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamBudget } from '@/hooks/useTeamBudget';
import { useCollection } from '@/hooks/useCollection';
import { db } from '@/services/firebase';
import {
  applySponsorEarnings,
  activateSponsor,
  CreditPackage,
  ensureFinanceProfile,
  ensureMonthlySalaryCharge,
  FinanceDoc,
  FinanceHistoryEntry,
  getExpectedRevenue,
  SponsorCatalogEntry,
  StadiumLevel,
  StadiumState,
  STADIUM_LEVELS,
  syncFinanceBalanceWithTeam,
  syncTeamSalaries,
  TeamSalariesDoc,
  upgradeStadiumLevel,
  UserSponsorDoc,
} from '@/services/finance';
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
import type { Player } from '@/types';
import { CREDIT_PACKAGES } from './creditPacks';
import { buildSponsorStoreProductId, mapSponsorCatalogSnapshot } from './sponsorCatalogUtils';
import { FinanceHeader, formatCurrency } from './components/FinanceHeader';
import { SummaryTab } from './components/SummaryTab';
import { StadiumTab } from './components/StadiumTab';
import { SalaryTab } from './components/SalaryTab';
import { SponsorTab } from './components/SponsorTab';
import { CreditTab } from './components/CreditTab';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default function FinanceSummaryScreen() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('summary');
  const [finance, setFinance] = useState<FinanceDoc | null>(null);
  const [stadium, setStadium] = useState<StadiumState | null>(null);
  const [history, setHistory] = useState<FinanceHistoryEntry[]>([]);
  const [salaries, setSalaries] = useState<TeamSalariesDoc | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isTeamOwner, setIsTeamOwner] = useState<boolean | null>(null);
  const [userSponsors, setUserSponsors] = useState<UserSponsorDoc[]>([]);
  const [creditLoading, setCreditLoading] = useState<string | null>(null);
  const [sponsorLoading, setSponsorLoading] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [productsById, setProductsById] = useState<Record<string, PlayBillingProduct>>({});
  const [isStoreLoading, setIsStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const { budget } = useTeamBudget();
  const {
    data: sponsorCatalogEntries,
    loading: sponsorCatalogLoading,
    error: sponsorCatalogError,
  } = useCollection<SponsorCatalogEntry>('sponsorship_catalog', mapSponsorCatalogSnapshot);

  useEffect(() => {
    if (!user) {
      return;
    }
    void ensureFinanceProfile(user.id).catch((err) =>
      console.warn('[FinanceScreen] ensure profile failed', err),
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    void syncFinanceBalanceWithTeam(user.id).catch((err) =>
      console.warn('[FinanceScreen] balance sync failed', err),
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    return onSnapshot(doc(db, 'finance', user.id), (snap) => {
      setFinance((snap.data() as FinanceDoc) ?? null);
    });
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    return onSnapshot(doc(db, 'teams', user.id, 'stadium', 'state'), (snap) => {
      setStadium((snap.data() as StadiumState) ?? null);
    });
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const since = Timestamp.fromMillis(Date.now() - THIRTY_DAYS_MS);
    const col = collection(db, 'finance', 'history', user.id);
    const q = query(col, where('timestamp', '>=', since), orderBy('timestamp', 'desc'));
    return onSnapshot(q, (snap) => {
      const entries = snap.docs.map(
        (docSnap) =>
          ({
            id: docSnap.id,
            ...docSnap.data(),
          }) as FinanceHistoryEntry,
      );
      setHistory(entries);
    });
  }, [user]);

  useEffect(() => {
    if (!user) {
      setIsTeamOwner(null);
      return;
    }
    return onSnapshot(doc(db, 'teams', user.id), (snap) => {
      const data = snap.data() as { players?: Player[]; ownerUid?: string } | undefined;
      setPlayers(data?.players ?? []);
      setIsTeamOwner(!data?.ownerUid || data.ownerUid === user.id);
    });
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    return onSnapshot(doc(db, 'teams', user.id, 'salaries', 'current'), (snap) => {
      if (!snap.exists()) {
        setSalaries(null);
        return;
      }
      setSalaries(snap.data() as TeamSalariesDoc);
    });
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const col = collection(db, 'users', user.id, 'sponsorships');
    return onSnapshot(col, (snap) => {
      setUserSponsors(
        snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as UserSponsorDoc),
        })),
      );
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
      if (err instanceof Error && err.message !== 'Yetersiz bakiye.') {
        console.warn('[FinanceScreen] ensure salary charge failed', err);
      }
    });
  }, [user]);

  const balance = typeof budget === 'number' ? budget : finance?.balance ?? 0;
  const stadiumLevel = stadium?.level ?? 1;
  const stadiumConfig = STADIUM_LEVELS[stadiumLevel];
  const nextLevelConfig = STADIUM_LEVELS[Math.min(5, stadiumLevel + 1) as StadiumLevel];

  const totals = useMemo(() => {
    const incomeTotals: Record<string, number> = {};
    const expenseTotals: Record<string, number> = {};
    let totalIncome = 0;
    let totalExpense = 0;

    history.forEach((entry) => {
      if (entry.type === 'income') {
        totalIncome += entry.amount;
        incomeTotals[entry.category] = (incomeTotals[entry.category] ?? 0) + entry.amount;
      } else {
        totalExpense += entry.amount;
        expenseTotals[entry.category] = (expenseTotals[entry.category] ?? 0) + entry.amount;
      }
    });

    return {
      totalIncome,
      totalExpense,
      net: totalIncome - totalExpense,
      incomeTotals,
      expenseTotals,
    };
  }, [history]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('tr-TR', {
        day: '2-digit',
        month: '2-digit',
      }),
    [],
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

  const expectedRevenue = useMemo(
    () => getExpectedRevenue(stadium, userSponsors, players),
    [stadium, userSponsors, players],
  );

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
              : 'Play Store baglantisi kurulurken hata olustu.',
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
            toast.success(`${creditSync.processed} bekleyen kredi satin almasi hesaba islendi.`);
          }
          if (creditSync.pending > 0) {
            toast(
              `${creditSync.pending} kredi satin almasi beklemede. Onaylandiginda otomatik islenecek.`,
            );
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
            toast.success(`${sponsorSync.processed} bekleyen sponsor satin almasi aktif edildi.`);
          }
          if (sponsorSync.pending > 0) {
            toast(
              `${sponsorSync.pending} sponsor satin almasi beklemede. Onaylandiginda otomatik islenecek.`,
            );
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

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <Card className="border-white/10 bg-slate-900">
          <CardContent className="space-y-4 p-8 text-center">
            <h2 className="text-xl font-bold">Finans Ekranina Erisim</h2>
            <p className="text-slate-400">Verileri goruntulemek icin lutfen giris yapin.</p>
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
      toast.error('Yetki Hatasi', {
        description: 'Stadyum guncellemesi icin sadece takim sahibi yetkilidir.',
      });
      return;
    }

    setUpgrading(true);
    try {
      await upgradeStadiumLevel(user.id);
      toast.success('Basarili', { description: 'Stadyum seviyesi guncellendi.' });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('missing or insufficient permissions')
      ) {
        toast.error('Yetki Hatasi', {
          description: 'Stadyum guncellemesi icin takim sahibi olmalisin.',
        });
      } else {
        toast.error('Hata', {
          description: error instanceof Error ? error.message : 'Stadyum guncellenemedi.',
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
        await activateSponsor(user.id, entry);
        toast.success('Basarili', { description: `${entry.name} sponsoru aktif edildi.` });
        return;
      }

      const productId = buildSponsorStoreProductId(entry);
      const storeProduct = productId ? productsById[productId] ?? null : null;
      if (!productId || !storeProduct) {
        throw new Error('Premium sponsor icin Play Store urunu bulunamadi.');
      }

      const purchaseResult = await beginPlayBillingPurchase(productId);
      if (purchaseResult.status === 'cancelled') {
        return;
      }

      if (purchaseResult.status === 'pending' || purchaseResult.purchaseState === 'PENDING') {
        toast(
          'Sponsor satin alma islemi beklemede. Google Play onayindan sonra otomatik aktif edilecek.',
        );
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
          toast.warning(
            'Sponsor aktif edildi. Satin alma tuketimi tamamlanamadi; finans ekranini tekrar acman gerekebilir.',
          );
          return;
        }

        toast.success('Basarili', { description: `${finalized.sponsorName} sponsoru aktif edildi.` });
        return;
      }

      if (finalized.alreadyProcessed) {
        toast.success('Bu sponsor satin almasi daha once islenmis.');
        return;
      }

      toast.success('Odeme dogrulandi.');
    } catch (error) {
      toast.error('Hata', {
        description: error instanceof Error ? error.message : 'Sponsor aktive edilemedi.',
      });
    } finally {
      setSponsorLoading(null);
    }
  };

  const handleCollectSponsor = async (sponsorId: string) => {
    setSponsorLoading(sponsorId);
    try {
      const payout = await applySponsorEarnings(user.id, sponsorId);
      toast.success('Odeme Alindi', { description: `Sponsor kazanci: ${formatCurrency(payout)}` });
    } catch (error) {
      toast.error('Hata', {
        description: error instanceof Error ? error.message : 'Sponsor kazanci alinamadi.',
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
        throw new Error('Bu kredi paketi icin Play Store urunu bulunamadi.');
      }

      const purchaseResult = await beginPlayBillingPurchase(pack.productId);
      if (purchaseResult.status === 'cancelled') {
        return;
      }

      if (purchaseResult.status === 'pending' || purchaseResult.purchaseState === 'PENDING') {
        toast('Odeme islemi beklemede. Onaylandiginda kredi paketi otomatik islenecek.');
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
            'Krediler hesaba eklendi. Satin alma tuketimi tamamlanamadi; finans ekranini tekrar acman gerekebilir.',
          );
          return;
        }

        toast.success('Kredi Yuklendi', {
          description: `${formatCurrency(pack.amount)} kredi hesabina eklendi`,
        });
        return;
      }

      if (finalized.alreadyProcessed) {
        toast.success('Bu kredi satin almasi daha once hesaba islenmis.');
        return;
      }

      toast.success('Odeme dogrulandi.');
    } catch (error) {
      toast.error('Hata', {
        description: error instanceof Error ? error.message : 'Kredi satin alinamadi.',
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
                <TabItem value="summary" label="OZET" />
                <TabItem value="stadium" label="STADYUM" />
                <TabItem value="salaries" label="MAASLAR" />
                <TabItem value="sponsors" label="SPONSORLAR" />
                <TabItem value="credits" label="KREDI" />
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
