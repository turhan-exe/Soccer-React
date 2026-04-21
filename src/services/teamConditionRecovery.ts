import { doc, runTransaction } from 'firebase/firestore';
import {
  readConditionRecoveryToastAverageGainPercents,
} from '@/lib/playerConditionRecovery';
import { db } from '@/services/firebase';
import type { ConditionRecoveryPendingToast } from '@/types';

type TeamConditionRecoveryDoc = {
  conditionRecoveryPendingToast?: ConditionRecoveryPendingToast | null;
};

type NormalizedPendingToast = {
  conditionGain: number;
  motivationGain: number;
  healthGain: number;
  totalPlayers: number;
  affectedPlayers: number;
  appliedTicks: number;
  updatedAt: string;
};

export type ClaimTeamConditionRecoveryToastResult =
  | {
      status: 'missing_team' | 'no_pending';
      averageConditionGainPct: 0;
      averageMotivationGainPct: 0;
      averageHealthGainPct: 0;
    }
  | {
      status: 'ok';
      averageConditionGainPct: number;
      averageMotivationGainPct: number;
      averageHealthGainPct: number;
      conditionGain: number;
      motivationGain: number;
      healthGain: number;
      totalPlayers: number;
      affectedPlayers: number;
      appliedTicks: number;
      updatedAt: string;
    };

const emptyResult = (
  status: 'missing_team' | 'no_pending',
): ClaimTeamConditionRecoveryToastResult => ({
  status,
  averageConditionGainPct: 0,
  averageMotivationGainPct: 0,
  averageHealthGainPct: 0,
});

const normalizePendingToast = (
  pendingToast?: ConditionRecoveryPendingToast | null,
): NormalizedPendingToast | null => {
  if (
    !pendingToast ||
    !Number.isFinite(pendingToast.totalPlayers) ||
    pendingToast.totalPlayers <= 0 ||
    typeof pendingToast.updatedAt !== 'string' ||
    pendingToast.updatedAt.trim().length <= 0
  ) {
    return null;
  }

  const conditionGain = Number.isFinite(pendingToast.conditionGain)
    ? Number(pendingToast.conditionGain)
    : Number.isFinite(pendingToast.totalGain)
      ? Number(pendingToast.totalGain)
      : 0;
  const motivationGain = Number.isFinite(pendingToast.motivationGain)
    ? Number(pendingToast.motivationGain)
    : 0;
  const healthGain = Number.isFinite(pendingToast.healthGain)
    ? Number(pendingToast.healthGain)
    : 0;

  if (conditionGain <= 0 && motivationGain <= 0 && healthGain <= 0) {
    return null;
  }

  return {
    conditionGain,
    motivationGain,
    healthGain,
    totalPlayers: Number(pendingToast.totalPlayers),
    affectedPlayers: Number.isFinite(pendingToast.affectedPlayers)
      ? Number(pendingToast.affectedPlayers)
      : 0,
    appliedTicks: Number.isFinite(pendingToast.appliedTicks)
      ? Number(pendingToast.appliedTicks)
      : 0,
    updatedAt: pendingToast.updatedAt,
  };
};

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
    const normalizedPendingToast = normalizePendingToast(pendingToast);

    if (!normalizedPendingToast) {
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

    const averages = readConditionRecoveryToastAverageGainPercents(
      normalizedPendingToast,
    );

    return {
      status: 'ok',
      averageConditionGainPct: averages.condition,
      averageMotivationGainPct: averages.motivation,
      averageHealthGainPct: averages.health,
      conditionGain: normalizedPendingToast.conditionGain,
      motivationGain: normalizedPendingToast.motivationGain,
      healthGain: normalizedPendingToast.healthGain,
      totalPlayers: normalizedPendingToast.totalPlayers,
      affectedPlayers: normalizedPendingToast.affectedPlayers,
      appliedTicks: normalizedPendingToast.appliedTicks,
      updatedAt: normalizedPendingToast.updatedAt,
    };
  });
};
