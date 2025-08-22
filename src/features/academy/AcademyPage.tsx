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
  ACADEMY_COOLDOWN_MS,
} from '@/services/academy';
import CooldownPanel from './CooldownPanel';
import CandidatesList from './CandidatesList';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const STORAGE_KEY = 'academyCandidates';
const NEXT_PULL_KEY = 'academyNextPullAt';

const AcademyPage = () => {
  const { user } = useAuth();
  const { balance } = useDiamonds();
  const [nextPullAt, setNextPullAt] = useState<Date | null>(null);
  const [candidates, setCandidates] = useState<AcademyCandidate[]>([]);
  const [canPull, setCanPull] = useState(false);

  // Load stored candidates and cooldown on first render
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed: AcademyCandidate[] = JSON.parse(stored);
        setCandidates(parsed);
      } catch (err) {
        console.warn(err);
      }
    }
    const storedNext = localStorage.getItem(NEXT_PULL_KEY);
    if (storedNext) {
      const ts = parseInt(storedNext, 10);
      if (!isNaN(ts)) {
        setNextPullAt(new Date(ts));
      }
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    try {
      const ref = doc(db, 'users', user.id);
      return onSnapshot(ref, (snap) => {
        const data = snap.data() as { academy?: { nextPullAt?: { toDate: () => Date } } } | undefined;
        const ts = data?.academy?.nextPullAt;
        setNextPullAt(ts ? ts.toDate() : null);
      });
    } catch (err) {
      console.warn(err);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    try {
      return listenPendingCandidates(user.id, setCandidates);
    } catch (err) {
      console.warn(err);
    }
  }, [user]);

  // Persist candidates and next pull time to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(candidates));
  }, [candidates]);

  useEffect(() => {
    if (nextPullAt) {
      localStorage.setItem(NEXT_PULL_KEY, nextPullAt.getTime().toString());
    } else {
      localStorage.removeItem(NEXT_PULL_KEY);
    }
  }, [nextPullAt]);

  useEffect(() => {
    const check = () => {
      if (!nextPullAt) {
        setCanPull(true);
        return;
      }
      setCanPull(nextPullAt.getTime() <= Date.now());
    };
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [nextPullAt]);

  const handlePull = async () => {
    if (!user) return;
    try {
      const candidate = await pullNewCandidate(user.id);
      // optimistically show the new candidate before Firestore listener updates
      setCandidates((prev) => [candidate, ...prev]);
      setNextPullAt(new Date(Date.now() + ACADEMY_COOLDOWN_MS));
    } catch (err) {
      console.warn(err);
    }
  };

  const handleReset = async () => {
    if (!user) return;
    try {
      await resetCooldownWithDiamonds(user.id);
    } catch (err) {
      console.warn(err);
    }
  };

  const handleAccept = async (id: string) => {
    if (!user) return;
    try {
      await acceptCandidate(user.id, id);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.warn(err);
    }
  };

  const handleRelease = async (id: string) => {
    if (!user) return;
    try {
      await releaseCandidate(user.id, id);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.warn(err);
    }
  };

  if (!user) {
    return <div className="p-4">Giriş yapmalısın</div>;
  }
  const youthCount = candidates.length;
  const talentedCount = candidates.filter(
    (c) => c.player.potential >= 0.8,
  ).length;
  const avgAge = youthCount
    ? Math.round(
        candidates.reduce((sum, c) => sum + c.player.age, 0) / youthCount,
      )
    : 0;

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Altyapı</h1>
        <Button onClick={handlePull} disabled={!canPull} data-testid="academy-pull">
          Oyuncu Üret
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{youthCount}</div>
            <p className="text-sm text-muted-foreground">Genç Oyuncu</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{talentedCount}</div>
            <p className="text-sm text-muted-foreground">Yetenekli</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{avgAge}</div>
            <p className="text-sm text-muted-foreground">Ort. Yaş</p>
          </CardContent>
        </Card>
      </div>
      <CooldownPanel
        nextPullAt={nextPullAt}
        onReset={handleReset}
        canReset={balance >= 100}
      />
      <h2 className="text-xl font-semibold">Genç Oyuncular</h2>
      <CandidatesList
        candidates={candidates}
        onAccept={handleAccept}
        onRelease={handleRelease}
      />
    </div>
  );
};

export default AcademyPage;
