import type { Player } from '@/types';
import { canonicalPosition } from './teamPlanningUtils';
import type { DisplayPlayer } from './teamPlanningUtils';
import type { PitchSlot } from './Pitch';
import type { SkillTag } from './skillTags';

export type ZoneId =
  | 'santrafor'
  | 'gizli forvet'
  | 'sol açık'
  | 'sağ açık'
  | 'sol kanat'
  | 'sağ kanat'
  | 'ofansif orta saha'
  | 'merkez orta saha'
  | 'defansif orta saha sol'
  | 'defansif orta saha sağ'
  | 'ön libero'
  | 'sol bek'
  | 'sağ bek'
  | 'stoper sol'
  | 'stoper sağ'
  | 'kaleci';

export type ZoneDefinition = {
  id: ZoneId;
  label: string;
  slotPosition: Player['position'];
  capabilityTags: SkillTag[];
  fallbackPositions?: Player['position'][];
};

export const ZONES: Record<ZoneId, ZoneDefinition> = {
  santrafor: {
    id: 'santrafor',
    label: 'santrafor',
    slotPosition: 'ST',
    capabilityTags: ['finishing', 'aerial', 'holdUp'],
    fallbackPositions: ['CAM'],
  },
  'gizli forvet': {
    id: 'gizli forvet',
    label: 'gizli forvet',
    slotPosition: 'CAM',
    capabilityTags: ['finishing', 'offBall', 'linkPlay'],
    fallbackPositions: ['ST'],
  },
  'sol açık': {
    id: 'sol açık',
    label: 'sol açık',
    slotPosition: 'LW',
    capabilityTags: ['pace', 'dribbling', 'crossing'],
    fallbackPositions: ['LM'],
  },
  'sağ açık': {
    id: 'sağ açık',
    label: 'sağ açık',
    slotPosition: 'RW',
    capabilityTags: ['pace', 'dribbling', 'crossing'],
    fallbackPositions: ['RM'],
  },
  'sol kanat': {
    id: 'sol kanat',
    label: 'sol kanat',
    slotPosition: 'LM',
    capabilityTags: ['workRate', 'support', 'crossing'],
    fallbackPositions: ['LW', 'LB'],
  },
  'sağ kanat': {
    id: 'sağ kanat',
    label: 'sağ kanat',
    slotPosition: 'RM',
    capabilityTags: ['workRate', 'support', 'crossing'],
    fallbackPositions: ['RW', 'RB'],
  },
  'ofansif orta saha': {
    id: 'ofansif orta saha',
    label: 'ofansif orta saha',
    slotPosition: 'CAM',
    capabilityTags: ['vision', 'passing', 'longShots'],
    fallbackPositions: ['CM'],
  },
  'merkez orta saha': {
    id: 'merkez orta saha',
    label: 'merkez orta saha',
    slotPosition: 'CM',
    capabilityTags: ['boxToBox', 'passing', 'support'],
  },
  'defansif orta saha sol': {
    id: 'defansif orta saha sol',
    label: 'defansif orta saha',
    slotPosition: 'CM',
    capabilityTags: ['ballWinning', 'pressResist', 'shortPassing'],
  },
  'defansif orta saha sağ': {
    id: 'defansif orta saha sağ',
    label: 'defansif orta saha',
    slotPosition: 'CM',
    capabilityTags: ['ballWinning', 'pressResist', 'shortPassing'],
  },
  'ön libero': {
    id: 'ön libero',
    label: 'ön libero',
    slotPosition: 'CM',
    capabilityTags: ['shielding', 'distribution', 'sweeper'],
  },
  'sol bek': {
    id: 'sol bek',
    label: 'sol bek',
    slotPosition: 'LB',
    capabilityTags: ['tackling', 'crossing', 'workRate'],
  },
  'sağ bek': {
    id: 'sağ bek',
    label: 'sağ bek',
    slotPosition: 'RB',
    capabilityTags: ['tackling', 'crossing', 'workRate'],
  },
  'stoper sol': {
    id: 'stoper sol',
    label: 'stoper',
    slotPosition: 'CB',
    capabilityTags: ['tackling', 'aerial', 'positioning'],
  },
  'stoper sağ': {
    id: 'stoper sağ',
    label: 'stoper',
    slotPosition: 'CB',
    capabilityTags: ['tackling', 'aerial', 'positioning'],
  },
  kaleci: {
    id: 'kaleci',
    label: 'kaleci',
    slotPosition: 'GK',
    capabilityTags: ['shotStopping', 'distribution'],
  },
};

