import { describe, expect, it } from 'vitest';

import type { Training } from '@/types';
import {
  calculatePlayerLoadMultiplier,
  calculateSessionDurationMinutes,
} from './trainingDuration';

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

  it('increases duration for larger player groups without scaling linearly', () => {
    const singlePlayerDuration = calculateSessionDurationMinutes({
      playersCount: 1,
      trainings: [createTraining(5), createTraining(7)],
      vipDurationMultiplier: 1,
    });
    const tenPlayerDuration = calculateSessionDurationMinutes({
      playersCount: 10,
      trainings: [createTraining(5), createTraining(7)],
      vipDurationMultiplier: 1,
    });

    expect(singlePlayerDuration).toBe(12);
    expect(tenPlayerDuration).toBe(25);
    expect(tenPlayerDuration).toBeGreaterThan(singlePlayerDuration);
    expect(tenPlayerDuration).toBeLessThan(singlePlayerDuration * 10);
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

  it('returns a sublinear player load multiplier', () => {
    expect(calculatePlayerLoadMultiplier(0)).toBe(0);
    expect(calculatePlayerLoadMultiplier(1)).toBe(1);
    expect(calculatePlayerLoadMultiplier(4)).toBe(1.606);
    expect(calculatePlayerLoadMultiplier(10)).toBe(2.05);
  });
});
