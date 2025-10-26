import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { Wallet, Building2, Users, BarChart3, Handshake, Coins, Shield, RefreshCcw } from 'lucide-react';
import { db } from '@/services/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { BackButton } from '@/components/ui/back-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  STADIUM_LEVELS,
  type StadiumState,
  type FinanceDoc,
  type FinanceHistoryEntry,
  type NegotiationSession,
  type SponsorCatalogEntry,
  type UserSponsorDoc,
  ensureFinanceProfile,
  upgradeStadiumLevel,
  calculateMonthlySalaries,
  getSalaryForOverall,
  createNegotiationSession,
  submitNegotiationOffer,
  cancelNegotiationSession,
  acceptNegotiationSession,
  createSponsorCatalogEntry,
  attachSponsorToUser,
  settleSponsorIncome,
} from '@/services/finance';
import type { Player, Position } from '@/types';
import { toast } from 'sonner';

const POSITIONS: Position[] = ['GK', 'CB', 'LB', 'RB', 'CM', 'LM', 'RM', 'CAM', 'LW', 'RW', 'ST'];
const DAYS_30 = 30 * 24 * 60 * 60 * 1000;

interface SponsorFormState {
  name: string;
  type: 'free' | 'premium';
  rewardAmount: string;
  cadence: 'daily' | 'weekly';
  price: string;
}

interface NegotiationFormState {
  playerName: string;
  position: Position;
  overall: number;
  transferFee: number;
}

