import { doc, runTransaction } from 'firebase/firestore';
import {
  readConditionRecoveryToastAverageGainPct,
} from '@/lib/playerConditionRecovery';
import { db } from '@/services/firebase';
import type { ConditionRecoveryPendingToast } from '@/types';

type TeamConditionRecoveryDoc = {
  conditionRecoveryPendingToast?: ConditionRecoveryPendingToast | null;
};

export type ClaimTeamConditionRecoveryToastResult =
  | {
      status: 'missing_team' | 'no_pending';
      averageGainPct: 0;
    }
  | {
      status: 'ok';
      averageGainPct: number;
      totalGain: number;
      totalPlayers: number;
      affectedPlayers: number;
      appliedTicks: number;
      updatedAt: string;
    };

const emptyResult = (status: 'missing_team' | 'no_pending'): ClaimTeamConditionRecoveryToastResult => ({
  status,
  averageGainPct: 0,
});

const isValidPendingToast = (
  pendingToast?: ConditionRecoveryPendingToast | null,
): pendingToast is ConditionRecoveryPendingToast =>
  Boolean(
    pendingToast &&
      Number.isFinite(pendingToast.totalGain) &&
      Number.isFinite(pendingToast.totalPlayers) &&
      pendingToast.totalGain > 0 &&
      pendingToast.totalPlayers > 0 &&
      typeof pendingToast.updatedAt === 'string' &&
      pendingToast.updatedAt.trim().length > 0,
  );

export const claimTeamConditionRecoveryToast = async (
  userId: string,
): Promise<ClaimTeamConditionRecoveryToastResult> => {
  const teamRef = doc(db, 'teams', userId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists()) {
      return emptyResult('missing_team');
    }

    const teamData = (snap.data() as TeamConditionRecoveryDoc | undefined) ?? undefined;
    const pendingToast = teamData?.conditionRecoveryPendingToast;

    if (!isValidPendingToast(pendingToast)) {
      if (pendingToast != null) {
        tx.set(
          teamRef,
          {
            conditionRecoveryPendingToast: null,
          },
          { merge: true },
        );
      }

      return emptyResult('no_pending');
    }

    tx.set(
      teamRef,
      {
        conditionRecoveryPendingToast: null,
      },
      { merge: true },
    );

    return {
      status: 'ok',
      averageGainPct: readConditionRecoveryToastAverageGainPct(pendingToast),
      totalGain: Number(pendingToast.totalGain),
      totalPlayers: Number(pendingToast.totalPlayers),
      affectedPlayers: Number.isFinite(pendingToast.affectedPlayers)
        ? Number(pendingToast.affectedPlayers)
        : 0,
      appliedTicks: Number.isFinite(pendingToast.appliedTicks)
        ? Number(pendingToast.appliedTicks)
        : 0,
      updatedAt: pendingToast.updatedAt,
    };
  });
};
