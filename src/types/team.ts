import type { CustomFormationMap, ResolvedTeamSlotAssignment } from '@/types';
import type { ConditionRecoveryPendingToast } from './conditionRecovery';

export interface Lineup {
  formation: string;          // e.g. "4-3-3"
  starters: string[];         // playerId[]
  subs: string[];             // playerId[]
  reserves?: string[];        // optional reserve list for UI snapshots
  tactics?: Record<string, any>;
  shape?: string;
  customFormations?: CustomFormationMap;
  slotAssignments?: ResolvedTeamSlotAssignment[];
}

export interface TeamDoc {
  id: string;                 // doc id
  leagueId: string;           // denormalized for convenience
  ownerUid: string;
  clubName: string;
  conditionRecoveryDueAt?: string | null;
  conditionRecoveryPendingToast?: ConditionRecoveryPendingToast | null;
  conditionRecoveryAt?: string | null;
  elo?: number;
  lineupLocked?: boolean;
  lineup?: Lineup;            // set via setLineup
}


