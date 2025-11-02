import { describe, expect, it } from 'vitest';

import type { Training } from '@/types';
import { calculateSessionDurationMinutes } from './trainingDuration';

const createTraining = (duration: number, overrides: Partial<Training> = {}): Training => ({
  id: `training-${duration}`,
  name: 'Test',
  type: 'strength',
  description: 'desc',
  duration,
  ...overrides,
});

describe('calculateSessionDurationMinutes', () => {
  it('returns 0 when there are no players', () => {
    const result = calculateSessionDurationMinutes({
      playersCount: 0,
      trainings: [createTraining(5)],
      vipDurationMultiplier: 1,
    });

    expect(result).toBe(0);
  });

  it('returns 0 when there are no trainings', () => {
    const result = calculateSessionDurationMinutes({
      playersCount: 1,
      trainings: [],
      vipDurationMultiplier: 1,
    });

    expect(result).toBe(0);
  });

  it('sums training durations for a single player session', () => {
    const result = calculateSessionDurationMinutes({
      playersCount: 1,
      trainings: [createTraining(5), createTraining(7)],
      vipDurationMultiplier: 1,
    });

    expect(result).toBe(12);
  });

  it('rounds the vip duration multiplier result', () => {
    const result = calculateSessionDurationMinutes({
      playersCount: 1,
      trainings: [createTraining(5)],
      vipDurationMultiplier: 0.5,
    });

    expect(result).toBe(3);
  });

  it('never returns less than 1 minute when trainings exist', () => {
    const result = calculateSessionDurationMinutes({
      playersCount: 1,
      trainings: [createTraining(1)],
      vipDurationMultiplier: 0.01,
    });

    expect(result).toBe(1);
  });

  it('ignores negative or invalid training durations', () => {
    const result = calculateSessionDurationMinutes({
      playersCount: 1,
      trainings: [
        createTraining(-5),
        createTraining(NaN as unknown as number),
        createTraining(10),
      ],
      vipDurationMultiplier: 1,
    });

    expect(result).toBe(10);
  });
});
