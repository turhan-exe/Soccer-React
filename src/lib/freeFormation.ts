import { formations } from "@/lib/formations";
import { canonicalizePosition } from "@/lib/positionLabels";
import {
  getZoneDefinition,
  resolveZoneIdFromCoordinates,
  type ZoneId,
} from "@/features/team-planning/slotZones";
import type {
  CustomFormationLayout,
  Player,
  Position,
  ResolvedTeamSlotAssignment,
} from "@/types";

export const FREE_FORMATION_MIN_DISTANCE = 8;
export const FREE_FORMATION_COLLISION_WIDTH = 5.5;
export const FREE_FORMATION_COLLISION_HEIGHT_ABOVE = 3.25;
export const FREE_FORMATION_COLLISION_HEIGHT_BELOW = 5.25;
export const FREE_FORMATION_COLLISION_PADDING = 0.4;

export type FreeFormationPoint = {
  x: number;
  y: number;
  position: Position;
  zoneId: ZoneId;
};

export type FreeFormationAssignment = ResolvedTeamSlotAssignment & {
  zoneId: ZoneId;
};

export type FreeFormationCollisionRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type RawFormationPoint = Partial<{
  x: unknown;
  y: unknown;
  position: unknown;
  zoneId: unknown;
}>;

const DEFAULT_FORMATION = "4-2-3-1";

const clampPercentage = (value: unknown): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Number(Math.max(0, Math.min(100, numeric)).toFixed(4));
};

const normalizeZoneId = (value: unknown): ZoneId | null => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return getZoneDefinition(value).id;
};

export const getFormationPreset = (formation?: string | null) =>
  formations.find((entry) => entry.name === String(formation || "").trim()) ??
  formations.find((entry) => entry.name === DEFAULT_FORMATION) ??
  formations[0];

const buildFallbackPoint = (
  formation: string | null | undefined,
  slotIndex: number,
): FreeFormationPoint => {
  const preset = getFormationPreset(formation);
  const fallbackSlot = preset.positions[slotIndex] ?? preset.positions[preset.positions.length - 1];
  const zoneId =
    normalizeZoneId(fallbackSlot?.zoneId) ??
    resolveZoneIdFromCoordinates({
      x: clampPercentage(fallbackSlot?.x ?? 50),
      y: clampPercentage(fallbackSlot?.y ?? 50),
    });
  const zone = getZoneDefinition(zoneId);

  return {
    x: clampPercentage(fallbackSlot?.x ?? 50),
    y: clampPercentage(fallbackSlot?.y ?? 50),
    position: zone.slotPosition,
    zoneId,
  };
};

export const normalizeFreeFormationPoint = (
  value: RawFormationPoint | null | undefined,
  fallback?: Partial<FreeFormationPoint> | null,
): FreeFormationPoint => {
  const x = clampPercentage(value?.x ?? fallback?.x ?? 50);
  const y = clampPercentage(value?.y ?? fallback?.y ?? 50);
  const explicitZoneId = normalizeZoneId(value?.zoneId);
  const derivedZoneId = resolveZoneIdFromCoordinates({ x, y });
  const zoneId = explicitZoneId ?? derivedZoneId;
  const zone = getZoneDefinition(zoneId);

  return {
    x,
    y,
    position: zone.slotPosition,
    zoneId,
  };
};

