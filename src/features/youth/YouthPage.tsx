import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore';
import { toast } from 'sonner';

import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { useInventory } from '@/contexts/InventoryContext';
import { db } from '@/services/firebase';
import {
  acceptYouthCandidate,
  createYouthCandidate,
  getYouthCandidates,
  listenYouthCandidates,
  releaseYouthCandidate,
  resetCooldownWithDiamonds,
  YOUTH_AD_REDUCTION_PERCENT,
  YOUTH_COOLDOWN_MS,
  YOUTH_RESET_DIAMOND_COST,
  type YouthCandidate,
} from '@/services/youth';
import {
  getRewardedAdFailureMessage,
  runRewardedAdFlow,
} from '@/services/rewardedAds';
import { generateRandomName } from '@/lib/names';
import { calculateOverall, getRoles, normalizeRatingTo100 } from '@/lib/player';
import type { Player } from '@/types';

import { YouthDashboard } from './components/YouthDashboard';
import { YouthHeader } from './components/YouthHeader';
import { YouthPlayerCard } from './components/YouthPlayerCard';
import { YouthPlayerDetails } from './components/YouthPlayerDetails';

const positions: Player['position'][] = ['GK', 'CB', 'LB', 'RB', 'CM', 'LM', 'RM', 'CAM', 'LW', 'RW', 'ST'];

const randomAttr = () => parseFloat(Math.random().toFixed(3));

const getRewardedTimestampMs = (reward: Record<string, unknown>): number | null => {
  const raw = reward.nextGenerateAtMs;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
};

const getRewardedReductionMs = (reward: Record<string, unknown>): number | null => {
  const raw = reward.reductionMs;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
};

