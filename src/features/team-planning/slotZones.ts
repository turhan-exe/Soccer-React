import type { Player } from "@/types";
import {
  canonicalPosition,
  computePositionOverall,
  squadRoleWeight,
} from "./teamPlanningUtils";
import type { DisplayPlayer } from "./teamPlanningUtils";
import type { PitchSlot } from "./teamPlanningUtils";
import type { SkillTag } from "./skillTags";

export type ZoneId =
  | "santrafor"
  | "gizli forvet"
  | "sol açık"
  | "sağ açık"
  | "sol kanat"
  | "sağ kanat"
  | "ofansif orta saha"
  | "merkez orta saha"
  | "defansif orta saha sol"
  | "defansif orta saha sağ"
  | "ön libero"
  | "sol bek"
  | "sağ bek"
  | "stoper sol"
  | "stoper sağ"
  | "kaleci";

export type ZoneDefinition = {
  id: ZoneId;
  label: string;
  slotPosition: Player["position"];
  capabilityTags: SkillTag[];
  fallbackPositions?: Player["position"][];
};

export type ZoneOverlayBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const ORDERED_ZONE_IDS: ZoneId[] = [
  "sol bek",
  "sol kanat",
  "sol açık",
  "kaleci",
  "stoper sol",
  "stoper sağ",
  "sağ bek",
  "sağ kanat",
  "sağ açık",
  "ön libero",
  "defansif orta saha sol",
  "defansif orta saha sağ",
  "merkez orta saha",
  "ofansif orta saha",
  "gizli forvet",
  "santrafor",
];

export const ZONES: Record<ZoneId, ZoneDefinition> = {
  santrafor: {
    id: "santrafor",
    label: "Santrafor",
    slotPosition: "ST",
    capabilityTags: ["finishing", "aerial", "holdUp"],
    fallbackPositions: ["CAM"],
  },
  "gizli forvet": {
    id: "gizli forvet",
    label: "Gizli Forvet",
    slotPosition: "CAM",
    capabilityTags: ["finishing", "offBall", "linkPlay"],
    fallbackPositions: ["ST"],
  },
  "sol açık": {
    id: "sol açık",
    label: "Sol Açık",
    slotPosition: "LW",
    capabilityTags: ["pace", "dribbling", "crossing"],
    fallbackPositions: ["LM"],
  },
  "sağ açık": {
    id: "sağ açık",
    label: "Sağ Açık",
    slotPosition: "RW",
    capabilityTags: ["pace", "dribbling", "crossing"],
    fallbackPositions: ["RM"],
  },
  "sol kanat": {
    id: "sol kanat",
    label: "Sol Kanat",
    slotPosition: "LM",
    capabilityTags: ["workRate", "support", "crossing"],
    fallbackPositions: ["LW", "LB"],
  },
  "sağ kanat": {
    id: "sağ kanat",
    label: "Sağ Kanat",
    slotPosition: "RM",
    capabilityTags: ["workRate", "support", "crossing"],
    fallbackPositions: ["RW", "RB"],
  },
  "ofansif orta saha": {
    id: "ofansif orta saha",
    label: "Ofansif Orta Saha",
    slotPosition: "CAM",
    capabilityTags: ["vision", "passing", "longShots"],
    fallbackPositions: ["CM"],
  },
  "merkez orta saha": {
    id: "merkez orta saha",
    label: "Merkez Orta Saha",
    slotPosition: "CM",
    capabilityTags: ["boxToBox", "passing", "support"],
  },
  "defansif orta saha sol": {
    id: "defansif orta saha sol",
    label: "Defansif Orta Saha",
    slotPosition: "CM",
    capabilityTags: ["ballWinning", "pressResist", "shortPassing"],
  },
  "defansif orta saha sağ": {
    id: "defansif orta saha sağ",
    label: "Defansif Orta Saha",
    slotPosition: "CM",
    capabilityTags: ["ballWinning", "pressResist", "shortPassing"],
  },
  "ön libero": {
    id: "ön libero",
    label: "Ön Libero",
    slotPosition: "CM",
    capabilityTags: ["shielding", "distribution", "sweeper"],
  },
  "sol bek": {
    id: "sol bek",
    label: "Sol Bek",
    slotPosition: "LB",
    capabilityTags: ["tackling", "crossing", "workRate"],
  },
  "sağ bek": {
    id: "sağ bek",
    label: "Sağ Bek",
    slotPosition: "RB",
    capabilityTags: ["tackling", "crossing", "workRate"],
  },
  "stoper sol": {
    id: "stoper sol",
    label: "Stoper",
    slotPosition: "CB",
    capabilityTags: ["tackling", "aerial", "positioning"],
  },
  "stoper sağ": {
    id: "stoper sağ",
    label: "Stoper",
    slotPosition: "CB",
    capabilityTags: ["tackling", "aerial", "positioning"],
  },
  kaleci: {
    id: "kaleci",
    label: "Kaleci",
    slotPosition: "GK",
    capabilityTags: ["shotStopping", "distribution"],
  },
};