export const buildFreeFormationAssignments = (args: {
  formation?: string | null;
  players: Array<Pick<Player, "id" | "position">>;
  starters?: string[] | null;
  manualLayout?: CustomFormationLayout | null;
}): FreeFormationAssignment[] => {
  if (!Array.isArray(args.players) || args.players.length === 0) {
    return [];
  }

  const playersById = new Map(
    args.players.map((player) => [String(player.id), player] as const),
  );
  const starterIds = Array.from(
    new Set((args.starters ?? []).map((value) => String(value))),
  ).filter((playerId) => playersById.has(playerId));

  return starterIds.map((playerId, slotIndex) => {
    const player = playersById.get(playerId);
    if (!player) {
      return null;
    }

    const fallbackPoint = buildFallbackPoint(args.formation, slotIndex);
    const manualValue = args.manualLayout?.[playerId];
    const normalized = normalizeFreeFormationPoint(manualValue, {
      ...fallbackPoint,
      position:
        canonicalizePosition(player.position) ??
        fallbackPoint.position,
    });

    return {
      playerId,
      slotIndex,
      x: normalized.x,
      y: normalized.y,
      position: normalized.position,
      zoneId: normalized.zoneId,
    } satisfies FreeFormationAssignment;
  }).filter((value): value is FreeFormationAssignment => value !== null);
};

export const buildFreeFormationLayoutRecord = (
  assignments: Array<Pick<FreeFormationAssignment, "playerId" | "x" | "y" | "position" | "zoneId">>,
): CustomFormationLayout =>
  Object.fromEntries(
    assignments.map((assignment) => [
      assignment.playerId,
      {
        x: clampPercentage(assignment.x),
        y: clampPercentage(assignment.y),
        position: assignment.position,
        zoneId: assignment.zoneId,
      },
    ]),
  );

const buildCollisionRect = (
  point: Pick<FreeFormationPoint, "x" | "y">,
  minDistance = FREE_FORMATION_MIN_DISTANCE,
): FreeFormationCollisionRect => {
  const extraPadding = Math.max(
    0,
    (minDistance - FREE_FORMATION_MIN_DISTANCE) / 2,
  );
  const padding = FREE_FORMATION_COLLISION_PADDING + extraPadding;
  const halfWidth = FREE_FORMATION_COLLISION_WIDTH / 2;

  return {
    left: point.y - halfWidth - padding,
    right: point.y + halfWidth + padding,
    top: point.x - FREE_FORMATION_COLLISION_HEIGHT_ABOVE - padding,
    bottom: point.x + FREE_FORMATION_COLLISION_HEIGHT_BELOW + padding,
  };
};

const collisionRectsIntersect = (
  left: FreeFormationCollisionRect,
  right: FreeFormationCollisionRect,
): boolean =>
  left.left < right.right &&
  left.right > right.left &&
  left.top < right.bottom &&
  left.bottom > right.top;

export const findOverlappingAssignment = (
  point: Pick<FreeFormationPoint, "x" | "y">,
  assignments: Array<Pick<FreeFormationAssignment, "playerId" | "x" | "y">>,
  options?: {
    minDistance?: number;
    ignorePlayerId?: string | null;
  },
): Pick<FreeFormationAssignment, "playerId" | "x" | "y"> | null => {
  const minDistance = options?.minDistance ?? FREE_FORMATION_MIN_DISTANCE;
  const pointRect = buildCollisionRect(point, minDistance);

  return (
    assignments.find((assignment) => {
      if (
        options?.ignorePlayerId &&
        assignment.playerId === options.ignorePlayerId
      ) {
        return false;
      }

      return collisionRectsIntersect(
        pointRect,
        buildCollisionRect(assignment, minDistance),
      );
    }) ?? null
  );
};

export const hasFreeFormationOverlap = (
  assignments: Array<Pick<FreeFormationAssignment, "playerId" | "x" | "y">>,
  minDistance = FREE_FORMATION_MIN_DISTANCE,
): boolean => {
  for (let index = 0; index < assignments.length; index += 1) {
    const current = assignments[index];
    if (!current) {
      continue;
    }

    const collision = findOverlappingAssignment(
      current,
      assignments.slice(index + 1),
      { minDistance },
    );
    if (collision) {
      return true;
    }
  }

  return false;
};

export const countGoalkeeperZoneAssignments = (
  assignments: Array<Pick<FreeFormationAssignment, "zoneId">>,
): number =>
  assignments.filter((assignment) => assignment.zoneId === "kaleci").length;
