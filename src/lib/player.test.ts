import { expect, test } from 'vitest';
import { assignMaxStats, getPositionAttributes } from './player';
import type { Player } from '@/types';

test('assigns max stats based on roles without exceeding average', () => {
  const baseAttributes: Player['attributes'] = {
    strength: 10,
    acceleration: 10,
    topSpeed: 10,
    dribbleSpeed: 10,
    jump: 10,
    tackling: 10,
    ballKeeping: 10,
    passing: 10,
    longBall: 10,
    agility: 10,
    shooting: 10,
    shootPower: 10,
    positioning: 10,
    reaction: 10,
    ballControl: 10,
  };

  const player: Player = {
    id: 'p1',
    name: 'Test Player',
    position: 'CM',
    roles: ['CM', 'CAM'],
    overall: 10,
    potential: 100,
    attributes: baseAttributes,
    age: 20,
    height: 180,
    weight: 75,
    squadRole: 'starting',
  };

  const updated = assignMaxStats(player, 90);

  const relevant = new Set<keyof Player['attributes']>([
    ...getPositionAttributes('CM'),
    ...getPositionAttributes('CAM'),
  ]);

  relevant.forEach((attr) => {
    expect(updated.attributes[attr]).toBe(90);
  });

  // A non-relevant attribute should remain unchanged
  expect(updated.attributes.longBall).toBe(baseAttributes.longBall);

  // overall should match the maximum average for the main position
  expect(updated.overall).toBe(90);
});
