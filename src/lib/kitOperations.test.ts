import { describe, expect, it } from 'vitest';

import type { Player } from '@/types';
import {
  SAFE_KIT_THRESHOLD,
  applyKitEffectToPlayer,
  buildThresholdKitPlan,
  countKitOperations,
  getApplicableKitPlayerIds,
  getKitApplicability,
  splitKitOperationsByInventory,
} from '@/lib/kitOperations';

const basePlayer = (): Player => ({
  id: 'player-1',
  name: 'Test Oyuncu',
  position: 'CM',
  roles: ['CM'],
  overall: 0.5,
  potential: 0.8,
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
  age: 22,
  height: 180,
  weight: 75,
  health: 1,
  condition: 1,
  motivation: 1,
  squadRole: 'starting',
  injuryStatus: 'healthy',
});

describe('kitOperations', () => {
  it('heals injuries to the safety minimum with health kit', () => {
    const nextPlayer = applyKitEffectToPlayer({
      ...basePlayer(),
      health: 0.25,
      injuryStatus: 'injured',
      condition: 0.2,
    }, 'health');

    expect(nextPlayer.injuryStatus).toBe('healthy');
    expect(nextPlayer.health).toBeGreaterThanOrEqual(SAFE_KIT_THRESHOLD);
    expect(nextPlayer.condition).toBeGreaterThan(0.2);
  });

  it('builds a threshold plan that prioritizes health then biggest remaining gap', () => {
    const plan = buildThresholdKitPlan({
      ...basePlayer(),
      health: 0.2,
      injuryStatus: 'injured',
      condition: 0.25,
      motivation: 0.5,
    });

    expect(plan.map(operation => operation.type)).toEqual(['health', 'energy', 'energy']);

    const simulated = plan.reduce(
      (player, operation) => applyKitEffectToPlayer(player, operation.type),
      {
        ...basePlayer(),
        health: 0.2,
        injuryStatus: 'injured' as const,
        condition: 0.25,
        motivation: 0.5,
      },
    );

    expect(simulated.health).toBeGreaterThanOrEqual(SAFE_KIT_THRESHOLD);
    expect(simulated.condition).toBeGreaterThanOrEqual(SAFE_KIT_THRESHOLD);
    expect(simulated.motivation).toBeGreaterThanOrEqual(SAFE_KIT_THRESHOLD);
  });

  it('counts and splits operations by available stock', () => {
    const operations = [
      { type: 'health', playerId: 'a' },
      { type: 'energy', playerId: 'a' },
      { type: 'energy', playerId: 'b' },
      { type: 'morale', playerId: 'c' },
    ] as const;

    expect(countKitOperations([...operations])).toEqual({
      energy: 2,
      morale: 1,
      health: 1,
    });

    expect(
      splitKitOperationsByInventory([...operations], {
        energy: 1,
        morale: 0,
        health: 1,
      }),
    ).toEqual({
      ready: [
        { type: 'health', playerId: 'a' },
        { type: 'energy', playerId: 'a' },
      ],
      pending: [
        { type: 'energy', playerId: 'b' },
        { type: 'morale', playerId: 'c' },
      ],
    });
  });

  it('marks no-op kits explicitly when the player is already full', () => {
    expect(getKitApplicability(basePlayer(), 'energy')).toMatchObject({
      canApply: false,
      reason: 'no_effect',
    });
    expect(getKitApplicability(basePlayer(), 'morale')).toMatchObject({
      canApply: false,
      reason: 'no_effect',
    });
    expect(getKitApplicability(basePlayer(), 'health')).toMatchObject({
      canApply: false,
      reason: 'no_effect',
    });
  });

  it('still allows energy kit when only motivation can improve', () => {
    expect(
      getKitApplicability(
        {
          ...basePlayer(),
          motivation: 0.8,
        },
        'energy',
      ),
    ).toMatchObject({
      canApply: true,
    });
  });

  it('still allows morale kit when only condition can improve', () => {
    expect(
      getKitApplicability(
        {
          ...basePlayer(),
          condition: 0.8,
        },
        'morale',
      ),
    ).toMatchObject({
      canApply: true,
    });
  });

  it('still allows health kit when the player is injured or health is low', () => {
    expect(
      getKitApplicability(
        {
          ...basePlayer(),
          injuryStatus: 'injured',
        },
        'health',
      ),
    ).toMatchObject({
      canApply: true,
    });

    expect(
      getKitApplicability(
        {
          ...basePlayer(),
          health: 0.7,
        },
        'health',
      ),
    ).toMatchObject({
      canApply: true,
    });
  });

  it('filters bulk selection ids down to applicable players only', () => {
    expect(
      getApplicableKitPlayerIds(
        [
          basePlayer(),
          {
            ...basePlayer(),
            id: 'player-2',
            name: 'Hazir Oyuncu',
            condition: 0.7,
          },
        ],
        'energy',
      ),
    ).toEqual(['player-2']);
  });
});
