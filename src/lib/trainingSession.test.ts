import { describe, expect, it } from 'vitest';

import type { Player, Training } from '@/types';
import { runTrainingSimulation } from './trainingSession';

const createPlayer = (): Player => ({
  id: 'player-1',
  name: 'Test Oyuncu',
  position: 'CM',
  roles: ['CM'],
  overall: 0.5,
  potential: 0.9,
  attributes: {
    strength: 0.5,
    acceleration: 0.5,
    topSpeed: 0.5,
    dribbleSpeed: 0.5,
    jump: 0.5,
    tackling: 0.5,
    ballKeeping: 0.5,
    passing: 0.5,
    longBall: 0.5,
    agility: 0.5,
    shooting: 0.5,
    shootPower: 0.5,
    positioning: 0.5,
    reaction: 0.5,
    ballControl: 0.5,
  },
  age: 24,
  height: 180,
  weight: 75,
  health: 1,
  condition: 1,
  motivation: 1,
  squadRole: 'starting',
  injuryStatus: 'healthy',
});

const createTraining = (id: string): Training => ({
  id,
  name: `Training ${id}`,
  type: 'passing',
  description: 'desc',
  duration: 5,
});

const createSequenceRng = (...values: number[]) => {
  let index = 0;
  return () => {
    const next = values[index];
    index += 1;
    return next ?? 0;
  };
};

describe('runTrainingSimulation', () => {
  it('applies the new 6-tier outcome table', () => {
    const player = createPlayer();
    const trainings = [
      createTraining('fail'),
      createTraining('very-low'),
      createTraining('low'),
      createTraining('medium'),
      createTraining('high'),
      createTraining('full'),
    ];
    const rng = createSequenceRng(
      0, 0.00,
      0, 0.02,
      0, 0.30,
      0, 0.60,
      0, 0.80,
      0, 0.95,
    );

    const { records } = runTrainingSimulation([player], trainings, rng);

    expect(records.map(record => record.result)).toEqual([
      'fail',
      'very_low',
      'low',
      'medium',
      'high',
      'full',
    ]);
    expect(records[0].gain).toBe(0);
    expect(records[1].gain).toBeCloseTo(0.0005, 8);
    expect(records[2].gain).toBeCloseTo(0.00125, 8);
    expect(records[3].gain).toBeCloseTo(0.0025, 8);
    expect(records[4].gain).toBeCloseTo(0.00375, 8);
    expect(records[5].gain).toBeCloseTo(0.005, 8);
  });
});