const ZONE_SHORT_CODES: Record<ZoneId, string> = {
  kaleci: "KL",
  "stoper sol": "STP",
  "stoper sağ": "STP",
  "sol bek": "SLB",
  "sağ bek": "SĞB",
  "ön libero": "ÖL",
  "defansif orta saha sol": "DOS",
  "defansif orta saha sağ": "DOS",
  "merkez orta saha": "MO",
  "ofansif orta saha": "OOS",
  "gizli forvet": "GF",
  "sol kanat": "SLO",
  "sağ kanat": "SĞO",
  "sol açık": "SLA",
  "sağ açık": "SĞA",
  santrafor: "SF",
};

const ZONE_OVERLAY_BOUNDS: Record<ZoneId, ZoneOverlayBounds> = {
  "sol bek": { left: 0, top: 0, width: 35, height: 20 },
  "sol kanat": { left: 35, top: 0, width: 25, height: 20 },
  "sol açık": { left: 60, top: 0, width: 40, height: 20 },
  kaleci: { left: 0, top: 20, width: 14, height: 60 },
  "stoper sol": { left: 14, top: 20, width: 14, height: 30 },
  "stoper sağ": { left: 14, top: 50, width: 14, height: 30 },
  "ön libero": { left: 28, top: 20, width: 10, height: 60 },
  "defansif orta saha sol": { left: 38, top: 20, width: 7, height: 30 },
  "defansif orta saha sağ": { left: 38, top: 50, width: 7, height: 30 },
  "merkez orta saha": { left: 45, top: 20, width: 13, height: 60 },
  "ofansif orta saha": { left: 58, top: 20, width: 12, height: 60 },
  "gizli forvet": { left: 70, top: 20, width: 5, height: 60 },
  santrafor: { left: 75, top: 20, width: 25, height: 60 },
  "sağ bek": { left: 0, top: 80, width: 35, height: 20 },
  "sağ kanat": { left: 35, top: 80, width: 25, height: 20 },
  "sağ açık": { left: 60, top: 80, width: 40, height: 20 },
};

export const getZoneShortCode = (zoneId: ZoneId): string => {
  return ZONE_SHORT_CODES[zoneId] ?? "MO";
};

export const getZoneOverlayBounds = (zoneId: ZoneId): ZoneOverlayBounds =>
  ZONE_OVERLAY_BOUNDS[zoneId];

const resolveZoneIdFromVisualCoordinates = (
  visualX: number,
  visualY: number
): ZoneId => {
  // 1. Flank Zones (Based on Visual Y)
  if (visualY <= 20) {
    // Left Flank (Top)
    if (visualX < 35) return "sol bek";
    if (visualX > 60) return "sol açık";
    return "sol kanat";
  }

  if (visualY >= 80) {
    // Right Flank (Bottom)
    if (visualX < 35) return "sağ bek";
    if (visualX > 60) return "sağ açık";
    return "sağ kanat";
  }

  // 2. Central Zones (Based on Visual X)
  // visualX < 14
  if (visualX < 14) {
    return "kaleci";
  }
  // 14 <= visualX < 28
  if (visualX < 28) {
    // Top half is Left for central defenders because visualY=0 is Top
    return visualY <= 50 ? "stoper sol" : "stoper sağ";
  }
  // 28 <= visualX < 38
  if (visualX < 38) {
    return "ön libero";
  }
  // 38 <= visualX < 45
  if (visualX < 45) {
    return visualY <= 50 ? "defansif orta saha sol" : "defansif orta saha sağ";
  }
  // 45 <= visualX < 58
  if (visualX < 58) {
    return "merkez orta saha";
  }
  // 58 <= visualX < 70
  if (visualX < 70) {
    return "ofansif orta saha";
  }
  // 70 <= visualX < 75
  if (visualX < 75) {
    return "gizli forvet";
  }
  // visualX >= 75
  return "santrafor";
};

export const resolveZoneIdFromCoordinates = (
  coords: Pick<PitchSlot, "x" | "y">
): ZoneId => resolveZoneIdFromVisualCoordinates(100 - coords.y, coords.x);

export const resolveZoneId = (slot: PitchSlot): ZoneId =>
  resolveZoneIdFromCoordinates(slot);

