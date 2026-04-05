import type { Formation } from "@/lib/formations";
import type { Player } from "@/types";

import {
  getZoneDefinition,
  positionAffinity,
  recommendPlayers,
  resolveSlotZoneId,
} from "./slotZones";
import type { ZoneId } from "./slotZones";
import type {
  DisplayPlayer,
  FormationPlayerPosition,
  PitchSlot,
  PlayerBaseline,
} from "./teamPlanningUtils";
import {
  buildDisplayPlayer,
  canonicalPosition,
  computePositionOverall,
  isContractExpired,
  normalizePlayers,
  squadRoleWeight,
} from "./teamPlanningUtils";

type BestLineupAssignment = {
  playerId: string;
  slotIndex: number;
  position: Player["position"];
  x: number;
  y: number;
};

export type BestLineupResult = {
  players: Player[];
  layout: Record<string, FormationPlayerPosition>;
  assignments: BestLineupAssignment[];
  missingSlotCount: number;
  eligiblePlayerCount: number;
};

type BaselineMap = Record<string, PlayerBaseline | undefined>;

const buildEvaluationPlayer = (
  player: Player,
  baselines: BaselineMap
): DisplayPlayer => {
  const baseline = baselines[player.id];
  const naturalPosition = canonicalPosition(
    baseline?.naturalPosition ?? player.position
  );

  return buildDisplayPlayer(
    {
      ...player,
      position: naturalPosition,
    },
    baseline,
    { respectAssignedPosition: false }
  );
};

const isEligibleForBestLineup = (player: Player): boolean => {
  if (player.injuryStatus === "injured") {
    return false;
  }

  if (player.contract?.status === "released") {
    return false;
  }

  if (isContractExpired(player)) {
    return false;
  }

  return true;
};

const rankFallbackCandidates = (
  slotPosition: Player["position"],
  candidates: DisplayPlayer[]
): DisplayPlayer[] =>
  [...candidates].sort((left, right) => {
    const projectedDelta =
      computePositionOverall(slotPosition, right.attributes) -
      computePositionOverall(slotPosition, left.attributes);
    if (projectedDelta !== 0) {
      return projectedDelta;
    }

    const overallDelta = right.originalOverall - left.originalOverall;
    if (overallDelta !== 0) {
      return overallDelta;
    }

    const roleDelta =
      squadRoleWeight(left.squadRole) - squadRoleWeight(right.squadRole);
    if (roleDelta !== 0) {
      return roleDelta;
    }

    return left.id.localeCompare(right.id);
  });

const projectOverallForSlot = (
  slotPosition: Player["position"],
  player: DisplayPlayer
): number =>
  Math.min(
    player.originalOverall,
    computePositionOverall(slotPosition, player.attributes)
  );

const rankStrictCandidates = (
  slot: PitchSlot,
  zoneId: ZoneId,
  candidates: DisplayPlayer[]
): DisplayPlayer[] => {
  const zone = getZoneDefinition(zoneId);

  return [...candidates].sort((left, right) => {
    const projectedDelta =
      projectOverallForSlot(slot.position, right) -
      projectOverallForSlot(slot.position, left);
    if (projectedDelta !== 0) {
      return projectedDelta;
    }

    const affinityDelta =
      positionAffinity(right, zone) - positionAffinity(left, zone);
    if (affinityDelta !== 0) {
      return affinityDelta;
    }

    const overallDelta = right.originalOverall - left.originalOverall;
    if (overallDelta !== 0) {
      return overallDelta;
    }

    const roleDelta =
      squadRoleWeight(left.squadRole) - squadRoleWeight(right.squadRole);
    if (roleDelta !== 0) {
      return roleDelta;
    }

    return left.id.localeCompare(right.id);
  });
};

export const buildBestLineupForFormation = (
  players: Player[],
  formation: Formation,
  baselines: BaselineMap
): BestLineupResult => {
  const eligiblePlayers = players.filter(isEligibleForBestLineup);
  const evaluationPlayers = eligiblePlayers.map((player) =>
    buildEvaluationPlayer(player, baselines)
  );

  const slots = formation.positions.map<{
    slot: PitchSlot;
    zoneId: ZoneId;
    candidates: DisplayPlayer[];
  }>((slot, slotIndex) => {
    const pitchSlot: PitchSlot = {
      ...slot,
      slotIndex,
      slotSource: "template",
      player: null,
    };
    const zoneId = resolveSlotZoneId(pitchSlot);

    return {
      slot: pitchSlot,
      zoneId,
      candidates: rankStrictCandidates(
        pitchSlot,
        zoneId,
        recommendPlayers(zoneId, evaluationPlayers, {
          allowStarters: true,
          limit: evaluationPlayers.length,
        })
      ),
    };
  });

  const usedPlayerIds = new Set<string>();
  const assignments: BestLineupAssignment[] = [];
  const assignedSlotIndices = new Set<number>();

  const strictSlots = slots
    .filter((entry) => entry.candidates.length > 0)
    .sort((left, right) => {
      const countDelta = left.candidates.length - right.candidates.length;
      if (countDelta !== 0) {
        return countDelta;
      }
      return left.slot.slotIndex - right.slot.slotIndex;
    });

  strictSlots.forEach(({ slot, candidates }) => {
    const candidate = candidates.find(
      (player) => !usedPlayerIds.has(player.id)
    );
    if (!candidate) {
      return;
    }

    usedPlayerIds.add(candidate.id);
    assignedSlotIndices.add(slot.slotIndex);
    assignments.push({
      playerId: candidate.id,
      slotIndex: slot.slotIndex,
      position: slot.position,
      x: slot.x,
      y: slot.y,
    });
  });

  const fallbackSlots = slots.filter(
    ({ slot }) => !assignedSlotIndices.has(slot.slotIndex)
  );

  fallbackSlots.forEach(({ slot }) => {
    const fallbackPool = evaluationPlayers.filter(
      (player) => !usedPlayerIds.has(player.id)
    );
    if (fallbackPool.length === 0) {
      return;
    }

    const [candidate] = rankFallbackCandidates(slot.position, fallbackPool);
    if (!candidate) {
      return;
    }

    usedPlayerIds.add(candidate.id);
    assignments.push({
      playerId: candidate.id,
      slotIndex: slot.slotIndex,
      position: slot.position,
      x: slot.x,
      y: slot.y,
    });
  });

  const assignmentByPlayerId = new Map(
    assignments.map((assignment) => [assignment.playerId, assignment] as const)
  );
  const layout = Object.fromEntries(
    assignments.map((assignment) => [
      assignment.playerId,
      {
        x: assignment.x,
        y: assignment.y,
        position: assignment.position,
      },
    ])
  ) as Record<string, FormationPlayerPosition>;

  const nextPlayers = players.map((player) => {
    const assignment = assignmentByPlayerId.get(player.id);
    if (assignment) {
      return {
        ...player,
        squadRole: "starting" as const,
        position: assignment.position,
      };
    }

    if (player.squadRole === "starting") {
      const baseline = baselines[player.id];
      return {
        ...player,
        squadRole: "bench" as const,
        position: canonicalPosition(
          baseline?.naturalPosition ?? player.position
        ),
      };
    }

    return player;
  });

  return {
    players: normalizePlayers(nextPlayers),
    layout,
    assignments,
    missingSlotCount: Math.max(
      0,
      formation.positions.length - assignments.length
    ),
    eligiblePlayerCount: eligiblePlayers.length,
  };
};
