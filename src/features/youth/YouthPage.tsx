import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { toast } from 'sonner';
import {
  listenYouthCandidates,
  getYouthCandidates,
  createYouthCandidate,
  acceptYouthCandidate,
  releaseYouthCandidate,
  resetCooldownWithDiamonds,
  reduceCooldownWithAd,
  YouthCandidate,
  YOUTH_COOLDOWN_MS,
  YOUTH_AD_REDUCTION_MS,
  YOUTH_RESET_DIAMOND_COST,
} from '@/services/youth';
import { db } from '@/services/firebase';
import { generateRandomName } from '@/lib/names';
import { calculateOverall, getRoles } from '@/lib/player';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import YouthList from './YouthList';
import CooldownPanel from './CooldownPanel';
import type { Player } from '@/types';
import { BackButton } from '@/components/ui/back-button';
import { Sparkles, Clock, Users, Gauge, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const positions: Player['position'][] = ['GK','CB','LB','RB','CM','LM','RM','CAM','LW','RW','ST'];
const randomAttr = () => parseFloat(Math.random().toFixed(3));
const generatePlayer = (): Player => {
  const position = positions[Math.floor(Math.random() * positions.length)];
  const attributes = {
    strength: randomAttr(),
    acceleration: randomAttr(),
    topSpeed: randomAttr(),
    dribbleSpeed: randomAttr(),
    jump: randomAttr(),
    tackling: randomAttr(),
    ballKeeping: randomAttr(),
    passing: randomAttr(),
    longBall: randomAttr(),
    agility: randomAttr(),
    shooting: randomAttr(),
    shootPower: randomAttr(),
    positioning: randomAttr(),
    reaction: randomAttr(),
    ballControl: randomAttr(),
  } as Player['attributes'];
  const overall = calculateOverall(position, attributes);
  const potential = Math.min(1, overall + Math.random() * (1 - overall));
  return {
    id: crypto.randomUUID(),
    name: generateRandomName(),
    position,
    roles: getRoles(position),
    overall,
    potential,
    attributes,
    age: Math.floor(Math.random() * 5) + 16,
    height: 180,
    weight: 75,
    squadRole: 'youth',
  };
};

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  helper: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon: Icon, label, value, helper }) => (
  <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg backdrop-blur transition-transform duration-300 hover:-translate-y-1 hover:border-cyan-400/40">
    <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-emerald-500/20" />
    </div>
    <div className="relative flex items-start gap-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900/70 text-cyan-200 shadow-inner shadow-cyan-500/20">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/70">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
        <p className="mt-1 text-sm text-slate-300">{helper}</p>
      </div>
    </div>
  </div>
);

