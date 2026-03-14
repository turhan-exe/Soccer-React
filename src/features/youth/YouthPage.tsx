import { useEffect, useState, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { useInventory } from '@/contexts/InventoryContext';
import { toast } from 'sonner';
import {
  listenYouthCandidates,
  getYouthCandidates,
  createYouthCandidate,
  acceptYouthCandidate,
  releaseYouthCandidate,
  YouthCandidate,
  YOUTH_COOLDOWN_MS,
  YOUTH_RESET_DIAMOND_COST,
  resetCooldownWithDiamonds,
} from '@/services/youth';
import { db } from '@/services/firebase';
import { generateRandomName } from '@/lib/names';
import { calculateOverall, getRoles, normalizeRatingTo100 } from '@/lib/player';
import type { Player } from '@/types';

import { YouthHeader } from './components/YouthHeader';
import { YouthDashboard } from './components/YouthDashboard';
import { YouthPlayerCard } from './components/YouthPlayerCard';
import { YouthPlayerDetails } from './components/YouthPlayerDetails';

const positions: Player['position'][] = ['GK', 'CB', 'LB', 'RB', 'CM', 'LM', 'RM', 'CAM', 'LW', 'RW', 'ST'];
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
    condition: 100,
    motivation: 100,
  };
};

const YouthPage = () => {
  const { user } = useAuth();
  const { balance } = useDiamonds();
  const { vipDurationMultiplier } = useInventory();
  const [candidates, setCandidates] = useState<YouthCandidate[]>([]);
  const [nextGenerateAt, setNextGenerateAt] = useState<Date | null>(null);
  const [canGenerate, setCanGenerate] = useState(false);
  const [countdown, setCountdown] = useState<string>('—');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const youthCooldownMs = Math.round(YOUTH_COOLDOWN_MS * vipDurationMultiplier);

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
    const updateState = () => {
      if (!nextGenerateAt) {
        setCanGenerate(true);
        setCountdown('Hazır');
        return;
      }

      const now = Date.now();
      const target = nextGenerateAt.getTime();
      const diff = target - now;

      if (diff <= 0) {
        setCanGenerate(true);
        setCountdown('Hazır');
      } else {
        setCanGenerate(false);
        const totalSeconds = Math.floor(diff / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
          setCountdown(`${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
        } else {
          setCountdown(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
        }
      }
    };

    updateState();
    const id = setInterval(updateState, 1000);
    return () => clearInterval(id);
  }, [nextGenerateAt]);

  const handleGenerate = async () => {
    if (!user?.id) return;
    try {
      const player = generatePlayer();
      const candidate = await createYouthCandidate(user.id, player, {
        durationMultiplier: vipDurationMultiplier,
      });
      setCandidates((prev) => [candidate, ...prev]);
      setNextGenerateAt(new Date(Date.now() + youthCooldownMs));
      toast.success('Oyuncu üretildi');
    } catch (err) {
      console.warn(err);
      toast.error((err as Error).message || 'İşlem başarısız');
    }
  };

  const handleReset = async () => {
    if (!user?.id) return;
    if (balance < YOUTH_RESET_DIAMOND_COST) {
      toast.error('Yetersiz elmas');
      return;
    }
    try {
      await resetCooldownWithDiamonds(user.id);
      setNextGenerateAt(new Date());
      toast.success('Süre sıfırlandı');
      // Optionally trigger generation automatically or let user click again
    } catch (err) {
      console.warn(err);
      toast.error('Elmas ile hızlandırma başarısız');
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
      : normalizeRatingTo100(
        candidates.reduce((acc, curr) => acc + curr.player.overall, 0) / candidateCount,
      );
  const topPotential =
    candidateCount === 0
      ? 0
      : normalizeRatingTo100(Math.max(...candidates.map((c) => c.player.potential)));

  return (
    <div className="relative min-h-screen bg-[#14151f] p-4 font-sans text-slate-100">
      <YouthHeader />

      <div className="max-w-7xl mx-auto">
        <YouthDashboard
          candidateCount={candidateCount}
          averageOverall={averageOverall}
          topPotential={topPotential}
          canGenerate={canGenerate}
          onGenerate={handleGenerate}
          onReset={handleReset}
          nextGenerateTime={countdown}
          diamondCost={YOUTH_RESET_DIAMOND_COST}
        />

        <section className="mb-8">
          <div className="mb-4 px-1">
            <h2 className="text-xl font-bold text-white">Oyuncu Havuzu</h2>
            <p className="text-sm text-slate-400">Gelişime hazır genç yetenekleri filtrele ve doğru zamanda A takıma yükselt.</p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {candidates.map((candidate) => (
              <YouthPlayerCard
                key={candidate.id}
                candidate={candidate}
                onAccept={handleAccept}
                onRelease={handleRelease}
                onViewDetails={(c) => setSelectedPlayer(c.player)}
              />
            ))}
            {candidates.length === 0 && (
              <div className="col-span-full py-12 text-center text-slate-500 bg-white/5 rounded-[32px] border border-dashed border-white/10">
                <p>Henüz aday bulunmuyor.</p>
                <p className="text-xs mt-1 opacity-60">"Yetenek Ara" butonunu kullanarak yeni yetenekler keşfedin.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <YouthPlayerDetails
        player={selectedPlayer}
        isOpen={!!selectedPlayer}
        onClose={() => setSelectedPlayer(null)}
      />
    </div>
  );
};

export default YouthPage;
