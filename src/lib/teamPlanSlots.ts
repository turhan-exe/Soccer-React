import { canonicalizePosition } from "@/lib/positionLabels";
import { buildFreeFormationAssignments } from "@/lib/freeFormation";
import type {
  CustomFormationMap,
  Player,
  Position,
  ResolvedTeamSlotAssignment,
} from "@/types";

type BuildResolvedTeamSlotAssignmentsArgs = {
  formation?: string | null;
  players: Player[];
  starters?: string[] | null;
  customFormations?: CustomFormationMap;
};

const clampPercentage = (value: unknown): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  const clamped = Math.max(0, Math.min(100, numeric));
  return Number(clamped.toFixed(4));
};

const normalizePosition = (
  value: unknown,
  fallback: Position = "CM",
): Position =>
  (canonicalizePosition(typeof value === "string" ? value : null) ?? fallback);

export const sanitizeResolvedTeamSlotAssignments = (
  values: unknown,
  rosterIds?: Iterable<string>,
): ResolvedTeamSlotAssignment[] | undefined => {
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }

  const allowedIds = rosterIds ? new Set(Array.from(rosterIds, String)) : null;
  const sanitized = values
    .map((value) => {
      if (!value || typeof value !== "object") {
        return null;
      }

      const playerId = String((value as { playerId?: unknown }).playerId || "").trim();
      if (!playerId || (allowedIds && !allowedIds.has(playerId))) {
        return null;
      }

      const slotIndex = Number((value as { slotIndex?: unknown }).slotIndex);
      if (!Number.isFinite(slotIndex) || slotIndex < 0) {
        return null;
      }

      const rawZoneId = (value as { zoneId?: unknown }).zoneId;

      return {
        playerId,
        slotIndex: Math.floor(slotIndex),
        position: normalizePosition((value as { position?: unknown }).position),
        x: clampPercentage((value as { x?: unknown }).x),
        y: clampPercentage((value as { y?: unknown }).y),
        ...(typeof rawZoneId === "string" && rawZoneId.trim()
          ? { zoneId: rawZoneId.trim() }
          : {}),
      } satisfies ResolvedTeamSlotAssignment;
    })
    .filter((value): value is ResolvedTeamSlotAssignment => value !== null)
    .sort((left, right) => left.slotIndex - right.slotIndex);

  return sanitized.length > 0 ? sanitized : undefined;
};

export const buildResolvedTeamSlotAssignments = ({
  formation,
  players,
  starters,
  customFormations,
}: BuildResolvedTeamSlotAssignmentsArgs): ResolvedTeamSlotAssignment[] => {
  const manualLayout =
    customFormations && formation ? customFormations[String(formation).trim()] ?? {} : {};

  return buildFreeFormationAssignments({
    formation,
    players,
    starters,
    manualLayout,
  }).map(
    (assignment) =>
      ({
        playerId: assignment.playerId,
        slotIndex: assignment.slotIndex,
        position: assignment.position,
        x: assignment.x,
        y: assignment.y,
        zoneId: assignment.zoneId,
      }) satisfies ResolvedTeamSlotAssignment,
  );
};
