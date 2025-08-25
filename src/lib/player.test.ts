import { expect, test } from 'vitest';
import { assignMaxStats, getPositionAttributes } from './player';
import type { Player } from '@/types';

test('assigns max stats based on roles without exceeding potential', () => {
  const baseAttributes: Player['attributes'] = {
    strength: 0.1,
    acceleration: 0.1,
    topSpeed: 0.1,
    dribbleSpeed: 0.1,
    jump: 0.1,
    tackling: 0.1,
    ballKeeping: 0.1,
    passing: 0.1,
    longBall: 0.1,
    agility: 0.1,
    shooting: 0.1,
    shootPower: 0.1,
    positioning: 0.1,
    reaction: 0.1,
    ballControl: 0.1,
  };

  const player: Player = {
    id: 'p1',
    name: 'Test Player',
    position: 'CM',
    roles: ['CM', 'CAM'],
    overall: 0.1,
    potential: 0.9,
    attributes: baseAttributes,
    age: 20,
    height: 180,
    weight: 75,
    squadRole: 'starting',
  };

  const updated = assignMaxStats(player);

  const relevant = new Set<keyof Player['attributes']>([
    ...getPositionAttributes('CM'),
    ...getPositionAttributes('CAM'),
  ]);

  relevant.forEach((attr) => {
    expect(updated.attributes[attr]).toBe(0.9);
  });

  // A non-relevant attribute should remain unchanged
  expect(updated.attributes.longBall).toBe(baseAttributes.longBall);

  // overall should match the player's potential for the main position
  expect(updated.overall).toBe(0.9);
});