const YouthPage = () => {
  const { user } = useAuth();
  const { balance } = useDiamonds();
  const [candidates, setCandidates] = useState<YouthCandidate[]>([]);
  const [nextGenerateAt, setNextGenerateAt] = useState<Date | null>(null);
  const [canGenerate, setCanGenerate] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    getYouthCandidates(user.id).then(setCandidates).catch(console.warn);
    return listenYouthCandidates(user.id, setCandidates);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const ref = doc(db, 'users', user.id);
      return onSnapshot(ref, (snap) => {
        const data = snap.data() as { youth?: { nextGenerateAt?: { toDate: () => Date } } } | undefined;
        const ts = data?.youth?.nextGenerateAt;
        setNextGenerateAt(ts ? ts.toDate() : null);
      });
    } catch (err) {
      console.warn(err);
    }
  }, [user?.id]);

  useEffect(() => {
    const check = () => {
      if (!nextGenerateAt) {
        setCanGenerate(true);
        return;
      }
      setCanGenerate(nextGenerateAt.getTime() <= Date.now());
    };
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [nextGenerateAt]);

  const handleGenerate = async () => {
    if (!user?.id) return;
    try {
      const player = generatePlayer();
      const candidate = await createYouthCandidate(user.id, player);
      setCandidates((prev) => [candidate, ...prev]);
      setNextGenerateAt(new Date(Date.now() + YOUTH_COOLDOWN_MS));
      toast.success('Oyuncu üretildi');
    } catch (err) {
      console.warn(err);
      toast.error((err as Error).message || 'İşlem başarısız');
    }
  };

  const handleReset = async () => {
    if (!user?.id) return;
    try {
      await resetCooldownWithDiamonds(user.id);
      setNextGenerateAt(new Date());
      toast.success('Bekleme süresi kaldırıldı');
    } catch (err) {
      console.warn(err);
      toast.error('Elmas ile hızlandırma başarısız');
    }
  };

  const handleWatchAd = async () => {
    if (!user?.id) return;
    try {
      await reduceCooldownWithAd(user.id);
      setNextGenerateAt((prev) => {
        if (!prev) {
          return new Date();
        }
        const reduced = new Date(prev.getTime() - YOUTH_AD_REDUCTION_MS);
        const now = new Date();
        return reduced > now ? reduced : now;
      });
      toast.success('Reklam izlendi, süre 12 saat kısaldı');
    } catch (err) {
      console.warn(err);
      toast.error('Reklam izleme başarısız');
    }
  };

  const handleAccept = async (id: string) => {
    if (!user?.id) return;
    try {
      await acceptYouthCandidate(user.id, id);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      toast.success('Oyuncu takıma eklendi');
    } catch (err) {
      console.warn(err);
      toast.error('İşlem başarısız');
    }
  };

  const handleRelease = async (id: string) => {
    if (!user?.id) return;
    try {
      await releaseYouthCandidate(user.id, id);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      toast.success('Oyuncu serbest bırakıldı');
    } catch (err) {
      console.warn(err);
      toast.error('İşlem başarısız');
    }
  };

  if (!user) {
    return <div className="p-4">Giriş yapmalısın</div>;
  }

  const candidateCount = candidates.length;
  const averageOverall =
    candidateCount === 0
      ? 0
      : Math.round(
          (candidates.reduce((acc, curr) => acc + curr.player.overall, 0) / candidateCount) *
            100,
        );
  const topPotential =
    candidateCount === 0 ? 0 : Math.round(Math.max(...candidates.map((c) => c.player.potential)) * 100);
  const heroMessage =
    candidateCount > 0
      ? `Kadron için ${candidateCount} umut vadeden oyuncu seni bekliyor. En yüksek potansiyel ${topPotential}.`
      : 'İlk altyapı yeteneklerini keşfetmek için hemen üretim yap.';
  const nextGenerateTime = canGenerate
    ? 'Hazır'
    : nextGenerateAt
      ? nextGenerateAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
      : '—';
  const nextGenerateHelper = canGenerate
    ? 'Yeni aday hemen üretilebilir'
    : 'Planlanan üretim saati';

  const stats: StatCardProps[] = [
    {
      icon: Users,
      label: 'Aday Havuzu',
      value: candidateCount.toString(),
      helper: candidateCount > 0 ? 'Seçime hazır genç yetenek' : 'Henüz aday bulunmuyor',
    },
    {
      icon: Gauge,
      label: 'Ortalama Genel',
      value: candidateCount > 0 ? averageOverall.toString() : '—',
      helper: 'Performans puanı (100 üzerinden)',
    },
    {
      icon: Sparkles,
      label: 'En Yüksek Potansiyel',
      value: candidateCount > 0 ? topPotential.toString() : '—',
      helper:
        candidateCount > 0 ? 'Scout ekibinin gördüğü tavan' : 'Aday üretildiğinde görüntülenir',
    },
    {
      icon: Clock,
      label: 'Yeni Üretim',
      value: nextGenerateTime,
      helper: nextGenerateHelper,
    },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_65%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-32 top-24 h-96 w-96 rounded-full bg-emerald-500/15 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute right-[-18%] bottom-[-10%] h-[28rem] w-[28rem] rounded-full bg-cyan-500/15 blur-[140px]"
        aria-hidden
      />
      <div className="relative z-10 px-4 py-10 sm:px-6 lg:px-8">
        <div className="relative mx-auto max-w-7xl rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6 py-8 shadow-2xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.25),_transparent_60%)]" />
          <div className="pointer-events-none absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />
          <div className="pointer-events-none absolute right-[-10%] top-[-20%] h-72 w-72 rounded-full bg-cyan-500/25 blur-3xl" />
          <div className="relative space-y-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <BackButton />
                <div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan-200">
                    <Sparkles className="h-3.5 w-3.5" />
                    altyapı yönetimi
                  </span>
                  <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Altyapı Merkezi</h1>
                  <p className="mt-3 max-w-2xl text-sm text-slate-300 sm:text-base">{heroMessage}</p>
                </div>
              </div>
            </div>
            <Button
              onClick={handleGenerate}
              disabled={!canGenerate}
              data-testid="youth-generate"
              className="group relative overflow-hidden rounded-full border-0 bg-gradient-to-r from-cyan-500 via-emerald-500 to-teal-500 px-6 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-cyan-500/30 transition hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="relative flex items-center gap-2">
                <Sparkles className="h-5 w-5 transition-transform group-hover:rotate-6" />
                Oyuncu Üret
              </span>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">Oyuncu Havuzu</h2>
                  <p className="mt-1 text-sm text-slate-300">
                    Gelişime hazır genç yetenekleri filtrele ve doğru zamanda A takıma yükselt.
                  </p>
                </div>
                {candidateCount > 0 && (
                  <Badge
                    variant="outline"
                    className="w-fit border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-cyan-200"
                  >
                    {candidateCount} Aday
                  </Badge>
                )}
              </div>
              <div className="mt-6">
                <YouthList
                  candidates={candidates}
                  onAccept={handleAccept}
                  onRelease={handleRelease}
                  className="2xl:grid-cols-3"
                  emptyStateClassName="text-slate-300"
                />
              </div>
            </section>
            <aside className="space-y-6">
              <CooldownPanel
                nextGenerateAt={nextGenerateAt}
                onReset={handleReset}
                canReset={balance >= YOUTH_RESET_DIAMOND_COST && !canGenerate}
                onWatchAd={handleWatchAd}
                canWatchAd={!canGenerate}
              />
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur">
                <h3 className="text-lg font-semibold text-white">Scout Notları</h3>
                <ul className="mt-4 space-y-3 text-sm text-slate-300">
                  <li className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-4 w-4 text-cyan-300" />
                    <span>Yüksek potansiyelli oyuncuları hazırlık kampına erken dahil ederek gelişim patlaması yakala.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-4 w-4 text-cyan-300" />
                    <span>Reklam izleyerek bekleme süresini kısalt ve transfer dönemlerinde altyapını sıcak tut.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-4 w-4 text-cyan-300" />
                    <span>Elmasla beklemeyi sıfırlamak, kritik maçlardan önce kadroyu tazelemek için güçlü bir hamle.</span>
                  </li>
                </ul>
              </div>
            </aside>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default YouthPage;
