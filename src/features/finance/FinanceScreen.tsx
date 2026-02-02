import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { db } from '@/services/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { useTeamBudget } from '@/hooks/useTeamBudget';
import {
  applySponsorEarnings,
  CreditPackage,
  ensureFinanceProfile,
  ensureMonthlySalaryCharge,
  FinanceDoc,
  FinanceHistoryEntry,
  recordCreditPurchase,
  SponsorCatalogEntry,
  StadiumState,
  STADIUM_LEVELS,
  StadiumLevel,
  syncTeamSalaries,
  syncFinanceBalanceWithTeam,
  getExpectedRevenue,
  TeamSalariesDoc,
  upgradeStadiumLevel,
  UserSponsorDoc,
  activateSponsor,
} from '@/services/finance';
import type { Player } from '@/types';

// Components
import { FinanceHeader, formatCurrency } from './components/FinanceHeader';
import { SummaryTab } from './components/SummaryTab';
import { StadiumTab } from './components/StadiumTab';
import { SalaryTab } from './components/SalaryTab';
import { SponsorTab } from './components/SponsorTab';
import { CreditTab } from './components/CreditTab';

const CREDIT_PACKAGES: CreditPackage[] = [
  { id: 'credit-10k', price: 9.99, amount: 10_000 },
  { id: 'credit-25k', price: 19.99, amount: 25_000 },
  { id: 'credit-60k', price: 49.99, amount: 60_000 },
];

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
  const { budget } = useTeamBudget();

  useEffect(() => {
    if (!user) return;
    void ensureFinanceProfile(user.id).catch((err) => console.warn('[Finance] ensure profile failed', err));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void syncFinanceBalanceWithTeam(user.id).catch((err) => console.warn('[Finance] balance sync failed', err));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'finance', user.id), (snap) => {
      setFinance((snap.data() as FinanceDoc) ?? null);
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'teams', user.id, 'stadium', 'state'), (snap) => {
      setStadium((snap.data() as StadiumState) ?? null);
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const since = Timestamp.fromMillis(Date.now() - THIRTY_DAYS_MS);
    const col = collection(db, 'finance', 'history', user.id);
    const q = query(col, where('timestamp', '>=', since), orderBy('timestamp', 'desc'));
    return onSnapshot(q, (snap) => {
      const entries = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }) as FinanceHistoryEntry);
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
    if (!user) return;
    return onSnapshot(doc(db, 'teams', user.id, 'salaries', 'current'), (snap) => {
      if (!snap.exists()) {
        setSalaries(null);
        return;
      }
      setSalaries(snap.data() as TeamSalariesDoc);
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
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
    if (!user) return;
    void syncTeamSalaries(user.id).catch((err) => console.warn('[Finance] sync salaries failed', err));
  }, [user, players]);

  useEffect(() => {
    if (!user) return;
    void ensureMonthlySalaryCharge(user.id).catch((err) => {
      if (err instanceof Error && err.message !== 'Yetersiz bakiye.') {
        console.warn('[Finance] ensure salary charge', err);
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
    return { totalIncome, totalExpense, net: totalIncome - totalExpense, incomeTotals, expenseTotals };
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
    const series: { label: string; income: number; expense: number; net: number }[] = [];
    for (let offset = 29; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setDate(today.getDate() - offset);
      const key = day.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      const income = bucket?.income ?? 0;
      const expense = bucket?.expense ?? 0;
      series.push({
        label: dateFormatter.format(day),
        income: Math.round(income),
        expense: Math.round(expense),
        net: Math.round(income - expense),
      });
    }
    return series;
  }, [history, dateFormatter]);

  const expectedRevenue = useMemo(
    () => getExpectedRevenue(stadium, userSponsors),
    [stadium, userSponsors],
  );

  const matchEntries = useMemo(
    () => history.filter((entry) => entry.type === 'income' && entry.category === 'match'),
    [history],
  );
  const averageMatchIncome = matchEntries.length
    ? matchEntries.reduce((sum, entry) => sum + entry.amount, 0) / matchEntries.length
    : 0;
  const dailyIncomeEstimate = totals.totalIncome / 30;

  if (!user) {
    return (
      <div className="p-6 text-white min-h-screen bg-slate-950 flex items-center justify-center">
        <Card className="bg-slate-900 border-white/10">
          <CardContent className="space-y-4 p-8 text-center">
            <h2 className="text-xl font-bold">Finans Ekranına Erişim</h2>
            <p className="text-slate-400">Verileri görüntülemek için lütfen giriş yapın.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleUpgrade = async () => {
    if (!user) return;
    if (isTeamOwner !== true) {
      toast.error('Yetki Hatası', { description: 'Stadyum guncellemesi icin sadece takim sahibi yetkilidir.' });
      return;
    }
    setUpgrading(true);
    try {
      await upgradeStadiumLevel(user.id);
      toast.success('Başarılı', { description: 'Stadyum seviyesi guncellendi' });
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes('missing or insufficient permissions')) {
        toast.error('Yetki Hatası', {
          description: 'Stadyum guncellemesi icin takim sahibi olmalisin.',
        });
      } else {
        toast.error('Hata', { description: err instanceof Error ? err.message : 'Stadyum guncellenemedi' });
      }
    } finally {
      setUpgrading(false);
    }
  };

  const handleActivateSponsor = async (entry: SponsorCatalogEntry) => {
    if (!user) return;
    setSponsorLoading(entry.id);
    try {
      await activateSponsor(user.id, entry);
      toast.success('Başarılı', { description: `${entry.name} sponsoru aktif` });
    } catch (err) {
      toast.error('Hata', { description: err instanceof Error ? err.message : 'Sponsor aktive edilemedi' });
    } finally {
      setSponsorLoading(null);
    }
  };

  const handleCollectSponsor = async (sponsorId: string) => {
    if (!user) return;
    setSponsorLoading(sponsorId);
    try {
      const payout = await applySponsorEarnings(user.id, sponsorId);
      toast.success('Ödeme Alındı', { description: `Sponsor kazanci: ${formatCurrency(payout)}` });
    } catch (err) {
      toast.error('Hata', { description: err instanceof Error ? err.message : 'Sponsor kazanci alinamadi' });
    } finally {
      setSponsorLoading(null);
    }
  };

  const handleCreditPurchase = async (pack: CreditPackage) => {
    if (!user) return;
    setCreditLoading(pack.id);
    try {
      await recordCreditPurchase(user.id, pack);
      toast.success('Kredi Yüklendi', { description: `${formatCurrency(pack.amount)} kredi hesabina eklendi` });
    } catch (err) {
      toast.error('Hata', { description: err instanceof Error ? err.message : 'Kredi satin alinamadi' });
    } finally {
      setCreditLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 pb-20 md:pb-6 relative overflow-x-hidden">
      {/* Background Gradients */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-900/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-900/10 blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-col h-full">
        <FinanceHeader balance={balance} />

        <main className="flex-1 px-4 py-6 max-w-5xl mx-auto w-full">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <div className="overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
              <TabsList className="flex w-max h-auto p-1 bg-slate-900/80 backdrop-blur border border-white/5 rounded-full">
                <TabItem value="summary" label="ÖZET" />
                <TabItem value="stadium" label="STADYUM" />
                <TabItem value="salaries" label="MAAŞLAR" />
                <TabItem value="sponsors" label="SPONSORLAR" />
                <TabItem value="credits" label="KREDİ" />
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
                onActivate={handleActivateSponsor}
                onCollect={handleCollectSponsor}
                loadingId={sponsorLoading}
              />
            </TabsContent>

            <TabsContent value="credits" className="mt-0 focus-visible:outline-none">
              <CreditTab packages={CREDIT_PACKAGES} loadingId={creditLoading} onPurchase={handleCreditPurchase} />
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
      className="rounded-full px-6 py-2 text-xs font-bold data-[state=active]:bg-emerald-500 data-[state=active]:text-white data-[state=active]:shadow-lg active:scale-95 transition-all text-slate-400 hover:text-white"
    >
      {label}
    </TabsTrigger>
  )
}