const formatRewardDuration = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours} sa ${minutes} dk`;
  }

  if (minutes > 0) {
    return `${minutes} dk`;
  }

  return `${Math.max(1, seconds)} sn`;
};

const upsertYouthCandidate = (
  current: YouthCandidate[],
  candidate: YouthCandidate,
): YouthCandidate[] => [
  candidate,
  ...current.filter(existing => existing.id !== candidate.id),
];

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
    health: 1,
    condition: 1,
    motivation: 1,
  };
};

const YouthPage = () => {
  const { user } = useAuth();
  const { balance } = useDiamonds();
  const { vipDurationMultiplier } = useInventory();
  const [candidates, setCandidates] = useState<YouthCandidate[]>([]);
  const [nextGenerateAt, setNextGenerateAt] = useState<Date | null>(null);
  const [canGenerate, setCanGenerate] = useState(false);
  const [countdown, setCountdown] = useState<string>('-');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [isWatchingAd, setIsWatchingAd] = useState(false);
  const optimisticRewardedNextGenerateAtMsRef = useRef<number | null>(null);
  const optimisticRewardedExpiryMsRef = useRef<number>(0);
  const youthCooldownMs = Math.round(YOUTH_COOLDOWN_MS * vipDurationMultiplier);

  useEffect(() => {
    if (!user?.id) return;
    void getYouthCandidates(user.id).then(setCandidates).catch(console.warn);
    return listenYouthCandidates(user.id, setCandidates);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const ref = doc(db, 'users', user.id);
      return onSnapshot(ref, snap => {
        const data = snap.data() as { youth?: { nextGenerateAt?: { toDate: () => Date } } } | undefined;
        const timestamp = data?.youth?.nextGenerateAt;
        const nextGenerateAtMs = timestamp ? timestamp.toDate().getTime() : null;
        const optimisticMs = optimisticRewardedNextGenerateAtMsRef.current;
        const optimisticStillActive =
          optimisticMs !== null && Date.now() < optimisticRewardedExpiryMsRef.current;

        if (
          optimisticStillActive
          && nextGenerateAtMs !== null
          && nextGenerateAtMs > optimisticMs
        ) {
          return;
        }

        if (
          optimisticMs !== null
          && (
            nextGenerateAtMs === null
            || nextGenerateAtMs <= optimisticMs
            || !optimisticStillActive
          )
        ) {
          optimisticRewardedNextGenerateAtMsRef.current = null;
          optimisticRewardedExpiryMsRef.current = 0;
        }

        setNextGenerateAt(nextGenerateAtMs === null ? null : new Date(nextGenerateAtMs));
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

      const diff = nextGenerateAt.getTime() - Date.now();
      if (diff <= 0) {
        setCanGenerate(true);
        setCountdown('Hazır');
        return;
      }

      setCanGenerate(false);
      const totalSeconds = Math.floor(diff / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        setCountdown(
          `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
        );
        return;
      }

      setCountdown(
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
      );
    };

    updateState();
    const intervalId = setInterval(updateState, 1000);
    return () => clearInterval(intervalId);
  }, [nextGenerateAt]);

  const handleGenerate = async () => {
    if (!user?.id) return;
    try {
      const player = generatePlayer();
      const candidate = await createYouthCandidate(user.id, player, {
        durationMultiplier: vipDurationMultiplier,
      });
      setCandidates(prev => upsertYouthCandidate(prev, candidate));
      setNextGenerateAt(new Date(Date.now() + youthCooldownMs));
      toast.success('Altyapı adayı oluşturuldu');
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
    } catch (err) {
      console.warn(err);
      toast.error('Elmas ile hızlandırma başarısız');
    }
  };

  const handleWatchAd = useCallback(async () => {
    if (!user?.id || canGenerate || isWatchingAd) {
      return;
    }

    setIsWatchingAd(true);
    try {
      const result = await runRewardedAdFlow({
        userId: user.id,
        placement: 'youth_cooldown',
        context: {
          surface: 'youth',
        },
      });

      if (result.outcome === 'claimed' || result.outcome === 'already_claimed') {
        const nextGenerateAtMs = getRewardedTimestampMs(result.claim.reward);
        const reductionMs = getRewardedReductionMs(result.claim.reward);
        if (nextGenerateAtMs !== null) {
          optimisticRewardedNextGenerateAtMsRef.current = nextGenerateAtMs;
          optimisticRewardedExpiryMsRef.current = Date.now() + 30_000;
          setNextGenerateAt(new Date(nextGenerateAtMs));
        }

        try {
          const latestUserSnap = await getDocFromServer(doc(db, 'users', user.id));
          const latestTimestamp = latestUserSnap.get('youth.nextGenerateAt');
          const latestNextGenerateAtMs =
            typeof latestTimestamp?.toDate === 'function'
              ? latestTimestamp.toDate().getTime()
              : null;
          if (latestNextGenerateAtMs !== null) {
            optimisticRewardedNextGenerateAtMsRef.current = null;
            optimisticRewardedExpiryMsRef.current = 0;
            setNextGenerateAt(new Date(latestNextGenerateAtMs));
          }
        } catch (error) {
          console.warn('[YouthPage] failed to refresh youth cooldown after rewarded claim', error);
        }

        toast.success(
          reductionMs && reductionMs > 0
            ? `Kalan süre ${formatRewardDuration(reductionMs)} azaltıldı`
            : 'Kalan süre %15 azaltıldı',
        );
        return;
      }

      if (result.outcome === 'dismissed') {
        toast.info('Reklam tamamlanmadı.');
        return;
      }

      if (result.outcome === 'pending_verification') {
        toast.info('Reklam doğrulanıyor. Biraz sonra tekrar deneyin.');
        return;
      }

      toast.error(getRewardedAdFailureMessage(result.ad));
    } catch (err) {
      console.warn(err);
      toast.error(getRewardedAdFailureMessage(err));
    } finally {
      setIsWatchingAd(false);
    }
  }, [canGenerate, isWatchingAd, user?.id]);

  const handleAccept = async (id: string) => {
    if (!user?.id) return;
    try {
      await acceptYouthCandidate(user.id, id);
      setCandidates(prev => prev.filter(candidate => candidate.id !== id));
      toast.success('Oyuncu A takıma eklendi');
    } catch (err) {
      console.warn(err);
      toast.error('İşlem başarısız');
    }
  };

  const handleRelease = async (id: string) => {
    if (!user?.id) return;
    try {
      await releaseYouthCandidate(user.id, id);
      setCandidates(prev => prev.filter(candidate => candidate.id !== id));
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
        candidates.reduce((accumulator, candidate) => accumulator + candidate.player.overall, 0) / candidateCount,
      );
  const topPotential =
    candidateCount === 0
      ? 0
      : normalizeRatingTo100(Math.max(...candidates.map(candidate => candidate.player.potential)));

  return (
    <div className="relative min-h-screen bg-[#14151f] p-4 font-sans text-slate-100">
      <YouthHeader />

      <div className="mx-auto max-w-7xl">
        <YouthDashboard
          candidateCount={candidateCount}
          averageOverall={averageOverall}
          topPotential={topPotential}
          canGenerate={canGenerate}
          onGenerate={handleGenerate}
          onReset={handleReset}
          onWatchAd={handleWatchAd}
          canWatchAd={!canGenerate && !isWatchingAd}
          isWatchingAd={isWatchingAd}
          nextGenerateTime={countdown}
          diamondCost={YOUTH_RESET_DIAMOND_COST}
          adReductionPercent={Math.round(YOUTH_AD_REDUCTION_PERCENT * 100)}
        />

        <section className="mb-8">
          <div className="mb-4 px-1">
            <h2 className="text-xl font-bold text-white">Oyuncu Havuzu</h2>
            <p className="text-sm text-slate-400">
              Gelişime hazır genç yetenekleri filtrele ve doğru zamanda A takıma yükselt.
            </p>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-6">
            {candidates.map(candidate => (
              <YouthPlayerCard
                key={candidate.id}
                candidate={candidate}
                onAccept={handleAccept}
                onRelease={handleRelease}
                onViewDetails={current => setSelectedPlayer(current.player)}
              />
            ))}
            {candidates.length === 0 && (
              <div className="col-span-full rounded-[32px] border border-dashed border-white/10 bg-white/5 py-12 text-center text-slate-500">
                <p>Henüz aday bulunmuyor.</p>
                <p className="mt-1 text-xs opacity-60">
                  "Yetenek Ara" butonunu kullanarak yeni yetenekler keşfedin.
                </p>
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
