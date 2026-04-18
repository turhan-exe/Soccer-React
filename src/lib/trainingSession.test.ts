import { describe, expect, it } from 'vitest';

import type { Player } from '@/types';

import { runTrainingSimulation } from './trainingSession';

const createPlayer = (attributeValue = 0.2): Player => ({
  id: 'p1',
  name: 'Test Player',
  position: 'CM',
  roles: ['CM'],
  overall: 0.2,
  potential: 0.9,
  attributes: {
    strength: attributeValue,
    acceleration: 0.2,
    topSpeed: 0.2,
    dribbleSpeed: 0.2,
    jump: 0.2,
    tackling: 0.2,
    ballKeeping: 0.2,
    passing: 0.2,
    longBall: 0.2,
    agility: 0.2,
    shooting: 0.2,
    shootPower: 0.2,
    positioning: 0.2,
    reaction: 0.2,
    ballControl: 0.2,
  },
  age: 20,
  height: 180,
  weight: 75,
  health: 1,
  condition: 1,
  motivation: 1,
  injuryStatus: 'healthy',
  squadRole: 'starting',
});

const training = {
  id: 'strength',
  name: 'Strength Training',
  type: 'strength',
  description: 'Raises strength',
  duration: 5,
} as const;

const createRng = (...values: number[]) => {
  let index = 0;
  return () => {
    const next = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return next;
  };
};

describe('runTrainingSimulation', () => {
  it('maps roll boundaries to the five growth tiers', () => {
    const player = createPlayer();
    const expectations = [
      { roll: 0.24, result: 'very_low', gain: 0.0011 },
      { roll: 0.49, result: 'low', gain: 0.00275 },
      { roll: 0.74, result: 'medium', gain: 0.0055 },
      { roll: 0.89, result: 'high', gain: 0.00825 },
      { roll: 0.9, result: 'full', gain: 0.011 },
    ] as const;

    expectations.forEach(({ roll, result, gain }) => {
      const simulation = runTrainingSimulation(
        [player],
        [training],
        createRng(0.2, roll),
      );

      expect(simulation.records[0]).toMatchObject({ result });
      expect(simulation.records[0].gain).toBeCloseTo(gain);
      expect(simulation.records[0].result).not.toBe('fail');
    });
  });

  it('does not produce fail for maxed attributes and keeps gain at zero', () => {
    const simulation = runTrainingSimulation(
      [createPlayer(1)],
      [training],
      createRng(0.2, 0.9),
    );

    expect(simulation.records[0]).toMatchObject({
      result: 'very_low',
      gain: 0,
    });
    expect(simulation.updatedPlayers[0].attributes.strength).toBe(1);
  });
});
