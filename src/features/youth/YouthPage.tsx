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
  YouthCandidate,
  YOUTH_COOLDOWN_MS,
} from '@/services/youth';
import { db } from '@/services/firebase';
import { generateRandomName } from '@/lib/names';
import { calculateOverall, getRoles } from '@/lib/player';
import { Button } from '@/components/ui/button';
import YouthList from './YouthList';
import CooldownPanel from './CooldownPanel';
import type { Player } from '@/types';
import { BackButton } from '@/components/ui/back-button';

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
    } catch (err) {
      console.warn(err);
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

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BackButton />
          <h1 className="text-2xl font-bold">Altyapı</h1>
        </div>
        <Button onClick={handleGenerate} disabled={!canGenerate} data-testid="youth-generate">
          Oyuncu Üret
        </Button>
      </div>
      <CooldownPanel
        nextGenerateAt={nextGenerateAt}
        onReset={handleReset}
        canReset={balance >= 100}
      />
      <YouthList
        candidates={candidates}
        onAccept={handleAccept}
        onRelease={handleRelease}
      />
    </div>
  );
};

export default YouthPage;
