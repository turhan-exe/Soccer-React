import type { AppLanguage } from "@/i18n/types";
import { translate } from "@/i18n/runtime";
import type { Player } from "@/types";

import {
  canonicalPosition,
  computePositionOverall,
  squadRoleWeight,
} from "./teamPlanningUtils";
import type { DisplayPlayer, PitchSlot } from "./teamPlanningUtils";
import type { SkillTag } from "./skillTags";

export type ZoneId =
  | "santrafor"
  | "gizli forvet"
  | "sol aÃ§Ä±k"
  | "saÄŸ aÃ§Ä±k"
  | "sol kanat"
  | "saÄŸ kanat"
  | "ofansif orta saha"
  | "merkez orta saha"
  | "defansif orta saha sol"
  | "defansif orta saha saÄŸ"
  | "Ã¶n libero"
  | "sol bek"
  | "saÄŸ bek"
  | "stoper sol"
  | "stoper saÄŸ"
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
  "sol aÃ§Ä±k",
  "kaleci",
  "stoper sol",
  "stoper saÄŸ",
  "saÄŸ bek",
  "saÄŸ kanat",
  "saÄŸ aÃ§Ä±k",
  "Ã¶n libero",
  "defansif orta saha sol",
  "defansif orta saha saÄŸ",
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
  "sol aÃ§Ä±k": {
    id: "sol aÃ§Ä±k",
    label: "Sol AÃ§Ä±k",
    slotPosition: "LW",
    capabilityTags: ["pace", "dribbling", "crossing"],
    fallbackPositions: ["LM"],
  },
  "saÄŸ aÃ§Ä±k": {
    id: "saÄŸ aÃ§Ä±k",
    label: "SaÄŸ AÃ§Ä±k",
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
  "saÄŸ kanat": {
    id: "saÄŸ kanat",
    label: "SaÄŸ Kanat",
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
  "defansif orta saha saÄŸ": {
    id: "defansif orta saha saÄŸ",
    label: "Defansif Orta Saha",
    slotPosition: "CM",
    capabilityTags: ["ballWinning", "pressResist", "shortPassing"],
  },
  "Ã¶n libero": {
    id: "Ã¶n libero",
    label: "Ã–n Libero",
    slotPosition: "CM",
    capabilityTags: ["shielding", "distribution", "sweeper"],
  },
  "sol bek": {
    id: "sol bek",
    label: "Sol Bek",
    slotPosition: "LB",
    capabilityTags: ["tackling", "crossing", "workRate"],
  },
  "saÄŸ bek": {
    id: "saÄŸ bek",
    label: "SaÄŸ Bek",
    slotPosition: "RB",
    capabilityTags: ["tackling", "crossing", "workRate"],
  },
  "stoper sol": {
    id: "stoper sol",
    label: "Stoper",
    slotPosition: "CB",
    capabilityTags: ["tackling", "aerial", "positioning"],
  },
  "stoper saÄŸ": {
    id: "stoper saÄŸ",
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

const ZONE_TRANSLATION_KEYS: Record<ZoneId, string> = {
  kaleci: "goalkeeper",
  "stoper sol": "leftCenterBack",
  "stoper saÄŸ": "rightCenterBack",
  "sol bek": "leftBack",
  "saÄŸ bek": "rightBack",
  "Ã¶n libero": "sweeperMidfield",
  "defansif orta saha sol": "leftHoldingMidfield",
  "defansif orta saha saÄŸ": "rightHoldingMidfield",
  "merkez orta saha": "centralMidfield",
  "ofansif orta saha": "attackingMidfield",
  "gizli forvet": "shadowStriker",
  "sol kanat": "leftMidfield",
  "saÄŸ kanat": "rightMidfield",
  "sol aÃ§Ä±k": "leftWinger",
  "saÄŸ aÃ§Ä±k": "rightWinger",
  santrafor: "striker",
};

const ZONE_OVERLAY_BOUNDS: Record<ZoneId, ZoneOverlayBounds> = {
  "sol bek": { left: 0, top: 0, width: 35, height: 20 },
  "sol kanat": { left: 35, top: 0, width: 25, height: 20 },
  "sol aÃ§Ä±k": { left: 60, top: 0, width: 40, height: 20 },
  kaleci: { left: 0, top: 20, width: 14, height: 60 },
  "stoper sol": { left: 14, top: 20, width: 14, height: 30 },
  "stoper saÄŸ": { left: 14, top: 50, width: 14, height: 30 },
  "Ã¶n libero": { left: 28, top: 20, width: 10, height: 60 },
  "defansif orta saha sol": { left: 38, top: 20, width: 7, height: 30 },
  "defansif orta saha saÄŸ": { left: 38, top: 50, width: 7, height: 30 },
  "merkez orta saha": { left: 45, top: 20, width: 13, height: 60 },
  "ofansif orta saha": { left: 58, top: 20, width: 12, height: 60 },
  "gizli forvet": { left: 70, top: 20, width: 5, height: 60 },
  santrafor: { left: 75, top: 20, width: 25, height: 60 },
  "saÄŸ bek": { left: 0, top: 80, width: 35, height: 20 },
  "saÄŸ kanat": { left: 35, top: 80, width: 25, height: 20 },
  "saÄŸ aÃ§Ä±k": { left: 60, top: 80, width: 40, height: 20 },
};

export const getZoneLabel = (
  zoneId: ZoneId,
  language?: AppLanguage,
): string =>
  translate(
    `teamPlanning.zones.labels.${ZONE_TRANSLATION_KEYS[zoneId]}`,
    undefined,
    language,
  );

export const getZoneShortCode = (
  zoneId: ZoneId,
  language?: AppLanguage,
): string =>
  translate(
    `teamPlanning.zones.short.${ZONE_TRANSLATION_KEYS[zoneId]}`,
    undefined,
    language,
  );

export const getZoneOverlayBounds = (zoneId: ZoneId): ZoneOverlayBounds =>
  ZONE_OVERLAY_BOUNDS[zoneId];

const resolveZoneIdFromVisualCoordinates = (
  visualX: number,
  visualY: number
): ZoneId => {
  if (visualY <= 20) {
    if (visualX < 35) return "sol bek";
    if (visualX > 60) return "sol aÃ§Ä±k";
    return "sol kanat";
  }

  if (visualY >= 80) {
    if (visualX < 35) return "saÄŸ bek";
    if (visualX > 60) return "saÄŸ aÃ§Ä±k";
    return "saÄŸ kanat";
  }

  if (visualX < 14) {
    return "kaleci";
  }
  if (visualX < 28) {
    return visualY <= 50 ? "stoper sol" : "stoper saÄŸ";
  }
  if (visualX < 38) {
    return "Ã¶n libero";
  }
  if (visualX < 45) {
    return visualY <= 50
      ? "defansif orta saha sol"
      : "defansif orta saha saÄŸ";
  }
  if (visualX < 58) {
    return "merkez orta saha";
  }
  if (visualX < 70) {
    return "ofansif orta saha";
  }
  if (visualX < 75) {
    return "gizli forvet";
  }
  return "santrafor";
};

export const resolveZoneIdFromCoordinates = (
  coords: Pick<PitchSlot, "x" | "y">
): ZoneId => resolveZoneIdFromVisualCoordinates(100 - coords.y, coords.x);

export const resolveSlotZoneId = (
  slot: Pick<PitchSlot, "position" | "x" | "y">
): ZoneId => {
  switch (slot.position) {
    case "GK":
      return "kaleci";
    case "LB":
      return "sol bek";
    case "RB":
      return "saÄŸ bek";
    case "CB":
      return slot.x <= 50 ? "stoper sol" : "stoper saÄŸ";
    case "LM":
      return "sol kanat";
    case "RM":
      return "saÄŸ kanat";
    case "LW":
      return "sol aÃ§Ä±k";
    case "RW":
      return "saÄŸ aÃ§Ä±k";
    case "CAM":
      return "ofansif orta saha";
    case "CM":
      if (slot.y >= 60) {
        return "Ã¶n libero";
      }
      if (slot.y >= 52) {
        return slot.x <= 50
          ? "defansif orta saha sol"
          : "defansif orta saha saÄŸ";
      }
      return "merkez orta saha";
    case "ST":
      return "santrafor";
    default:
      return resolveZoneIdFromCoordinates(slot);
  }
};

export const resolveZoneId = (slot: PitchSlot): ZoneId =>
  resolveZoneIdFromCoordinates(slot);

export const resolveFormationSlotZoneId = (
  slot: Pick<PitchSlot, "position" | "x" | "y" | "slotSource"> & {
    zoneId?: string;
  }
): ZoneId => {
  if (slot.slotSource === "manual") {
    return resolveZoneIdFromCoordinates(slot);
  }

  if (slot.slotSource === "template") {
    return resolveSlotZoneId(slot);
  }

  if (slot.zoneId) {
    return slot.zoneId as ZoneId;
  }

  return resolveSlotZoneId(slot);
};

export const getZoneDefinition = (zoneId: ZoneId): ZoneDefinition => ({
  ...ZONES[zoneId],
  label: getZoneLabel(zoneId),
});

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
  return fallbackMatch ? 0.6 : 0.3;
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
  getZoneFitLevel(player, resolveFormationSlotZoneId(slot), nearDropThreshold);

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
    .filter((entry) => entry.matchMultiplier > 0.6);

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
