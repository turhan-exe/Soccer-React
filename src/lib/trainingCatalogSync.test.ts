import { describe, expect, it } from 'vitest';

import { trainings } from './data';
import { resolveTrainingDefinitions } from '../functions/src/notify/trainingRuntime';

describe('training catalog sync', () => {
  it('allows the functions runtime to resolve every frontend training id', () => {
    const unresolved = trainings.filter(
      training => resolveTrainingDefinitions([training.id]).length !== 1,
    );

    expect(unresolved).toEqual([]);
  });

  it('keeps legacy kebab-case ids valid for already-persisted sessions', () => {
    const resolved = resolveTrainingDefinitions([
      'top-speed',
      'ball-control',
      'long-ball',
      'ball-keeping',
      'shoot-power',
      'dribble-speed',
    ]);

    expect(resolved.map(training => training.id)).toEqual([
      'topSpeed',
      'ballControl',
      'longBall',
      'ballKeeping',
      'shootPower',
      'dribbleSpeed',
    ]);
  });
});
