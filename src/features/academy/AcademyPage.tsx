import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/services/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import {
  listenPendingCandidates,
  pullNewCandidate,
  resetCooldownWithDiamonds,
  acceptCandidate,
  releaseCandidate,
  AcademyCandidate,
} from '@/services/academy';
import CooldownPanel from './CooldownPanel';
import CandidatesList from './CandidatesList';

const AcademyPage = () => {
  const { user } = useAuth();
  const { balance } = useDiamonds();
  const [nextPullAt, setNextPullAt] = useState<Date | null>(null);
  const [candidates, setCandidates] = useState<AcademyCandidate[]>([]);

  useEffect(() => {
    if (!user) return;
    const ref = doc(db, 'users', user.id);
    return onSnapshot(ref, (snap) => {
      const data = snap.data() as { academy?: { nextPullAt?: { toDate: () => Date } } } | undefined;
      const ts = data?.academy?.nextPullAt;
      setNextPullAt(ts ? ts.toDate() : null);
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return listenPendingCandidates(user.id, setCandidates);
  }, [user]);

  const handlePull = async () => {
    if (!user) return;
    await pullNewCandidate(user.id);
  };

  const handleReset = async () => {
    if (!user) return;
    await resetCooldownWithDiamonds(user.id);
  };

  const handleAccept = async (id: string) => {
    if (!user) return;
    await acceptCandidate(user.id, id);
  };

  const handleRelease = async (id: string) => {
    if (!user) return;
    await releaseCandidate(user.id, id);
  };

  if (!user) {
    return <div className="p-4">Giriş yapmalısın</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Altyapı</h1>
        <p className="text-muted-foreground">Yeni oyuncu adaylarını keşfet.</p>
      </div>
      <CooldownPanel
        nextPullAt={nextPullAt}
        onPull={handlePull}
        onReset={handleReset}
        canReset={balance >= 100}
      />
      <CandidatesList
        candidates={candidates}
        onAccept={handleAccept}
        onRelease={handleRelease}
      />
    </div>
  );
};

export default AcademyPage;