export default function FinanceSummaryScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [activeTab, setActiveTab] = useState('summary');
  const [finance, setFinance] = useState<FinanceDoc | null>(null);
  const [stadium, setStadium] = useState<StadiumState | null>(null);
  const [history, setHistory] = useState<FinanceHistoryEntry[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [negotiations, setNegotiations] = useState<NegotiationSession[]>([]);
  const [catalog, setCatalog] = useState<SponsorCatalogEntry[]>([]);
  const [userSponsors, setUserSponsors] = useState<UserSponsorDoc[]>([]);
  const [negotiationForm, setNegotiationForm] = useState<NegotiationFormState>({
    playerName: '',
    position: 'ST',
    overall: 75,
    transferFee: 50_000,
  });
  const [sponsorForm, setSponsorForm] = useState<SponsorFormState>({
    name: '',
    type: 'free',
    rewardAmount: '1000',
    cadence: 'daily',
    price: '',
  });
  const [offerInputs, setOfferInputs] = useState<Record<string, string>>({});
  const [autoSalaryMonth, setAutoSalaryMonth] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [salaryLoading, setSalaryLoading] = useState(false);
  const [creatingNegotiation, setCreatingNegotiation] = useState(false);
  const [offerLoadingId, setOfferLoadingId] = useState<string | null>(null);
  const [cancelLoadingId, setCancelLoadingId] = useState<string | null>(null);
  const [acceptLoadingId, setAcceptLoadingId] = useState<string | null>(null);
  const [sponsorLoadingId, setSponsorLoadingId] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    void ensureFinanceProfile(user.id).catch((err) => console.warn('[Finance] ensure profile failed', err));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'finance', user.id), (snap) => {
      setFinance((snap.data() as FinanceDoc) ?? null);
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'stadium', user.id), (snap) => {
      setStadium((snap.data() as StadiumState) ?? { level: 1 });
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'finance_history', user.id), (snap) => {
      setHistory(((snap.data()?.entries as FinanceHistoryEntry[]) ?? []) || []);
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'teams', user.id), (snap) => {
      setPlayers(((snap.data()?.players as Player[]) ?? []) || []);
    });
  }, [user]);
  useEffect(() => {
    if (!user) return;
    const negotiationsCol = collection(db, 'transferNegotiations', user.id, 'sessions');
    return onSnapshot(negotiationsCol, (snap) => {
      setNegotiations(snap.docs.map((docSnap) => docSnap.data() as NegotiationSession));
    });
  }, [user]);

  useEffect(() => {
    const col = collection(db, 'sponsorship_catalog');
    return onSnapshot(col, (snap) => {
      setCatalog(snap.docs.map((docSnap) => docSnap.data() as SponsorCatalogEntry));
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    const col = collection(db, 'users', user.id, 'sponsorships');
    return onSnapshot(col, (snap) => {
      setUserSponsors(snap.docs.map((docSnap) => docSnap.data() as UserSponsorDoc));
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const currentMonthKey = new Date().toISOString().slice(0, 7);
    const lastRun = finance?.monthly_expense?.calculatedAt?.toDate();
    const lastRunKey = lastRun ? lastRun.toISOString().slice(0, 7) : null;
    if (lastRunKey === currentMonthKey) {
      setAutoSalaryMonth(currentMonthKey);
      return;
    }
    if (autoSalaryMonth === currentMonthKey) {
      return;
    }
    setAutoSalaryMonth(currentMonthKey);
    void calculateMonthlySalaries(user.id).catch((err) => {
      console.warn('[Finance] auto salary failed', err);
      toast.error(err instanceof Error ? err.message : 'Maaslar otomatik hesaplanamadi');
    });
  }, [finance?.monthly_expense?.calculatedAt, user, autoSalaryMonth]);

  if (!user) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 space-y-2">
            <h2 className="text-xl font-semibold">Giris yapmalisin</h2>
            <p className="text-slate-400">Finans ekranina erismek icin hesabina giris yap.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const balance = finance?.balance ?? 0;
  const stadiumLevel = stadium?.level ?? 1;
  const levelConfig = STADIUM_LEVELS[stadiumLevel as keyof typeof STADIUM_LEVELS];
  const nextLevelConfig = STADIUM_LEVELS[(stadiumLevel + 1) as keyof typeof STADIUM_LEVELS];

  const playersWithAutoSalary = useMemo(
    () =>
      players.map((player) => ({
        ...player,
        autoSalary: getSalaryForOverall(player.overall),
        actualSalary: player.contract?.salary ?? 0,
      })),
    [players],
  );
  const monthlyAutoTotal = playersWithAutoSalary.reduce((sum, player) => sum + player.autoSalary, 0);

  const sortedHistory = useMemo(() => {
    return [...history].sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());
  }, [history]);

  const last30Days = useMemo(() => {
    const cutoff = Date.now() - DAYS_30;
    return sortedHistory.filter((entry) => entry.timestamp.toMillis() >= cutoff);
  }, [sortedHistory]);

  const incomeTotal = last30Days.reduce((sum, entry) => (entry.type === 'income' ? sum + entry.amount : sum), 0);
  const expenseTotal = last30Days.reduce((sum, entry) => (entry.type === 'expense' ? sum + entry.amount : sum), 0);

  const incomeBreakdown = ['match', 'sponsor', 'loan', 'transfer'].map((category) => ({
    label: category,
    value: last30Days
      .filter((entry) => entry.type === 'income' && entry.category === category)
      .reduce((sum, item) => sum + item.amount, 0),
  }));

  const expenseBreakdown = ['salary', 'stadium', 'transfer'].map((category) => ({
    label: category,
    value: last30Days
      .filter((entry) => entry.type === 'expense' && entry.category === category)
      .reduce((sum, item) => sum + item.amount, 0),
  }));

  const handleUpgrade = async () => {
    if (!user) return;
    setUpgrading(true);
    try {
      await upgradeStadiumLevel(user.id);
      toast.success('Stadyum seviyesi yukseltili');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Stadyum yukseltilmedi');
    } finally {
      setUpgrading(false);
    }
  };

  const handleSalaryRun = async () => {
    if (!user) return;
    setSalaryLoading(true);
    try {
      await calculateMonthlySalaries(user.id);
      toast.success('Maaslar guncellendi');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Maaslar hesaplanamadi');
    } finally {
      setSalaryLoading(false);
    }
  };

  const handleCreateNegotiation = async () => {
    if (!user) return;
    if (!negotiationForm.playerName.trim()) {
      toast.error('Oyuncu adi gerekli');
      return;
    }
    setCreatingNegotiation(true);
    try {
      await createNegotiationSession(user.id, negotiationForm);
      toast.success('Pazarlik baslatildi');
      setNegotiationForm((prev) => ({ ...prev, playerName: '' }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pazarlik baslatilamadi');
    } finally {
      setCreatingNegotiation(false);
    }
  };
  const handleOffer = async (sessionId: string) => {
    if (!user) return;
    const value = Number(offerInputs[sessionId]);
    if (!value || value <= 0) {
      toast.error('Teklif tutari gecersiz');
      return;
    }
    setOfferLoadingId(sessionId);
    try {
      const result = await submitNegotiationOffer(user.id, sessionId, value);
      if (result === 'accepted') {
        toast.success('Oyuncu teklifi kabul etti');
      } else if (result === 'rejected') {
        toast.error('Oyuncu sabri tukendi');
      } else {
        toast('Teklif gonderildi');
      }
      setOfferInputs((prev) => ({ ...prev, [sessionId]: '' }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Teklif gonderilemedi');
    } finally {
      setOfferLoadingId(null);
    }
  };

  const handleCancelNegotiation = async (sessionId: string) => {
    if (!user) return;
    setCancelLoadingId(sessionId);
    try {
      await cancelNegotiationSession(user.id, sessionId);
      toast.success('Pazarlik iptal edildi');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pazarlik iptal edilemedi');
    } finally {
      setCancelLoadingId(null);
    }
  };

  const handleAcceptNegotiation = async (sessionId: string) => {
    if (!user) return;
    setAcceptLoadingId(sessionId);
    try {
      await acceptNegotiationSession(user.id, sessionId);
      toast.success('Oyuncu ile anlasildi');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Anlasma tamamlanamadi');
    } finally {
      setAcceptLoadingId(null);
    }
  };

  const handleSponsorCreate = async () => {
    if (!sponsorForm.name.trim()) {
      toast.error('Sponsor adi gerekli');
      return;
    }
    const reward = Number(sponsorForm.rewardAmount);
    if (!reward || reward <= 0) {
      toast.error('Getiri tutari gecersiz');
      return;
    }
    const priceValue = Number(sponsorForm.price) || 0;
    setCatalogLoading(true);
    try {
      await createSponsorCatalogEntry({
        name: sponsorForm.name,
        type: sponsorForm.type,
        reward: { amount: reward, cadence: sponsorForm.cadence },
        price: sponsorForm.type === 'premium' ? priceValue : undefined,
      });
      toast.success('Sponsor kataloga eklendi');
      setSponsorForm({ name: '', type: 'free', rewardAmount: '1000', cadence: 'daily', price: '' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sponsor eklenemedi');
    } finally {
      setCatalogLoading(false);
    }
  };

  const handleAttachSponsor = async (entry: SponsorCatalogEntry) => {
    if (!user) return;
    setSponsorLoadingId(entry.id);
    try {
      await attachSponsorToUser(user.id, entry);
      toast.success(`${entry.name} aktive edildi`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sponsorluk aktive edilemedi');
    } finally {
      setSponsorLoadingId(null);
    }
  };

  const handleSponsorIncome = async (sponsorId: string) => {
    if (!user) return;
    setSponsorLoadingId(sponsorId);
    try {
      const payout = await settleSponsorIncome(user.id, sponsorId);
      toast.success(`Sponsor geliri: ${formatCurrency(payout)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sponsor odemesi alinamadi');
    } finally {
      setSponsorLoadingId(null);
    }
  };
  return (
    <div className="min-h-screen bg-slate-950 text-white">
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
            Guncel bakiye: {formatCurrency(balance)}
          </Badge>
        </div>
      </header>

      <main className="p-4 space-y-4">
        <Card className="bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 border-white/10">
          <CardContent className="grid gap-4 p-6 sm:grid-cols-3">
            <SummaryPill icon={<Wallet className="h-4 w-4" />} label="Bakiye" value={formatCurrency(balance)} />
            <SummaryPill icon={<Building2 className="h-4 w-4" />} label={`Stadyum Seviye ${stadiumLevel}`} value={`${levelConfig.capacity.toLocaleString()} koltuk`} />
            <SummaryPill icon={<BarChart3 className="h-4 w-4" />} label="Son 30 Gun Net" value={formatCurrency(incomeTotal - expenseTotal)} tone={incomeTotal - expenseTotal >= 0 ? 'emerald' : 'rose'} />
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex flex-wrap gap-2">
            <TabsTrigger value="summary">Finans Ozeti</TabsTrigger>
            <TabsTrigger value="stadium">Stadyum</TabsTrigger>
            <TabsTrigger value="salaries">Maaslar</TabsTrigger>
            <TabsTrigger value="negotiations">Pazarlik</TabsTrigger>
            <TabsTrigger value="sponsors">Sponsorluk</TabsTrigger>
            {isAdmin && <TabsTrigger value="admin">Sponsor Admin</TabsTrigger>}
          </TabsList>
          <TabsContent value="summary">
            <SummaryTab incomeTotal={incomeTotal} expenseTotal={expenseTotal} history={last30Days} />
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <BreakdownCard title="Gelir Dagilimi" data={incomeBreakdown} tone="emerald" />
              <BreakdownCard title="Gider Dagilimi" data={expenseBreakdown} tone="rose" />
            </div>
          </TabsContent>

          <TabsContent value="stadium">
            <StadiumTab
              level={stadiumLevel}
              balance={balance}
              config={levelConfig}
              nextConfig={nextLevelConfig}
              upgrading={upgrading}
              onUpgrade={handleUpgrade}
            />
          </TabsContent>

          <TabsContent value="salaries">
            <SalaryTab players={playersWithAutoSalary} total={monthlyAutoTotal} loading={salaryLoading} onRun={handleSalaryRun} />
          </TabsContent>

          <TabsContent value="negotiations">
            <NegotiationTab
              form={negotiationForm}
              onChangeForm={setNegotiationForm}
              creating={creatingNegotiation}
              onCreate={handleCreateNegotiation}
              sessions={negotiations}
              offerInputs={offerInputs}
              onOfferChange={setOfferInputs}
              onSendOffer={handleOffer}
              onCancel={handleCancelNegotiation}
              onAccept={handleAcceptNegotiation}
              offerLoadingId={offerLoadingId}
              cancelLoadingId={cancelLoadingId}
              acceptLoadingId={acceptLoadingId}
            />
          </TabsContent>

          <TabsContent value="sponsors">
            <SponsorTab
              catalog={catalog}
              sponsors={userSponsors}
              onActivate={handleAttachSponsor}
              onSettle={handleSponsorIncome}
              loadingId={sponsorLoadingId}
            />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="admin">
              <AdminSponsorTab form={sponsorForm} onChange={setSponsorForm} onSubmit={handleSponsorCreate} loading={catalogLoading} />
            </TabsContent>
          )}
        </Tabs>

        <Card className="border-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white/90">
              <RefreshCcw className="h-4 w-4 text-emerald-300" />
              Gercek Zamanli Hareketler
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-80 pr-2">
              <div className="space-y-3">
                {sortedHistory.slice(0, 20).map((entry) => (
                  <HistoryRow key={entry.id} entry={entry} />
                ))}
                {sortedHistory.length === 0 && <p className="text-sm text-slate-400">Henuz finansal hareket yok.</p>}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
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
  icon: ReactNode;
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
    <div className={`rounded-xl border px-4 py-3 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 text-xl font-semibold">{value}</p>
    </div>
  );
}

function SummaryTab({
  incomeTotal,
  expenseTotal,
  history,
}: {
  incomeTotal: number;
  expenseTotal: number;
  history: FinanceHistoryEntry[];
}) {
  return (
    <Card className="border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white/90">
          <BarChart3 className="h-4 w-4 text-cyan-300" /> 30 Gunluk Finans Ozeti
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 p-4">
          <p className="text-sm text-slate-400">Toplam Gelir</p>
          <p className="text-2xl font-semibold text-emerald-300">{formatCurrency(incomeTotal)}</p>
          <p className="mt-4 text-sm text-slate-400">Toplam Gider</p>
          <p className="text-2xl font-semibold text-rose-300">{formatCurrency(expenseTotal)}</p>
          <div className="mt-4 rounded-lg bg-slate-900/60 p-3">
            <p className="text-sm text-slate-400">Net Kar / Zarar</p>
            <p className={`text-xl font-semibold ${incomeTotal - expenseTotal >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {formatCurrency(incomeTotal - expenseTotal)}
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 p-4">
          <p className="mb-3 text-sm text-slate-400">Son Islemler</p>
          <div className="space-y-3">
            {history.slice(0, 6).map((entry) => (
              <HistoryRow key={entry.id} entry={entry} />
            ))}
            {history.length === 0 && <p className="text-sm text-slate-400">Kayit bulunmuyor.</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
function BreakdownCard({
  title,
  data,
  tone,
}: {
  title: string;
  data: { label: string; value: number }[];
  tone: 'emerald' | 'rose';
}) {
  const barTone = tone === 'emerald' ? 'bg-emerald-400/70' : 'bg-rose-400/70';
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  return (
    <Card className="border-white/10">
      <CardHeader>
        <CardTitle className="text-white/90">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between text-sm text-slate-300">
              <span className="capitalize">{item.label}</span>
              <span>{formatCurrency(item.value)}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-white/10">
              <div className={`h-full rounded-full ${barTone}`} style={{ width: `${Math.min(100, (item.value / total) * 100)}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function StadiumTab({
  level,
  balance,
  config,
  nextConfig,
  upgrading,
  onUpgrade,
}: {
  level: number;
  balance: number;
  config: { capacity: number; matchIncome: number; upgradeCost: number };
  nextConfig?: { capacity: number; matchIncome: number; upgradeCost: number };
  upgrading: boolean;
  onUpgrade: () => void;
}) {
  const maxLevel = level >= 5;
  const canUpgrade = !!nextConfig && balance >= nextConfig.upgradeCost;
  const progress = (level / 5) * 100;
  return (
    <Card className="border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white/90">
          <Building2 className="h-4 w-4 text-emerald-300" /> Stadyum Gelistirme
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>Seviye {level}</span>
            <span>%{Math.round(progress)}</span>
          </div>
          <Progress value={progress} className="mt-1 h-2 bg-white/10" />
        </div>
        <div className="grid gap-4 rounded-xl border border-white/10 p-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-slate-400">Kapasite</p>
            <p className="text-xl font-semibold">{config.capacity.toLocaleString()} koltuk</p>
          </div>
          <div>
            <p className="text-sm text-slate-400">Mac Geliri</p>
            <p className="text-xl font-semibold text-emerald-300">{formatCurrency(config.matchIncome)}</p>
          </div>
          <div>
            <p className="text-sm text-slate-400">Sonraki Gelistirme</p>
            <p className="text-xl font-semibold text-amber-300">
              {maxLevel || !nextConfig ? 'MAKS' : formatCurrency(nextConfig.upgradeCost)}
            </p>
          </div>
        </div>
        <Button className="w-full" onClick={onUpgrade} disabled={maxLevel || !canUpgrade || upgrading}>
          {maxLevel ? 'Maksimum Seviye' : canUpgrade ? 'Stadyumu Gelistir' : 'Bakiye yetersiz'}
        </Button>
      </CardContent>
    </Card>
  );
}

function SalaryTab({
  players,
  total,
  loading,
  onRun,
}: {
  players: (Player & { autoSalary: number; actualSalary: number })[];
  total: number;
  loading: boolean;
  onRun: () => void;
}) {
  return (
    <Card className="border-white/10">
      <CardHeader className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <CardTitle className="flex items-center gap-2 text-white/90">
          <Users className="h-4 w-4 text-cyan-300" /> Oyuncu Maaslari
        </CardTitle>
        <Button onClick={onRun} disabled={loading}>
          {loading && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}Maaslari Hesapla
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-400">Maaslar oyuncularin overall degerine gore otomatik atanir.</p>
        <ScrollArea className="max-h-[420px] rounded-xl border border-white/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Oyuncu</TableHead>
                <TableHead>Overall</TableHead>
                <TableHead>Otomatik Maas</TableHead>
                <TableHead>Sozlesme</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {players.map((player) => (
                <TableRow key={player.id}>
                  <TableCell>{player.name}</TableCell>
                  <TableCell>{player.overall}</TableCell>
                  <TableCell>{formatCurrency(player.autoSalary)}</TableCell>
                  <TableCell>{player.actualSalary ? formatCurrency(player.actualSalary) : '-'}</TableCell>
                </TableRow>
              ))}
              {players.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-slate-400">
                    Takim oyunculari yuklenemedi.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
        <div className="rounded-xl border border-white/10 p-4">
          <p className="text-sm text-slate-400">Tahmini aylik maas gideri</p>
          <p className="text-2xl font-semibold text-emerald-300">{formatCurrency(total)}</p>
        </div>
      </CardContent>
    </Card>
  );
}
function NegotiationTab({
  form,
  onChangeForm,
  creating,
  onCreate,
  sessions,
  offerInputs,
  onOfferChange,
  onSendOffer,
  onCancel,
  onAccept,
  offerLoadingId,
  cancelLoadingId,
  acceptLoadingId,
}: {
  form: NegotiationFormState;
  onChangeForm: (next: NegotiationFormState) => void;
  creating: boolean;
  onCreate: () => void;
  sessions: NegotiationSession[];
  offerInputs: Record<string, string>;
  onOfferChange: Dispatch<SetStateAction<Record<string, string>>>;
  onSendOffer: (id: string) => void;
  onCancel: (id: string) => void;
  onAccept: (id: string) => void;
  offerLoadingId: string | null;
  cancelLoadingId: string | null;
  acceptLoadingId: string | null;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white/90">
            <Handshake className="h-4 w-4 text-emerald-300" /> Yeni Pazarlik
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Oyuncu adi" value={form.playerName} onChange={(e) => onChangeForm({ ...form, playerName: e.target.value })} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={form.position} onValueChange={(value: Position) => onChangeForm({ ...form, position: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Pozisyon" />
              </SelectTrigger>
              <SelectContent>
                {POSITIONS.map((pos) => (
                  <SelectItem key={pos} value={pos}>
                    {pos}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="number" min={40} max={99} value={form.overall} onChange={(e) => onChangeForm({ ...form, overall: Number(e.target.value) })} placeholder="Overall" />
          </div>
          <Input type="number" value={form.transferFee} onChange={(e) => onChangeForm({ ...form, transferFee: Number(e.target.value) })} placeholder="Transfer ucreti" />
          <Button onClick={onCreate} disabled={creating}>
            {creating && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}Pazarligi Baslat
          </Button>
        </CardContent>
      </Card>
      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white/90">
            <Handshake className="h-4 w-4 text-cyan-300" /> Aktif Pazarliklar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sessions.length === 0 && <p className="text-sm text-slate-400">Aktif pazarlik yok.</p>}
          {sessions
            .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
            .map((session) => {
              const patiencePercent = (session.patience / session.maxPatience) * 100;
              return (
                <div key={session.id} className="rounded-xl border border-white/10 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-semibold">{session.playerName}</p>
                      <p className="text-sm text-slate-400">
                        {session.position} - Overall {session.overall} - Istek {formatCurrency(session.askingSalary)}
                      </p>
                    </div>
                    <Badge variant="outline" className={statusTone(session.status)}>
                      {session.status}
                    </Badge>
                  </div>
                  <div className="mt-3 text-sm text-slate-400">Sabir durumu</div>
                  <Progress value={patiencePercent} className="mt-1 h-2 bg-white/10" />
                  {session.status === 'pending' && (
                    <div className="mt-3 space-y-2">
                      <Input
                        type="number"
                        placeholder="Teklif tutari"
                        value={offerInputs[session.id] ?? ''}
                        onChange={(e) => onOfferChange((prev) => ({ ...prev, [session.id]: e.target.value }))}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => onSendOffer(session.id)} disabled={offerLoadingId === session.id}>
                          {offerLoadingId === session.id && <RefreshCcw className="mr-1 h-4 w-4 animate-spin" />}Teklif Gonder
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => onAccept(session.id)} disabled={acceptLoadingId === session.id}>
                          {acceptLoadingId === session.id && <RefreshCcw className="mr-1 h-4 w-4 animate-spin" />}Son Teklifi Kabul Et
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => onCancel(session.id)} disabled={cancelLoadingId === session.id}>
                          Iptal Et
                        </Button>
                      </div>
                    </div>
                  )}
                  {session.offers?.length > 0 && (
                    <div className="mt-3 rounded-lg bg-white/5 p-3 text-sm">
                      <p className="mb-1 text-slate-300">Teklif gecmisi</p>
                      <div className="space-y-1">
                        {session.offers.map((offer) => (
                          <div key={offer.id} className="flex items-center justify-between text-slate-400">
                            <span>{formatCurrency(offer.amount)}</span>
                            <span>{offer.accepted ? 'Kabul' : 'Red'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </CardContent>
      </Card>
    </div>
  );
}
function SponsorTab({
  catalog,
  sponsors,
  onActivate,
  onSettle,
  loadingId,
}: {
  catalog: SponsorCatalogEntry[];
  sponsors: UserSponsorDoc[];
  onActivate: (entry: SponsorCatalogEntry) => void;
  onSettle: (id: string) => void;
  loadingId: string | null;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white/90">
            <Coins className="h-4 w-4 text-amber-300" /> Aktif Sponsorluklar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sponsors.length === 0 && <p className="text-sm text-slate-400">Aktif sponsor yok.</p>}
          {sponsors.map((sponsor) => (
            <div key={sponsor.id} className="rounded-xl border border-white/10 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold">{sponsor.name}</p>
                  <p className="text-sm text-slate-400">
                    {sponsor.reward.cadence === 'daily' ? 'Gunluk' : 'Haftalik'} {formatCurrency(sponsor.reward.amount)}
                  </p>
                </div>
                <Badge variant="outline" className={sponsor.type === 'premium' ? 'text-amber-200' : 'text-emerald-200'}>
                  {sponsor.type}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-slate-500">Baslangic: {sponsor.startDate.toDate().toLocaleDateString('tr-TR')}</p>
              <Button size="sm" className="mt-3" onClick={() => onSettle(sponsor.id)} disabled={loadingId === sponsor.id}>
                {loadingId === sponsor.id && <RefreshCcw className="mr-1 h-4 w-4 animate-spin" />}Geliri Tahsil Et
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white/90">
            <Shield className="h-4 w-4 text-emerald-300" /> Sponsor Katalogu
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {catalog.length === 0 && <p className="text-sm text-slate-400">Katalog bos.</p>}
          {catalog.map((entry) => (
            <div key={entry.id} className="rounded-xl border border-white/10 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold">{entry.name}</p>
                  <p className="text-sm text-slate-400">
                    {entry.reward.cadence === 'daily' ? 'Gunluk' : 'Haftalik'} {formatCurrency(entry.reward.amount)}
                  </p>
                  {entry.type === 'premium' && <p className="text-xs text-amber-300">Ucret: {formatCurrency(entry.price ?? 0)}</p>}
                </div>
                <Button size="sm" onClick={() => onActivate(entry)} disabled={loadingId === entry.id}>
                  {loadingId === entry.id && <RefreshCcw className="mr-1 h-4 w-4 animate-spin" />}Aktive Et
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function AdminSponsorTab({
  form,
  onChange,
  onSubmit,
  loading,
}: {
  form: SponsorFormState;
  onChange: (next: SponsorFormState) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  return (
    <Card className="border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white/90">
          <Shield className="h-4 w-4 text-cyan-300" /> Sponsor Katalogu Yonetimi
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input placeholder="Sponsor adi" value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} />
        <Select value={form.type} onValueChange={(value: 'free' | 'premium') => onChange({ ...form, type: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Tip" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="free">Ucretsiz</SelectItem>
            <SelectItem value="premium">Premium</SelectItem>
          </SelectContent>
        </Select>
        <Input type="number" placeholder="Getiri" value={form.rewardAmount} onChange={(e) => onChange({ ...form, rewardAmount: e.target.value })} />
        <Select value={form.cadence} onValueChange={(value: 'daily' | 'weekly') => onChange({ ...form, cadence: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Periyot" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Gunluk</SelectItem>
            <SelectItem value="weekly">Haftalik</SelectItem>
          </SelectContent>
        </Select>
        {form.type === 'premium' && (
          <Input type="number" placeholder="Ucret" value={form.price} onChange={(e) => onChange({ ...form, price: e.target.value })} />
        )}
        <Button onClick={onSubmit} disabled={loading}>
          {loading && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}Sponsor Ekle
        </Button>
      </CardContent>
    </Card>
  );
}
function HistoryRow({ entry }: { entry: FinanceHistoryEntry }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 p-3 text-sm">
      <div>
        <p className="font-semibold capitalize">{entry.category}</p>
        <p className="text-xs text-slate-400">{entry.timestamp.toDate().toLocaleString('tr-TR')}</p>
      </div>
      <div className={`font-semibold ${entry.type === 'income' ? 'text-emerald-300' : 'text-rose-300'}`}>
        {entry.type === 'income' ? '+' : '-'}{formatCurrency(entry.amount)}
      </div>
    </div>
  );
}

const statusTone = (status: NegotiationSession['status']) => {
  if (status === 'pending') return 'text-amber-200 border-amber-300/40';
  if (status === 'signed' || status === 'accepted') return 'text-emerald-200 border-emerald-300/40';
  if (status === 'rejected' || status === 'cancelled') return 'text-rose-200 border-rose-300/40';
  return 'text-slate-200 border-slate-300/40';
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(value));
