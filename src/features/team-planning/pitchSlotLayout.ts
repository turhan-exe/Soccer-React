import { buildFormationSlotRect, type Formation } from "@/lib/formations";
import type { Player } from "@/types";

import type { FormationPlayerPosition, PitchSlot } from "./teamPlanningUtils";
import { canonicalPosition, clampPercentageValue } from "./teamPlanningUtils";

export type PitchSlotTemplate = Pick<
  PitchSlot,
  "slotIndex" | "slotKey" | "position" | "x" | "y" | "rect" | "zoneId"
>;

type SlotLayoutPlayer = Pick<Player, "id" | "position" | "roles">;

type NormalizedManualPosition = FormationPlayerPosition;

export type StableSlotAssignment<TPlayer extends SlotLayoutPlayer> = {
  slot: PitchSlotTemplate;
  player: TPlayer;
  manual: NormalizedManualPosition | null;
  resolvedLayout: FormationPlayerPosition;
  slotSource: "template" | "manual";
};

type BuildStableSlotAssignmentsArgs<TPlayer extends SlotLayoutPlayer> = {
  slots: PitchSlotTemplate[];
  players: TPlayer[];
  manualLayout?: Record<string, FormationPlayerPosition> | null;
};

type ResolveSafeManualPositionArgs = {
  slot: PitchSlotTemplate;
  desired: Pick<FormationPlayerPosition, "x" | "y">;
  occupiedPoints?: Array<{ x: number; y: number }>;
};

type ResolvePitchDropSlotArgs = {
  slots: PitchSlotTemplate[];
  coordinates: { x: number; y: number };
  fallbackSlotIndex?: number | null;
  snapRadius?: number;
};

const MIN_MARKER_DISTANCE = 6;
const DEFAULT_DROP_SNAP_RADIUS = 14;

const distanceSquared = (
  left: { x: number; y: number },
  right: { x: number; y: number }
): number => {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
};

const markerDistanceThresholdSquared = MIN_MARKER_DISTANCE * MIN_MARKER_DISTANCE;

const normalizeManualPosition = (
  value: FormationPlayerPosition | null | undefined
): NormalizedManualPosition | null => {
  if (!value) {
    return null;
  }

  const slotIndex =
    typeof value.slotIndex === "number" &&
    Number.isFinite(value.slotIndex) &&
    value.slotIndex >= 0
      ? Math.floor(value.slotIndex)
      : undefined;

  return {
    x: clampPercentageValue(value.x),
    y: clampPercentageValue(value.y),
    position: canonicalPosition(value.position),
    ...(slotIndex != null ? { slotIndex } : {}),
  };
};

const getSlotRect = (slot: PitchSlotTemplate) =>
  slot.rect ?? buildFormationSlotRect(slot.position, slot.x, slot.y);

const clampPointToSlotRect = (
  slot: PitchSlotTemplate,
  point: { x: number; y: number }
): { x: number; y: number } => {
  const rect = getSlotRect(slot);
  const minX = rect.top;
  const maxX = rect.top + rect.height;
  const minY = 100 - (rect.left + rect.width);
  const maxY = 100 - rect.left;

  return {
    x: clampPercentageValue(Math.max(minX, Math.min(maxX, point.x))),
    y: clampPercentageValue(Math.max(minY, Math.min(maxY, point.y))),
  };
};

const buildAnchorCandidates = (
  slot: PitchSlotTemplate
): Array<{ x: number; y: number }> => {
  const rect = getSlotRect(slot);
  const horizontalOffset = Math.max(
    1.5,
    Math.min(rect.width * 0.22, rect.width / 2 - 0.75)
  );
  const verticalOffset = Math.max(
    1.5,
    Math.min(rect.height * 0.22, rect.height / 2 - 0.75)
  );

  const center = clampPointToSlotRect(slot, { x: slot.x, y: slot.y });

  return [
    center,
    { x: center.x - verticalOffset, y: center.y },
    { x: center.x + verticalOffset, y: center.y },
    { x: center.x, y: center.y - horizontalOffset },
    { x: center.x, y: center.y + horizontalOffset },
    { x: center.x - verticalOffset, y: center.y - horizontalOffset },
    { x: center.x - verticalOffset, y: center.y + horizontalOffset },
    { x: center.x + verticalOffset, y: center.y - horizontalOffset },
    { x: center.x + verticalOffset, y: center.y + horizontalOffset },
  ].map((candidate) => clampPointToSlotRect(slot, candidate));
};