export const getZoneDefinition = (zoneId: ZoneId): ZoneDefinition =>
  ZONES[zoneId];

type RecommendationOptions = {
  excludeIds?: string[];
  limit?: number;
  allowStarters?: boolean;
};

const getZonePositions = (zone: ZoneDefinition): Player["position"][] => {
  const fallbacks = zone.fallbackPositions ?? [];
  return [zone.slotPosition, ...fallbacks];
};

export const positionAffinity = (
  player: DisplayPlayer,
  zone: ZoneDefinition
): number => {
  const canonicalAssigned = canonicalPosition(player.position);
  if (canonicalAssigned === zone.slotPosition) {
    return 1.0;
  }
  if (
    (player.roles ?? []).some(
      (role) => canonicalPosition(role) === zone.slotPosition
    )
  ) {
    return 0.8;
  }
  const fallbackMatch = getZonePositions(zone).some(
    (pos) =>
      canonicalAssigned === canonicalPosition(pos) ||
      (player.roles ?? []).some(
        (role) => canonicalPosition(role) === canonicalPosition(pos)
      )
  );
  return fallbackMatch ? 0.6 : 0.3; // Significant penalty for mismatch
};

export type SlotFitLevel = "exact" | "near" | "invalid";

export const getZoneFitLevel = (
  player: DisplayPlayer,
  zoneId: ZoneId,
  nearDropThreshold = 6
): SlotFitLevel => {
  const zone = getZoneDefinition(zoneId);
  const targetPosition = canonicalPosition(zone.slotPosition);
  const naturalPosition = canonicalPosition(
    player.naturalPosition ?? player.position
  );
  const allowedPositions = new Set<Player["position"]>([
    naturalPosition,
    ...(player.roles ?? []).map((role) => canonicalPosition(role)),
  ]);
  const projectedOverall = Math.min(
    player.originalOverall,
    computePositionOverall(targetPosition, player.attributes)
  );
  const drop = Math.max(0, player.originalOverall - projectedOverall);

  if (targetPosition === "GK") {
    return !allowedPositions.has("GK")
      ? "invalid"
      : drop === 0
      ? "exact"
      : "near";
  }

  if (allowedPositions.has("GK")) {
    return "invalid";
  }

  if (allowedPositions.has(targetPosition)) {
    return drop === 0 ? "exact" : "near";
  }

  if (positionAffinity(player, zone) < 0.6) {
    return "invalid";
  }

  return drop <= nearDropThreshold ? "near" : "invalid";
};

export const getSlotFitLevel = (
  player: DisplayPlayer,
  slot: PitchSlot,
  nearDropThreshold = 6
): SlotFitLevel =>
  getZoneFitLevel(player, resolveZoneId(slot), nearDropThreshold);

const skillScoreForZone = (
  player: DisplayPlayer,
  zone: ZoneDefinition
): number => {
  const tags = zone.capabilityTags;
  if (tags.length === 0) {
    return 0;
  }

  let score = 0;
  let totalWeight = 0;
  tags.forEach((tag, index) => {
    const tagValue = player.skillTags?.[tag] ?? 0;
    const weight = tags.length - index;
    totalWeight += weight;
    score += tagValue * weight;
  });

  if (totalWeight === 0) {
    return 0;
  }
  return score / totalWeight;
};

export const recommendPlayers = (
  zoneId: ZoneId,
  players: DisplayPlayer[],
  options: RecommendationOptions = {}
): DisplayPlayer[] => {
  const zone = getZoneDefinition(zoneId);
  const exclude = new Set(options.excludeIds ?? []);
  const allowStarters = options.allowStarters ?? false;

  const pool = players.filter((player) => {
    if (exclude.has(player.id)) {
      return false;
    }
    if (!allowStarters && player.squadRole === "starting") {
      return false;
    }
    return true;
  });

  const scored = pool
    .map((player) => {
      const skillScore = skillScoreForZone(player, zone);
      const matchMultiplier = positionAffinity(player, zone);
      const totalScore = skillScore * matchMultiplier;
      return { player, score: totalScore, matchMultiplier };
    })
    .filter((entry) => entry.matchMultiplier > 0.6); // Strict filter: Exclude mismatches (0.5)

  scored.sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const overallDelta = b.player.overall - a.player.overall;
    if (overallDelta !== 0) {
      return overallDelta;
    }

    const roleDelta =
      squadRoleWeight(a.player.squadRole) - squadRoleWeight(b.player.squadRole);
    if (roleDelta !== 0) {
      return roleDelta;
    }

    return a.player.id.localeCompare(b.player.id);
  });

  const limit = options.limit ?? 6;
  return scored.slice(0, limit).map((entry) => entry.player);
};
