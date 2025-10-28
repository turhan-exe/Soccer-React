import { useEffect, useMemo, useState } from 'react';
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
import { BackButton } from '@/components/ui/back-button';
import { NegotiationDialog, type NegotiationContext } from '@/features/negotiation/NegotiationDialog';
import { finalizeNegotiationAttempt, recordTransferHistory, type NegotiationAttempt } from '@/services/negotiation';
import { normalizeRatingTo100 } from '@/lib/player';
import { syncTeamSalaries, ensureMonthlySalaryCharge } from '@/services/finance';
import { toast } from 'sonner';

const STORAGE_KEY = 'academyCandidates';
const NEXT_PULL_KEY = 'academyNextPullAt';

const translateCandidatePosition = (pos: string): string => {
  switch (pos) {
    case 'DEF':
      return 'CB';
    case 'MID':
      return 'CM';
    case 'FWD':
      return 'ST';
    default:
      return pos;
  }
};

const AcademyPage = () => {
  const { user } = useAuth();
  const { balance } = useDiamonds();
  const [nextPullAt, setNextPullAt] = useState<Date | null>(null);
  const [candidates, setCandidates] = useState<AcademyCandidate[]>([]);
  const [canPull, setCanPull] = useState(false);
  const [negotiationCandidate, setNegotiationCandidate] = useState<AcademyCandidate | null>(null);
  const [negotiationOpen, setNegotiationOpen] = useState(false);
  const negotiationContext = useMemo<NegotiationContext | null>(() => {
    if (!negotiationCandidate) {
      return null;
    }
    const baseOverall = negotiationCandidate.player?.overall ?? 0;
    const overall = normalizeRatingTo100(baseOverall);
    return {
      playerId: negotiationCandidate.id,
      playerName: negotiationCandidate.player.name,
      overall,
      position: translateCandidatePosition(negotiationCandidate.player.position),
      transferFee: 0,
      source: 'academy',
      contextId: negotiationCandidate.id,
    };
  }, [negotiationCandidate]);

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

  const triggerNegotiation = (candidate: AcademyCandidate) => {
    setNegotiationCandidate(candidate);
    setNegotiationOpen(true);
  };

  const promotePlayer = (candidateId: string) => {
    const candidate = candidates.find((item) => item.id === candidateId);
    if (!candidate) {
      toast.error('Aday bulunamadi.');
      return;
    }
    triggerNegotiation(candidate);
  };

  const handleAccept = (id: string) => {
    if (!user) return;
    promotePlayer(id);
  };

  const handleRelease = async (id: string) => {
    if (!user) return;
    const candidate = candidates.find((item) => item.id === id);
    if (!candidate) {
      toast.error('Aday bulunamadi.');
      return;
    }
    try {
      await releaseCandidate(user.id, id);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.warn(err);
    }
  };

  const handleNegotiationAccepted = async ({ salary, attempt }: { salary: number; attempt: NegotiationAttempt }) => {
    if (!user || !negotiationCandidate) {
      return;
    }
    try {
      const player = await acceptCandidate(user.id, negotiationCandidate.id, { salary });
      await syncTeamSalaries(user.id);
      await ensureMonthlySalaryCharge(user.id).catch(() => undefined);
      await finalizeNegotiationAttempt(user.id, attempt.id, { accepted: true, salary });
      await recordTransferHistory(user.id, {
        playerId: player.id,
        playerName: player.name,
        overall: normalizeRatingTo100(player.overall),
        transferFee: 0,
        salary,
        source: 'academy',
        attemptId: attempt.id,
        contextId: attempt.contextId ?? negotiationCandidate.id,
        accepted: true,
      });
      toast.success(player.name + ' A takimina katildi!');
      setCandidates(prev => prev.filter(item => item.id !== negotiationCandidate.id));
    } catch (err) {
      console.warn(err);
      toast.error(err instanceof Error ? err.message : 'Pazarlik tamamlanamadi');
      if (user) {
        await finalizeNegotiationAttempt(user.id, attempt.id, { accepted: false });
      }
    } finally {
      setNegotiationOpen(false);
      setNegotiationCandidate(null);
    }
  };

  const handleNegotiationRejected = async ({ attempt }: { attempt: NegotiationAttempt }) => {
    if (user && negotiationCandidate) {
      await finalizeNegotiationAttempt(user.id, attempt.id, { accepted: false });
      await recordTransferHistory(user.id, {
        playerId: attempt.playerId,
        playerName: attempt.playerName,
        overall: attempt.overall,
        transferFee: attempt.transferFee,
        source: 'academy',
        attemptId: attempt.id,
        contextId: attempt.contextId ?? negotiationCandidate.id,
        accepted: false,
      });
    }
    setNegotiationOpen(false);
    setNegotiationCandidate(null);
  };

  if (!user) {
    return <div className="p-4">Giris yapmalisin</div>;
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
        <div className="flex items-center gap-2">
          <BackButton />
          <h1 className="text-2xl font-bold">Altyapi</h1>
        </div>
        <Button onClick={handlePull} disabled={!canPull} data-testid="academy-pull">
          Oyuncu Uret
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{youthCount}</div>
            <p className="text-sm text-muted-foreground">Genc Oyuncu</p>
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
            <p className="text-sm text-muted-foreground">Ort. Yas</p>
          </CardContent>
        </Card>
      </div>
      <CooldownPanel
        nextPullAt={nextPullAt}
        onReset={handleReset}
        canReset={balance >= 100}
      />
      <h2 className="text-xl font-semibold">Genc Oyuncular</h2>
      <CandidatesList
        candidates={candidates}
        onAccept={handleAccept}
        onRelease={handleRelease}
      />
      <NegotiationDialog
        open={negotiationOpen}
        context={negotiationContext}
        onClose={() => {
          setNegotiationOpen(false);
          setNegotiationCandidate(null);
        }}
        onAccepted={handleNegotiationAccepted}
        onRejected={handleNegotiationRejected}
      />
    </div>
  );
};

export default AcademyPage;