const isLeftHalf = (slot: PitchSlot): boolean => slot.x <= 50;

export const resolveZoneId = (slot: PitchSlot): ZoneId => {
  const position = canonicalPosition(slot.position);
  if (position === 'GK') {
    return 'kaleci';
  }
  if (position === 'CB') {
    return isLeftHalf(slot) ? 'stoper sol' : 'stoper sağ';
  }
  if (position === 'LB') {
    return 'sol bek';
  }
  if (position === 'RB') {
    return 'sağ bek';
  }
  if (position === 'CM') {
    if (slot.y <= 42) {
      return 'merkez orta saha';
    }
    if (slot.y <= 58) {
      return isLeftHalf(slot) ? 'defansif orta saha sol' : 'defansif orta saha sağ';
    }
    return 'ön libero';
  }
  if (position === 'CAM') {
    return slot.y <= 32 ? 'gizli forvet' : 'ofansif orta saha';
  }
  if (position === 'ST') {
    return 'santrafor';
  }
  if (position === 'LW' || position === 'LM') {
    return slot.y <= 35 ? 'sol açık' : 'sol kanat';
  }
  if (position === 'RW' || position === 'RM') {
    return slot.y <= 35 ? 'sağ açık' : 'sağ kanat';
  }
  return 'merkez orta saha';
};

export const getZoneDefinition = (zoneId: ZoneId): ZoneDefinition => ZONES[zoneId];

type RecommendationOptions = {
  excludeIds?: string[];
  limit?: number;
  allowStarters?: boolean;
};

const getZonePositions = (zone: ZoneDefinition): Player['position'][] => {
  const fallbacks = zone.fallbackPositions ?? [];
  return [zone.slotPosition, ...fallbacks];
};

const positionAffinity = (player: DisplayPlayer, zone: ZoneDefinition): number => {
  const canonicalAssigned = canonicalPosition(player.position);
  if (canonicalAssigned === zone.slotPosition) {
    return 1.2;
  }
  if ((player.roles ?? []).some(role => canonicalPosition(role) === zone.slotPosition)) {
    return 1.1;
  }
  const fallbackMatch = getZonePositions(zone).some(
    pos =>
      canonicalAssigned === canonicalPosition(pos) ||
      (player.roles ?? []).some(role => canonicalPosition(role) === canonicalPosition(pos)),
  );
  return fallbackMatch ? 0.95 : 0.8;
};

const skillScoreForZone = (player: DisplayPlayer, zone: ZoneDefinition): number => {
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
  options: RecommendationOptions = {},
): DisplayPlayer[] => {
  const zone = getZoneDefinition(zoneId);
  const exclude = new Set(options.excludeIds ?? []);
  const allowStarters = options.allowStarters ?? false;

  const pool = players.filter(player => {
    if (exclude.has(player.id)) {
      return false;
    }
    if (!allowStarters && player.squadRole === 'starting') {
      return false;
    }
    return true;
  });

  const scored = pool.map(player => {
    const skillScore = skillScoreForZone(player, zone);
    const matchMultiplier = positionAffinity(player, zone);
    const totalScore = skillScore * matchMultiplier;
    return { player, score: totalScore };
  });

  scored.sort((a, b) => b.score - a.score || b.player.overall - a.player.overall);

  const limit = options.limit ?? 6;
  return scored.slice(0, limit).map(entry => entry.player);
};
