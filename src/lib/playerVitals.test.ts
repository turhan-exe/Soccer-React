import { describe, expect, it } from 'vitest';
import type { Player } from '@/types';
import {
  applyTrainingVitalsLoss,
  normalizePlayerVitals,
  resolvePlayerHealth,
} from './playerVitals';

const createPlayer = (overrides: Partial<Player> = {}): Player => ({
  id: 'p1',
  name: 'Vitals Test',
  position: 'CM',
  roles: ['CM'],
  overall: 0.72,
  potential: 0.88,
  attributes: {
    strength: 0.7,
    acceleration: 0.7,
    topSpeed: 0.7,
    dribbleSpeed: 0.7,
    jump: 0.7,
    tackling: 0.7,
    ballKeeping: 0.7,
    passing: 0.7,
    longBall: 0.7,
    agility: 0.7,
    shooting: 0.7,
    shootPower: 0.7,
    positioning: 0.7,
    reaction: 0.7,
    ballControl: 0.7,
  },
  age: 24,
  height: 180,
  weight: 75,
  health: 1,
  condition: 0.8,
  motivation: 0.8,
  injuryStatus: 'healthy',
  squadRole: 'starting',
  ...overrides,
});

describe('playerVitals', () => {
  it('defaults missing health from injury status', () => {
    expect(resolvePlayerHealth(undefined, 'healthy')).toBe(1);
    expect(resolvePlayerHealth(undefined, 'injured')).toBe(0.5);
  });

  it('normalizes legacy players with missing health', () => {
    const player = createPlayer({ health: undefined as never, injuryStatus: 'injured' });
    const normalized = normalizePlayerVitals(player);

    expect(normalized.health).toBe(0.5);
    expect(normalized.injuryStatus).toBe('injured');
  });

  it('applies fixed training losses once per player', () => {
    const updated = applyTrainingVitalsLoss(createPlayer());

    expect(updated.condition).toBe(0.72);
    expect(updated.health).toBe(0.97);
  });
});
