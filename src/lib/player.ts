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

export function calculateOverall(position: Player['position'], attributes: Player['attributes']): number {
  const keys = POSITION_ATTRIBUTES[position];
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
