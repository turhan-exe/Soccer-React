import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { Wallet, Building2, Users, BarChart3, Coins, CreditCard, RefreshCcw } from 'lucide-react';
import { db } from '@/services/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { BackButton } from '@/components/ui/back-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart as RechartsBarChart, Bar, CartesianGrid, XAxis, YAxis } from 'recharts';
import SponsorCatalog from './SponsorCatalog';
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
  StadiumLevelConfig,
  syncTeamSalaries,
  syncFinanceBalanceWithTeam,
  ExpectedRevenueBreakdown,
  getExpectedRevenue,
  TeamSalariesDoc,
  TeamSalaryRecord,
  upgradeStadiumLevel,
  UserSponsorDoc,
  activateSponsor,
  StadiumLevel,
} from '@/services/finance';
import type { Player } from '@/types';

const CREDIT_PACKAGES: CreditPackage[] = [
  { id: 'credit-10k', price: 9.99, amount: 10_000 },
  { id: 'credit-25k', price: 19.99, amount: 25_000 },
  { id: 'credit-60k', price: 49.99, amount: 60_000 },
];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SUMMARY_CHART_CONFIG = {
  income: {
    label: 'Gelir',
    color: 'hsl(152 58% 52%)',
  },
  expense: {
    label: 'Gider',
    color: 'hsl(346 74% 60%)',
  },
} as const;

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
      const entries = snap.docs.map((docSnap) => docSnap.data() as FinanceHistoryEntry);
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
      <div className="p-6">
        <Card>
          <CardContent className="space-y-2 p-6">
            <h2 className="text-xl font-semibold">Finans ekranina erismek icin giris yap</h2>
            <p className="text-slate-400">Bakiye ve raporlar takima ozel olarak saklaniyor.</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  const handleUpgrade = async () => {
    if (!user) return;
    if (isTeamOwner !== true) {
      toast.error('Stadyum guncellemesi icin sadece takim sahibi yetkilidir.');
      return;
    }
    setUpgrading(true);
    try {
      await upgradeStadiumLevel(user.id);
      toast.success('Stadyum seviyesi guncellendi');
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes('missing or insufficient permissions')) {
        toast.error('Yetki hatasi', {
          description: 'Stadyum guncellemesi icin takim sahibi olmalisin. Lutfen hesabinin yetkilerini kontrol et.',
        });
      } else {
        toast.error(err instanceof Error ? err.message : 'Stadyum guncellenemedi');
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
      toast.success(`${entry.name} sponsoru aktif`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sponsor aktive edilemedi');
    } finally {
      setSponsorLoading(null);
    }
  };

  const handleCollectSponsor = async (sponsorId: string) => {
    if (!user) return;
    setSponsorLoading(sponsorId);
    try {
      const payout = await applySponsorEarnings(user.id, sponsorId);
      toast.success(`Sponsor kazanci: ${formatCurrency(payout)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sponsor kazanci alinamadi');
    } finally {
      setSponsorLoading(null);
    }
  };

  const handleCreditPurchase = async (pack: CreditPackage) => {
    if (!user) return;
    setCreditLoading(pack.id);
    try {
      await recordCreditPurchase(user.id, pack);
      toast.success(`${formatCurrency(pack.amount)} kredi hesabina eklendi`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Kredi satin alinamadi');
    } finally {
      setCreditLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-900/80 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <BackButton />
            <div>
              <p className="text-xs uppercase tracking-widest text-emerald-300">Finans Merkezi</p>
              <h1 className="text-2xl font-bold">FinanceSummaryScreen</h1>
            </div>
          </div>
          <Badge variant="outline" className="border-emerald-400/40 text-emerald-200">
            Bakiye: {formatCurrency(balance)}
          </Badge>
        </div>
      </header>

      <main className="px-4 py-6 space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryPill icon={<Wallet className="h-4 w-4" />} label="Mevcut Bakiye" value={formatCurrency(balance)} tone="emerald" />
          <SummaryPill
            icon={<Building2 className="h-4 w-4" />}
            label={`Stadyum Seviye ${stadiumLevel}`}
            value={`${stadiumConfig.capacity.toLocaleString('tr-TR')} koltuk`}
          />
          <SummaryPill
            icon={<BarChart3 className="h-4 w-4" />}
            label="Son 30 Gun Net"
            value={formatCurrency(totals.net)}
            tone={totals.net >= 0 ? 'emerald' : 'rose'}
          />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex flex-wrap gap-2">
            <TabsTrigger value="summary">Finans Ozeti</TabsTrigger>
            <TabsTrigger value="stadium">Stadyum</TabsTrigger>
            <TabsTrigger value="salaries">Maaslar</TabsTrigger>
            <TabsTrigger value="sponsors">Sponsorluklar</TabsTrigger>
            <TabsTrigger value="credits">Kredi Satin Al</TabsTrigger>
          </TabsList>

          <TabsContent value="summary">
            <SummaryTab
              totals={totals}
              history={history}
              chartData={chartData}
              averageMatchIncome={averageMatchIncome}
              dailyIncomeEstimate={dailyIncomeEstimate}
              expectedRevenue={expectedRevenue}
            />
          </TabsContent>

          <TabsContent value="stadium">
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

          <TabsContent value="salaries">
            <SalaryTab salaries={salaries} />
          </TabsContent>

          <TabsContent value="sponsors">
            <SponsorTab
              sponsors={userSponsors}
              onActivate={handleActivateSponsor}
              onCollect={handleCollectSponsor}
              loadingId={sponsorLoading}
            />
          </TabsContent>

          <TabsContent value="credits">
            <CreditTab packages={CREDIT_PACKAGES} loadingId={creditLoading} onPurchase={handleCreditPurchase} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function SummaryPill({
  icon,
  label,
  value,
  tone = 'cyan',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'emerald' | 'cyan' | 'rose';
}) {
  const tones: Record<'emerald' | 'cyan' | 'rose', string> = {
    emerald: 'bg-emerald-500/10 text-emerald-200 border-emerald-400/40',
    cyan: 'bg-cyan-500/10 text-cyan-200 border-cyan-400/40',
    rose: 'bg-rose-500/10 text-rose-200 border-rose-400/40',
  };
  return (
    <Card className={`border-white/10 ${tones[tone]}`}>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest">
          {icon}
          <span>{label}</span>
        </div>
        <p className="text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function SummaryTab({
  totals,
  history,
  chartData,
  averageMatchIncome,
  dailyIncomeEstimate,
  expectedRevenue,
}: {
  totals: { totalIncome: number; totalExpense: number; net: number; incomeTotals: Record<string, number>; expenseTotals: Record<string, number> };
  history: FinanceHistoryEntry[];
  chartData: { label: string; income: number; expense: number; net: number }[];
  averageMatchIncome: number;
  dailyIncomeEstimate: number;
  expectedRevenue: ExpectedRevenueBreakdown;
}) {
  const incomeCategories: { label: string; key: string }[] = [
    { label: 'Mac', key: 'match' },
    { label: 'Sponsor', key: 'sponsor' },
    { label: 'Kredi', key: 'loan' },
  ];
  const expenseCategories: { label: string; key: string }[] = [
    { label: 'Maas', key: 'salary' },
    { label: 'Stadyum', key: 'stadium' },
    { label: 'Transfer', key: 'transfer' },
  ];
  const hasChartData = chartData.some((item) => item.income > 0 || item.expense > 0);
  const tickInterval = chartData.length > 14 ? Math.ceil(chartData.length / 7) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white/90">
            <BarChart3 className="h-4 w-4 text-cyan-300" />
            Son 30 Gun Performansi
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SummaryBox label="Toplam Gelir" value={formatCurrency(totals.totalIncome)} tone="emerald" />
          <SummaryBox label="Toplam Gider" value={formatCurrency(totals.totalExpense)} tone="rose" />
          <SummaryBox label="Net Kar / Zarar" value={formatCurrency(totals.net)} tone={totals.net >= 0 ? 'emerald' : 'rose'} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryBox label="Ortalama Mac Geliri" value={formatCurrency(averageMatchIncome)} tone="emerald" />
            <SummaryBox label="Gunluk Tahmini Gelir" value={formatCurrency(dailyIncomeEstimate)} tone="cyan" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <BreakdownCard title="Gelir Dagilimi" data={incomeCategories.map(({ label, key }) => ({
              label,
              amount: totals.incomeTotals[key] ?? 0,
            }))} tone="emerald" />
            <BreakdownCard title="Gider Dagilimi" data={expenseCategories.map(({ label, key }) => ({
              label,
              amount: totals.expenseTotals[key] ?? 0,
            }))} tone="rose" />
          </div>
          <ExpectedRevenueCard revenue={expectedRevenue} />
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">30 Gunluk Gelir/Gider</p>
            </div>
            {hasChartData ? (
              <ChartContainer className="mt-4 h-56 w-full" config={SUMMARY_CHART_CONFIG}>
                <RechartsBarChart data={chartData} barGap={6}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.18)" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    interval={tickInterval}
                    tick={{ fontSize: 10, fill: 'rgba(226,232,240,0.75)' }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: 'rgba(148,163,184,0.75)' }}
                    tickFormatter={(value) => formatAxisValue(Number(value))}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => (
                          <span className="font-semibold text-white">{formatCurrency(Number(value))}</span>
                        )}
                      />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="income" fill="var(--color-income)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="expense" fill="var(--color-expense)" radius={[6, 6, 0, 0]} />
                </RechartsBarChart>
              </ChartContainer>
            ) : (
              <p className="mt-4 text-sm text-slate-500">Bu donemde kayit bulunmuyor.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="text-white/90">Islem Gecmisi</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[360px] pr-2">
            <div className="space-y-3">
              {history.length === 0 && <p className="text-sm text-slate-400">Kayit bulunmuyor.</p>}
              {history.map((entry) => (
                <HistoryRow key={entry.id} entry={entry} />
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryBox({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'rose' | 'cyan' }) {
  const toneClass =
    tone === 'emerald' ? 'text-emerald-300' : tone === 'rose' ? 'text-rose-300' : 'text-cyan-300';
  return (
    <div className="rounded-xl border border-white/10 p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`text-xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function BreakdownCard({
  title,
  data,
  tone,
}: {
  title: string;
  data: { label: string; amount: number }[];
  tone: 'emerald' | 'rose';
}) {
  const total = data.reduce((sum, item) => sum + item.amount, 0) || 1;
  const barTone = tone === 'emerald' ? 'bg-emerald-400/70' : 'bg-rose-400/70';
  return (
    <div className="rounded-xl border border-white/10 p-4">
      <p className="mb-3 text-sm text-slate-400">{title}</p>
      <div className="space-y-3">
        {data.map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between text-sm text-slate-300">
              <span>{item.label}</span>
              <span>{formatCurrency(item.amount)}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-white/10">
              <div className={`h-full rounded-full ${barTone}`} style={{ width: `${Math.min(100, (item.amount / total) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExpectedRevenueCard({ revenue }: { revenue: ExpectedRevenueBreakdown }) {
  return (
    <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-emerald-100">
      <p className="text-sm font-semibold uppercase tracking-wider text-emerald-200">Tahmini Aylik Gelir</p>
      <p className="mt-2 text-2xl font-semibold text-white">{formatCurrency(revenue.monthly)}</p>
      <div className="mt-3 space-y-2 text-xs text-emerald-100/80">
        <div className="flex items-center justify-between">
          <span>Mac Gelirleri (~{revenue.matchesPerMonth} mac)</span>
          <span className="font-semibold text-white">{formatCurrency(revenue.matchEstimate)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Sponsor Gelirleri</span>
          <span className="font-semibold text-white">{formatCurrency(revenue.sponsorEstimate)}</span>
        </div>
      </div>
    </div>
  );
}

function StadiumTab({
  level,
  config,
  nextConfig,
  balance,
  upgrading,
  onUpgrade,
  hasPermission,
}: {
  level: number;
  config: StadiumLevelConfig;
  nextConfig: StadiumLevelConfig;
  balance: number;
  upgrading: boolean;
  onUpgrade: () => void;
  hasPermission: boolean | null;
}) {
  const progress = (level / 5) * 100;
  const meetsCost = balance >= nextConfig.upgradeCost;
  const permissionGranted = hasPermission === true;
  const permissionPending = hasPermission === null;
  const canUpgrade = permissionGranted && level < 5 && meetsCost;
  const buttonLabel =
    level >= 5
      ? 'Maksimum seviyeye ulastin'
      : permissionPending
        ? 'Yetki kontrol ediliyor...'
        : !permissionGranted
          ? 'Yetki gerekli'
          : meetsCost
          ? 'Stadyumu Gelistir'
          : 'Bakiye yetersiz';
  return (
    <Card className="border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white/90">
          <Building2 className="h-4 w-4 text-emerald-300" />
          Stadyum Guncellemesi
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>Seviye {level}</span>
            <span>%{Math.round(progress)}</span>
          </div>
          <Progress value={progress} className="mt-2 h-2 bg-white/10" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <StadiumMetric label="Kapasite" value={`${config.capacity.toLocaleString('tr-TR')} koltuk`} />
          <StadiumMetric label="Mac Geliri" value={formatCurrency(config.matchIncome)} tone="emerald" />
          <StadiumMetric
            label="Sonraki Gelistirme"
            value={level >= 5 ? 'MAKS' : formatCurrency(nextConfig.upgradeCost)}
            tone="amber"
          />
        </div>
        <Button className="w-full" onClick={onUpgrade} disabled={level >= 5 || upgrading || !canUpgrade}>
          {upgrading ? <RefreshCcw className="mr-2 h-4 w-4 animate-spin" /> : null}
          {buttonLabel}
        </Button>
        {permissionPending && <p className="text-xs text-slate-400">Yetki durumu kontrol ediliyor...</p>}
        {!permissionPending && !permissionGranted && (
          <p className="text-xs text-amber-300">Stadyum guncellemesi icin takim sahibi olman gerekiyor.</p>
        )}
        {permissionGranted && level < 5 && !meetsCost && (
          <p className="text-xs text-rose-300">
            Sonraki seviye icin {formatCurrency(nextConfig.upgradeCost)} gerekiyor.
          </p>
        )}
        {level >= 5 && <p className="text-xs text-emerald-300">Stadyum maksimum seviyede.</p>}
      </CardContent>
    </Card>
  );
}

function StadiumMetric({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' }) {
  const toneClass =
    tone === 'emerald' ? 'text-emerald-300' : tone === 'amber' ? 'text-amber-300' : 'text-slate-100';
  return (
    <div className="rounded-xl border border-white/10 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function SalaryTab({ salaries }: { salaries: TeamSalariesDoc | null }) {
  return (
    <Card className="border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white/90">
          <Users className="h-4 w-4 text-cyan-300" />
          Otomatik Maas Dagilimi
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-400">
          Oyuncu maaslari overall puanlarina gore otomatik belirlenir ve ay sonunda bakiyeden dusulur.
        </p>
        <ScrollArea className="max-h-[360px] rounded-xl border border-white/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Oyuncu</TableHead>
                <TableHead>Mevki</TableHead>
                <TableHead>Overall</TableHead>
                <TableHead>Maas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {salaries?.players.map((record: TeamSalaryRecord) => (
                <TableRow key={record.playerId}>
                  <TableCell>{record.name}</TableCell>
                  <TableCell>{record.position}</TableCell>
                  <TableCell>{record.overall}</TableCell>
                  <TableCell>{formatCurrency(record.salary)}</TableCell>
                </TableRow>
              ))}
              {!salaries && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-slate-400">
                    Maas verisi henuz olusmadi.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
        <div className="rounded-xl border border-white/10 p-4">
          <p className="text-sm text-slate-400">Aylik toplam</p>
          <p className="text-2xl font-semibold text-emerald-300">{formatCurrency(salaries?.total ?? 0)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SponsorTab({
  sponsors,
  onActivate,
  onCollect,
  loadingId,
}: {
  sponsors: UserSponsorDoc[];
  onActivate: (entry: SponsorCatalogEntry) => void;
  onCollect: (id: string) => void;
  loadingId: string | null;
}) {
  const activeSponsor = sponsors.find((item) => item.active)?.id ?? null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white/90">
            <Coins className="h-4 w-4 text-amber-300" />
            Aktif Sponsorluklar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sponsors.length === 0 && <p className="text-sm text-slate-400">Aktif sponsor yok.</p>}
          {sponsors.map((sponsor) => (
            <div key={sponsor.id} className={`rounded-xl border p-3 ${sponsor.active ? 'border-emerald-400/50 bg-emerald-400/10' : 'border-white/10'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold">{sponsor.name}</p>
                  <p className="text-sm text-slate-400">
                    {sponsor.reward.cycle === 'daily' ? 'Gunluk' : 'Haftalik'} {formatCurrency(sponsor.reward.amount)}
                  </p>
                </div>
                <Badge variant="outline" className={sponsor.type === 'premium' ? 'text-amber-200' : 'text-emerald-200'}>
                  {sponsor.active ? 'Aktif' : sponsor.type}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Baslangic: {sponsor.activatedAt?.toDate?.().toLocaleDateString?.('tr-TR') ?? '-'}
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => onCollect(sponsor.id)}
                disabled={loadingId === sponsor.id}
              >
                {loadingId === sponsor.id && <RefreshCcw className="mr-1 h-4 w-4 animate-spin" />}
                Geliri Tahsil Et
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <SponsorCatalog activeSponsorId={activeSponsor} onActivate={onActivate} loadingId={loadingId} />
    </div>
  );
}

function CreditTab({
  packages,
  loadingId,
  onPurchase,
}: {
  packages: CreditPackage[];
  loadingId: string | null;
  onPurchase: (pack: CreditPackage) => void;
}) {
  return (
    <Card className="border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white/90">
          <CreditCard className="h-4 w-4 text-emerald-300" />
          Kredi Satin Al
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        {packages.map((pack) => (
          <div key={pack.id} className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <p className="text-lg font-semibold text-white">{formatCurrency(pack.amount)}</p>
            <p className="text-sm text-slate-400">Fiyat: ${pack.price.toFixed(2)}</p>
            <Button className="mt-3 w-full" onClick={() => onPurchase(pack)} disabled={loadingId === pack.id}>
              {loadingId === pack.id && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
              Satin Al
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function HistoryRow({ entry }: { entry: FinanceHistoryEntry }) {
  const tone = entry.type === 'income' ? 'text-emerald-300' : 'text-rose-300';
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <div>
        <p className="font-semibold capitalize">
          {entry.category}{' '}
          <span className="text-xs text-slate-400">({entry.type === 'income' ? 'gelir' : 'gider'})</span>
        </p>
        <p className="text-xs text-slate-400">{entry.timestamp.toDate().toLocaleString('tr-TR')}</p>
      </div>
      <span className={`font-semibold ${tone}`}>
        {entry.type === 'income' ? '+' : '-'}
        {formatCurrency(entry.amount)}
      </span>
    </div>
  );
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(value));

const formatAxisValue = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}M`;
  }
  if (abs >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return Math.round(value).toString();
};
