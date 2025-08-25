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
 * Assigns maximum attribute values for the roles a player can perform while
 * ensuring the average of those attributes does not exceed the provided
 * `maxAverage`.
 *
 * The function sets all attributes relevant to the player's roles to
 * `maxValue` (defaults to 100). If the average of these attributes is higher
 * than `maxAverage`, they are scaled down proportionally.
 *
 * If `maxAverage` is not supplied, the player's current overall for their main
 * position is used. This guarantees that overall ratings are calculated based
 * on the player's position before applying the maximum stats.
 */
export function assignMaxStats(
  player: Player,
  maxAverage = calculateOverall(player.position, player.attributes),
  maxValue = 100,
): Player {
  const attributes = { ...player.attributes };

  // Determine unique attributes across all playable roles
  const relevant = new Set<keyof Player['attributes']>();
  player.roles.forEach((role) => {
    getPositionAttributes(role).forEach((attr) => relevant.add(attr));
  });

  // Assign the max value to all relevant attributes
  relevant.forEach((attr) => {
    attributes[attr] = maxValue;
  });

  // Scale down if the average exceeds the allowed maximum
  const total = Array.from(relevant).reduce((sum, attr) => sum + attributes[attr], 0);
  const avg = total / relevant.size;
  if (avg > maxAverage) {
    const scale = maxAverage / avg;
    relevant.forEach((attr) => {
      attributes[attr] = parseFloat((attributes[attr] * scale).toFixed(3));
    });
  }

  return {
    ...player,
    attributes,
    overall: calculateOverall(player.position, attributes),
  };
}
