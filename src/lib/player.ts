import type { Player } from '@/types';

const POSITION_ATTRIBUTES: Record<Player['position'], (keyof Player['attributes'])[]> = {
  GK: ['positioning', 'reaction', 'longBall', 'strength', 'jump'],
  CB: ['strength', 'tackling', 'jump', 'positioning', 'reaction'],
  LB: ['acceleration', 'topSpeed', 'tackling', 'passing', 'agility'],
  RB: ['acceleration', 'topSpeed', 'tackling', 'passing', 'agility'],
  CM: ['passing', 'ballControl', 'ballKeeping', 'agility', 'reaction'],
  LM: ['acceleration', 'topSpeed', 'dribbleSpeed', 'passing', 'ballControl'],
  RM: ['acceleration', 'topSpeed', 'dribbleSpeed', 'passing', 'ballControl'],
  CAM: ['passing', 'ballControl', 'shooting', 'agility', 'reaction'],
  LW: ['topSpeed', 'dribbleSpeed', 'shooting', 'ballControl', 'passing'],
  RW: ['topSpeed', 'dribbleSpeed', 'shooting', 'ballControl', 'passing'],
  ST: ['shooting', 'shootPower', 'positioning', 'strength', 'topSpeed'],
};

export function getPositionAttributes(
  position: Player['position']
): (keyof Player['attributes'])[] {
  return POSITION_ATTRIBUTES[position];
}

export function calculateOverall(
  position: Player['position'],
  attributes: Player['attributes']
): number {
  const keys = getPositionAttributes(position);
  const total = keys.reduce((sum, key) => sum + attributes[key], 0);
  return parseFloat((total / keys.length).toFixed(3));
}

const POSITION_ROLES: Record<Player['position'], Player['position'][]> = {
  GK: ['GK'],
  CB: ['CB'],
  LB: ['LB', 'LM'],
  RB: ['RB', 'RM'],
  CM: ['CM', 'CAM'],
  LM: ['LM', 'LW'],
  RM: ['RM', 'RW'],
  CAM: ['CAM', 'CM'],
  LW: ['LW', 'LM', 'ST'],
  RW: ['RW', 'RM', 'ST'],
  ST: ['ST', 'CAM'],
};

export function getRoles(position: Player['position']): Player['position'][] {
  return POSITION_ROLES[position] || [position];
}

/**
 * Sets a player's role-specific attributes to their maximum allowed value
 * without exceeding the player's maximum overall rating.
 *
 * `maxOverall` defaults to the player's potential and represents the highest
 * rating the player can reach. Each relevant attribute is set to this value,
 * ensuring no attribute surpasses the maximum overall.
 */
export function assignMaxStats(
  player: Player,
  maxOverall = player.potential,
): Player {
  const attributes = { ...player.attributes };

  // Determine unique attributes across all playable roles
  const relevant = new Set<keyof Player['attributes']>();
  player.roles.forEach((role) => {
    getPositionAttributes(role).forEach((attr) => relevant.add(attr));
  });

  const cap = Math.min(maxOverall, player.potential);

  // Assign the capped value to all relevant attributes
  relevant.forEach((attr) => {
    attributes[attr] = cap;
  });

  return {
    ...player,
    attributes,
    overall: calculateOverall(player.position, attributes),
  };
}

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

export function calculatePowerIndex(player: Player): number {
  const condition = clamp01(player.condition ?? 0.75);
  const motivation = clamp01(player.motivation ?? 0.75);
  const physical = (player.attributes.strength + player.attributes.shootPower + player.attributes.topSpeed) / 3;
  const technical = (player.attributes.ballControl + player.attributes.passing + player.attributes.agility) / 3;

  let effectivePhysical = physical;
  let effectiveTechnical = technical;

  if (physical < 1 && technical < 1) {
    effectivePhysical = player.overall;
    effectiveTechnical = player.overall;
  }

  const baseRating = (player.overall + effectivePhysical + effectiveTechnical + condition + motivation) / 5;
  const injuryPenalty = player.injuryStatus === 'injured' ? 0.1 : 0;
  const adjusted = Math.max(0, baseRating - injuryPenalty);
  return parseFloat(adjusted.toFixed(3));
}

const RATING_THRESHOLD_LOW = 2.0;
const RATING_THRESHOLD_MEDIUM = 10.0;

const normalizeRawRating = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= RATING_THRESHOLD_LOW) {
    return value * 100;
  }
  if (value <= RATING_THRESHOLD_MEDIUM) {
    return value * 10;
  }
  return value;
};

export const normalizeRatingTo100 = (value?: number | null): number => {
  if (typeof value !== 'number') {
    return 0;
  }
  const normalized = Math.round(normalizeRawRating(value));
  return Math.max(0, Math.min(99, normalized));
};

export const formatRatingLabel = (value?: number | null): string => {
  const rating = normalizeRatingTo100(value);
  return rating.toString();
};

export const normalizeRatingTo100OrNull = (value?: number | null): number | null => {
  if (typeof value !== 'number') {
    return null;
  }
  return normalizeRatingTo100(value);
};

