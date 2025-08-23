import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  listenYouthCandidates,
  createYouthCandidate,
  acceptYouthCandidate,
  releaseYouthCandidate,
  YouthCandidate,
} from '@/services/youth';
import { generateRandomName } from '@/lib/names';
import { Button } from '@/components/ui/button';
import YouthList from './YouthList';
import type { Player } from '@/types';

const positions: Player['position'][] = ['GK','CB','LB','RB','CM','LM','RM','CAM','LW','RW','ST'];
const randomAttr = () => parseFloat(Math.random().toFixed(3));
const generatePlayer = (): Player => ({
  id: crypto.randomUUID(),
  name: generateRandomName(),
  position: positions[Math.floor(Math.random() * positions.length)],
  overall: randomAttr(),
  attributes: {
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
  },
  age: Math.floor(Math.random() * 5) + 16,
  height: 180,
  weight: 75,
  squadRole: 'youth',
});

const YouthPage = () => {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<YouthCandidate[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    return listenYouthCandidates(user.id, setCandidates);
  }, [user?.id]);

  const handleGenerate = async () => {
    if (!user?.id) return;
    try {
      const player = generatePlayer();
      await createYouthCandidate(user.id, player);
      toast.success('Oyuncu üretildi');
    } catch (err) {
      console.warn(err);
      toast.error('İşlem başarısız');
    }
  };

  const handleAccept = async (id: string) => {
    if (!user?.id) return;
    try {
      await acceptYouthCandidate(user.id, id);
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
        <h1 className="text-2xl font-bold">Altyapı</h1>
        <Button onClick={handleGenerate} data-testid="youth-generate">
          Oyuncu Üret
        </Button>
      </div>
      <YouthList
        candidates={candidates}
        onAccept={handleAccept}
        onRelease={handleRelease}
      />
    </div>
  );
};

export default YouthPage;
