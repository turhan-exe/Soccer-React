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
  ACADEMY_RESET_DIAMOND_COST,
  type AcademyCandidateListenerError,
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
import { useTranslation } from '@/contexts/LanguageContext';

const upsertCandidate = (
  current: AcademyCandidate[],
  candidate: AcademyCandidate,
): AcademyCandidate[] => [
  candidate,
  ...current.filter(existing => existing.id !== candidate.id),
];

const getAcademyListenerErrorMessage = (
  error: AcademyCandidateListenerError,
  t: ReturnType<typeof useTranslation>['t'],
): string => {
  switch (error.code) {
    case 'permission-denied':
      return t('academy.errors.permissionDenied');
    case 'index-required':
      return t('academy.errors.indexRequired');
    default:
      return t('academy.errors.candidatesLoadFailed');
  }
};

const AcademyPage = () => {
  const { user } = useAuth();
  const { balance } = useDiamonds();
  const { t } = useTranslation();
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
      position: negotiationCandidate.player.position,
      transferFee: 0,
      source: 'academy',
      contextId: negotiationCandidate.id,
    };
  }, [negotiationCandidate]);

  useEffect(() => {
    setCandidates([]);
    setNextPullAt(null);
    setNegotiationCandidate(null);
    setNegotiationOpen(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const ref = doc(db, 'users', user.id);
      return onSnapshot(
        ref,
        (snap) => {
          const data = snap.data() as { academy?: { nextPullAt?: { toDate: () => Date } } } | undefined;
          const ts = data?.academy?.nextPullAt;
          setNextPullAt(ts ? ts.toDate() : null);
        },
        (error) => {
          console.warn('[AcademyPage] failed to sync academy cooldown', error);
          setNextPullAt(null);
          toast.error(t('academy.errors.cooldownLoadFailed'));
        },
      );
    } catch (err) {
      console.warn(err);
    }
  }, [t, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    try {
      return listenPendingCandidates(
        user.id,
        setCandidates,
        (error) => {
          toast.error(getAcademyListenerErrorMessage(error, t));
        },
      );
    } catch (err) {
      console.warn(err);
    }
  }, [t, user?.id]);

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
      setCandidates((prev) => upsertCandidate(prev, candidate));
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
      toast.error(t('academy.candidateMissing'));
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
      toast.error(t('academy.candidateMissing'));
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

    const activeCandidate = negotiationCandidate;

    try {
      const player = await acceptCandidate(user.id, activeCandidate.id, { salary });
      setCandidates(prev => prev.filter(item => item.id !== activeCandidate.id));
      setNegotiationOpen(false);
      setNegotiationCandidate(null);
      toast.success(t('academy.joinedTeam', { name: player.name }));

      const sideEffects = await Promise.allSettled([
        syncTeamSalaries(user.id),
        ensureMonthlySalaryCharge(user.id),
        finalizeNegotiationAttempt(user.id, attempt.id, { accepted: true, salary }),
        recordTransferHistory(user.id, {
          playerId: player.id,
          playerName: player.name,
          overall: normalizeRatingTo100(player.overall),
          transferFee: 0,
          salary,
          source: 'academy',
          attemptId: attempt.id,
          contextId: attempt.contextId ?? activeCandidate.id,
          accepted: true,
        }),
      ]);

      const failedSideEffects = sideEffects.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failedSideEffects.length > 0) {
        console.warn('[AcademyPage] academy acceptance side effects partially failed', failedSideEffects);
      }
    } catch (err) {
      console.warn(err);
      toast.error(
        err instanceof Error ? err.message : t('academy.negotiationFailed'),
      );
      try {
        await finalizeNegotiationAttempt(user.id, attempt.id, { accepted: false });
      } catch (finalizeError) {
        console.warn('[AcademyPage] failed to finalize rejected academy negotiation', finalizeError);
      }
    } finally {
      setNegotiationOpen(false);
      setNegotiationCandidate(null);
    }
  };

  const handleNegotiationRejected = async ({ attempt }: { attempt: NegotiationAttempt }) => {
    if (user && negotiationCandidate) {
      const activeCandidate = negotiationCandidate;
      const sideEffects = await Promise.allSettled([
        finalizeNegotiationAttempt(user.id, attempt.id, { accepted: false }),
        recordTransferHistory(user.id, {
          playerId: attempt.playerId,
          playerName: attempt.playerName,
          overall: attempt.overall,
          transferFee: attempt.transferFee,
          source: 'academy',
          attemptId: attempt.id,
          contextId: attempt.contextId ?? activeCandidate.id,
          accepted: false,
        }),
      ]);
      const failedSideEffects = sideEffects.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failedSideEffects.length > 0) {
        console.warn('[AcademyPage] academy rejection side effects partially failed', failedSideEffects);
      }
    }
    setNegotiationOpen(false);
    setNegotiationCandidate(null);
  };

  if (!user) {
    return <div className="p-4">{t('academy.loginRequired')}</div>;
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
          <h1 className="text-2xl font-bold">{t('academy.title')}</h1>
        </div>
        <Button onClick={handlePull} disabled={!canPull} data-testid="academy-pull">
          {t('academy.generatePlayer')}
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{youthCount}</div>
            <p className="text-sm text-muted-foreground">{t('academy.youngPlayer')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{talentedCount}</div>
            <p className="text-sm text-muted-foreground">{t('academy.talented')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{avgAge}</div>
            <p className="text-sm text-muted-foreground">{t('academy.averageAge')}</p>
          </CardContent>
        </Card>
      </div>
      <CooldownPanel
        nextPullAt={nextPullAt}
        onReset={handleReset}
        canReset={balance >= ACADEMY_RESET_DIAMOND_COST}
      />
      <h2 className="text-xl font-semibold">{t('academy.youngPlayers')}</h2>
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
