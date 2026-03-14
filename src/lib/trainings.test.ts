import { describe, it, expect } from 'vitest';
import { trainings } from './data';
import type { Player } from '@/types';

describe('training options', () => {
  it('covers all player attributes', () => {
    const attributeKeys: (keyof Player['attributes'])[] = [
      'strength',
      'acceleration',
      'topSpeed',
      'dribbleSpeed',
      'jump',
      'tackling',
      'ballKeeping',
      'passing',
      'longBall',
      'agility',
      'shooting',
      'shootPower',
      'positioning',
      'reaction',
      'ballControl',
    ];

    const trainingTypes = trainings.map(t => t.type);
    attributeKeys.forEach(key => {
      expect(trainingTypes).toContain(key);
    });
  });
});
