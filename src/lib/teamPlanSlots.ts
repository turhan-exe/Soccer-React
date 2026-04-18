import { formations } from '@/lib/formations';
import { canonicalizePosition } from '@/lib/positionLabels';
import type {
  CustomFormationMap,
  Player,
  Position,
  ResolvedTeamSlotAssignment,
} from '@/types';

type FormationSlot = (typeof formations)[number]['positions'][number];

type BuildResolvedTeamSlotAssignmentsArgs = {
  formation?: string | null;
  players: Player[];
  starters?: string[] | null;
  customFormations?: CustomFormationMap;
};

type SanitizedManualAssignment = {
  x: number;
  y: number;
  position: Position;
};

const clampPercentage = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  const clamped = Math.max(0, Math.min(100, numeric));
  return Number(clamped.toFixed(4));
};

const normalizePosition = (
  value: unknown,
  fallback: Position = 'CM',
): Position => (canonicalizePosition(typeof value === 'string' ? value : null) ?? fallback);

const sanitizeManualAssignment = (
  value: unknown,
  fallback: Position,
): SanitizedManualAssignment | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    x: clampPercentage((value as { x?: unknown }).x),
    y: clampPercentage((value as { y?: unknown }).y),
    position: normalizePosition((value as { position?: unknown }).position, fallback),
  };
};

const findFormationSlots = (formationName?: string | null): FormationSlot[] => {
  const normalized = String(formationName || '').trim();
  const formation =
    formations.find((entry) => entry.name === normalized) ??
    formations.find((entry) => entry.name === '4-2-3-1') ??
    formations[0];

  return formation?.positions ?? [];
};

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
      if (!value || typeof value !== 'object') {
        return null;
      }

      const playerId = String((value as { playerId?: unknown }).playerId || '').trim();
      if (!playerId || (allowedIds && !allowedIds.has(playerId))) {
        return null;
      }

      const slotIndex = Number((value as { slotIndex?: unknown }).slotIndex);
      if (!Number.isFinite(slotIndex) || slotIndex < 0) {
        return null;
      }

      return {
        playerId,
        slotIndex: Math.floor(slotIndex),
        position: normalizePosition((value as { position?: unknown }).position),
        x: clampPercentage((value as { x?: unknown }).x),
        y: clampPercentage((value as { y?: unknown }).y),
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
  const slots = findFormationSlots(formation);
  if (slots.length === 0 || !Array.isArray(players) || players.length === 0) {
    return [];
  }

  const playersById = new Map(players.map((player) => [String(player.id), player] as const));
  const starterIds = Array.from(new Set((starters ?? []).map(String))).filter((playerId) =>
    playersById.has(playerId),
  );
  if (starterIds.length === 0) {
    return [];
  }

  const remainingPlayerIds = new Set(starterIds);
  const manualFormation =
    customFormations && formation ? customFormations[String(formation).trim()] ?? {} : {};
  const slotAssignments = new Map<
    number,
    { player: Player; manual: SanitizedManualAssignment | null }
  >();

  Object.entries(manualFormation).forEach(([playerId, manual]) => {
    const player = playersById.get(String(playerId));
    if (!player || !remainingPlayerIds.has(String(playerId))) {
      return;
    }

    const sanitizedManual = sanitizeManualAssignment(manual, player.position);
    const targetIndex = slots.findIndex((slot, index) => {
      if (slotAssignments.has(index)) {
        return false;
      }

      return (
        normalizePosition(sanitizedManual?.position ?? player.position, slot.position) ===
        normalizePosition(slot.position, slot.position)
      );
    });

    if (targetIndex === -1) {
      return;
    }

    slotAssignments.set(targetIndex, { player, manual: sanitizedManual });
    remainingPlayerIds.delete(String(playerId));
  });

  slots.forEach((slot, index) => {
    if (slotAssignments.has(index)) {
      return;
    }

    const canonicalSlot = normalizePosition(slot.position, slot.position);
    const matchingPlayerId = starterIds.find((playerId) => {
      if (!remainingPlayerIds.has(playerId)) {
        return false;
      }

      const player = playersById.get(playerId);
      if (!player) {
        return false;
      }

      if (normalizePosition(player.position, slot.position) === canonicalSlot) {
        return true;
      }

      return (player.roles ?? []).some(
        (role) => normalizePosition(role, slot.position) === canonicalSlot,
      );
    });

    if (!matchingPlayerId) {
      return;
    }

    const player = playersById.get(matchingPlayerId);
    if (!player) {
      return;
    }

    slotAssignments.set(index, { player, manual: null });
    remainingPlayerIds.delete(matchingPlayerId);
  });

  slots.forEach((slot, index) => {
    if (slotAssignments.has(index) || remainingPlayerIds.size === 0) {
      return;
    }

    const nextPlayerId = starterIds.find((playerId) => remainingPlayerIds.has(playerId));
    if (!nextPlayerId) {
      return;
    }

    const player = playersById.get(nextPlayerId);
    if (!player) {
      remainingPlayerIds.delete(nextPlayerId);
      return;
    }

    slotAssignments.set(index, { player, manual: null });
    remainingPlayerIds.delete(nextPlayerId);
  });

  return slots
    .map((slot, index) => {
      const assigned = slotAssignments.get(index);
      if (!assigned) {
        return null;
      }

      return {
        playerId: String(assigned.player.id),
        slotIndex: index,
        position: assigned.manual?.position ?? normalizePosition(slot.position, slot.position),
        x: assigned.manual?.x ?? clampPercentage(slot.x),
        y: assigned.manual?.y ?? clampPercentage(slot.y),
      } satisfies ResolvedTeamSlotAssignment;
    })
    .filter((value): value is ResolvedTeamSlotAssignment => value !== null);
};