const dedupeCandidates = (
  candidates: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> => {
  const seen = new Set<string>();
  const result: Array<{ x: number; y: number }> = [];

  candidates.forEach((candidate) => {
    const key = `${candidate.x.toFixed(4)}:${candidate.y.toFixed(4)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(candidate);
  });

  return result;
};

const isSafeCandidate = (
  candidate: { x: number; y: number },
  occupiedPoints: Array<{ x: number; y: number }>
): boolean =>
  occupiedPoints.every(
    (occupied) =>
      distanceSquared(candidate, occupied) >= markerDistanceThresholdSquared
  );

const buildCompatibleSlotList = <TPlayer extends SlotLayoutPlayer>(
  player: TPlayer,
  manual: NormalizedManualPosition | null,
  slots: PitchSlotTemplate[]
): PitchSlotTemplate[] => {
  const desiredPosition = canonicalPosition(manual?.position ?? player.position);
  const exactSlots = slots.filter(
    (slot) => canonicalPosition(slot.position) === desiredPosition
  );

  const roleSlots = slots.filter((slot) => {
    const canonicalSlot = canonicalPosition(slot.position);
    if (canonicalPosition(player.position) === canonicalSlot) {
      return true;
    }
    return (player.roles ?? []).some(
      (role) => canonicalPosition(role) === canonicalSlot
    );
  });

  const fallbackSlots =
    exactSlots.length > 0 ? exactSlots : roleSlots.length > 0 ? roleSlots : slots;

  return [...fallbackSlots].sort((left, right) => {
    const desiredPoint = manual
      ? { x: manual.x, y: manual.y }
      : { x: player.position === left.position ? left.x : right.x, y: 0 };
    const distanceDelta =
      distanceSquared(desiredPoint, left) - distanceSquared(desiredPoint, right);
    if (distanceDelta !== 0) {
      return distanceDelta;
    }

    return left.slotIndex - right.slotIndex;
  });
};

export const buildFormationSlotTemplates = (
  formation: Pick<Formation, "positions">
): PitchSlotTemplate[] =>
  formation.positions.map((slot, slotIndex) => ({
    ...slot,
    slotIndex,
  }));

export const resolveSafeManualPosition = ({
  slot,
  desired,
  occupiedPoints = [],
}: ResolveSafeManualPositionArgs): FormationPlayerPosition => {
  const center = clampPointToSlotRect(slot, { x: slot.x, y: slot.y });
  const requested = clampPointToSlotRect(slot, desired);
  const candidates = dedupeCandidates([
    requested,
    center,
    ...buildAnchorCandidates(slot),
  ]);

  const safeCandidate =
    candidates.find((candidate) => isSafeCandidate(candidate, occupiedPoints)) ??
    center;

  return {
    x: safeCandidate.x,
    y: safeCandidate.y,
    position: slot.position,
    slotIndex: slot.slotIndex,
  };
};

export const buildStableSlotAssignments = <
  TPlayer extends SlotLayoutPlayer,
>({
  slots,
  players,
  manualLayout,
}: BuildStableSlotAssignmentsArgs<TPlayer>): StableSlotAssignment<TPlayer>[] => {
  if (slots.length === 0 || players.length === 0) {
    return [];
  }

  const playersById = new Map(players.map((player) => [String(player.id), player] as const));
  const playerOrder = new Map(
    players.map((player, index) => [String(player.id), index] as const)
  );
  const normalizedManualByPlayerId = new Map<string, NormalizedManualPosition>();

  players.forEach((player) => {
    const manual = normalizeManualPosition(
      manualLayout?.[String(player.id)] ?? null
    );
    if (!manual) {
      return;
    }

    normalizedManualByPlayerId.set(String(player.id), manual);
  });

  const slotAssignments = new Map<number, { player: TPlayer; manual: NormalizedManualPosition | null }>();
  const remainingPlayerIds = new Set(players.map((player) => String(player.id)));

  const explicitClaimGroups = new Map<number, TPlayer[]>();
  normalizedManualByPlayerId.forEach((manual, playerId) => {
    if (manual.slotIndex == null || manual.slotIndex >= slots.length) {
      return;
    }

    const player = playersById.get(playerId);
    if (!player) {
      return;
    }

    const current = explicitClaimGroups.get(manual.slotIndex) ?? [];
    current.push(player);
    explicitClaimGroups.set(manual.slotIndex, current);
  });

  [...explicitClaimGroups.entries()]
    .sort((left, right) => left[0] - right[0])
    .forEach(([slotIndex, claimants]) => {
      const slot = slots[slotIndex];
      if (!slot || slotAssignments.has(slotIndex)) {
        return;
      }

      const [winner] = [...claimants].sort((left, right) => {
        const leftManual = normalizedManualByPlayerId.get(String(left.id));
        const rightManual = normalizedManualByPlayerId.get(String(right.id));
        const leftPositionPenalty =
          canonicalPosition(leftManual?.position ?? left.position) ===
          canonicalPosition(slot.position)
            ? 0
            : 1;
        const rightPositionPenalty =
          canonicalPosition(rightManual?.position ?? right.position) ===
          canonicalPosition(slot.position)
            ? 0
            : 1;
        if (leftPositionPenalty !== rightPositionPenalty) {
          return leftPositionPenalty - rightPositionPenalty;
        }

        const leftDistance = leftManual
          ? distanceSquared(leftManual, slot)
          : Number.POSITIVE_INFINITY;
        const rightDistance = rightManual
          ? distanceSquared(rightManual, slot)
          : Number.POSITIVE_INFINITY;
        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }

        return (
          (playerOrder.get(String(left.id)) ?? Number.MAX_SAFE_INTEGER) -
          (playerOrder.get(String(right.id)) ?? Number.MAX_SAFE_INTEGER)
        );
      });

      const winnerManual = normalizedManualByPlayerId.get(String(winner.id)) ?? null;
      slotAssignments.set(slotIndex, { player: winner, manual: winnerManual });
      remainingPlayerIds.delete(String(winner.id));
    });

  const availableSlotsAfterExplicit = slots.filter(
    (slot) => !slotAssignments.has(slot.slotIndex)
  );
  const legacyManualPlayers = players
    .filter(
      (player) =>
        remainingPlayerIds.has(String(player.id)) &&
        normalizedManualByPlayerId.has(String(player.id))
    )
    .map((player) => ({
      player,
      candidates: buildCompatibleSlotList(
        player,
        normalizedManualByPlayerId.get(String(player.id)) ?? null,
        availableSlotsAfterExplicit
      ),
    }))
    .sort((left, right) => {
      const countDelta = left.candidates.length - right.candidates.length;
      if (countDelta !== 0) {
        return countDelta;
      }
      return (
        (playerOrder.get(String(left.player.id)) ?? Number.MAX_SAFE_INTEGER) -
        (playerOrder.get(String(right.player.id)) ?? Number.MAX_SAFE_INTEGER)
      );
    });

  legacyManualPlayers.forEach(({ player, candidates }) => {
    if (!remainingPlayerIds.has(String(player.id))) {
      return;
    }

    const targetSlot = candidates.find(
      (candidate) => !slotAssignments.has(candidate.slotIndex)
    );
    if (!targetSlot) {
      return;
    }

    slotAssignments.set(targetSlot.slotIndex, {
      player,
      manual: normalizedManualByPlayerId.get(String(player.id)) ?? null,
    });
    remainingPlayerIds.delete(String(player.id));
  });

  slots.forEach((slot) => {
    if (slotAssignments.has(slot.slotIndex)) {
      return;
    }

    const canonicalSlot = canonicalPosition(slot.position);
    const matchingPlayer = players.find((player) => {
      if (!remainingPlayerIds.has(String(player.id))) {
        return false;
      }

      if (canonicalPosition(player.position) === canonicalSlot) {
        return true;
      }

      return (player.roles ?? []).some(
        (role) => canonicalPosition(role) === canonicalSlot
      );
    });

    if (!matchingPlayer) {
      return;
    }

    slotAssignments.set(slot.slotIndex, { player: matchingPlayer, manual: null });
    remainingPlayerIds.delete(String(matchingPlayer.id));
  });

  slots.forEach((slot) => {
    if (slotAssignments.has(slot.slotIndex) || remainingPlayerIds.size === 0) {
      return;
    }

    const nextPlayerId = players.find((player) =>
      remainingPlayerIds.has(String(player.id))
    )?.id;
    if (!nextPlayerId) {
      return;
    }

    const nextPlayer = playersById.get(String(nextPlayerId));
    if (!nextPlayer) {
      remainingPlayerIds.delete(String(nextPlayerId));
      return;
    }

    slotAssignments.set(slot.slotIndex, { player: nextPlayer, manual: null });
    remainingPlayerIds.delete(String(nextPlayerId));
  });

  const occupiedPoints: Array<{ x: number; y: number }> = [];

  return slots
    .map((slot) => {
      const assigned = slotAssignments.get(slot.slotIndex);
      if (!assigned) {
        return null;
      }

      const desiredPoint = assigned.manual
        ? { x: assigned.manual.x, y: assigned.manual.y }
        : { x: slot.x, y: slot.y };
      const resolvedLayout = resolveSafeManualPosition({
        slot,
        desired: desiredPoint,
        occupiedPoints,
      });
      occupiedPoints.push({ x: resolvedLayout.x, y: resolvedLayout.y });

      const slotSource =
        assigned.manual ||
        resolvedLayout.x !== clampPercentageValue(slot.x) ||
        resolvedLayout.y !== clampPercentageValue(slot.y)
          ? "manual"
          : "template";

      return {
        slot,
        player: assigned.player,
        manual: assigned.manual,
        resolvedLayout,
        slotSource,
      } satisfies StableSlotAssignment<TPlayer>;
    })
    .filter((entry): entry is StableSlotAssignment<TPlayer> => entry !== null);
};

export const buildStableManualLayoutMap = <TPlayer extends SlotLayoutPlayer>(
  args: BuildStableSlotAssignmentsArgs<TPlayer>
): Record<string, FormationPlayerPosition> =>
  Object.fromEntries(
    buildStableSlotAssignments(args).map((assignment) => [
      String(assignment.player.id),
      assignment.resolvedLayout,
    ])
  );

export const resolvePitchDropSlot = ({
  slots,
  coordinates,
  fallbackSlotIndex = null,
  snapRadius = DEFAULT_DROP_SNAP_RADIUS,
}: ResolvePitchDropSlotArgs): PitchSlotTemplate | null => {
  if (slots.length === 0) {
    return null;
  }

  const containingSlots = slots.filter((slot) => {
    const rect = getSlotRect(slot);
    const left = 100 - coordinates.y;
    return (
      coordinates.x >= rect.top &&
      coordinates.x <= rect.top + rect.height &&
      left >= rect.left &&
      left <= rect.left + rect.width
    );
  });

  const chooseNearest = (candidates: PitchSlotTemplate[]): PitchSlotTemplate | null => {
    if (candidates.length === 0) {
      return null;
    }

    return [...candidates].sort((left, right) => {
      const distanceDelta =
        distanceSquared(coordinates, left) - distanceSquared(coordinates, right);
      if (distanceDelta !== 0) {
        return distanceDelta;
      }

      return left.slotIndex - right.slotIndex;
    })[0] ?? null;
  };

  const containingSlot = chooseNearest(containingSlots);
  if (containingSlot) {
    return containingSlot;
  }

  const nearestSlot = chooseNearest(slots);
  if (
    nearestSlot &&
    distanceSquared(coordinates, nearestSlot) <= snapRadius * snapRadius
  ) {
    return nearestSlot;
  }

  if (fallbackSlotIndex == null) {
    return null;
  }

  return (
    slots.find((slot) => slot.slotIndex === fallbackSlotIndex) ?? null
  );
};
