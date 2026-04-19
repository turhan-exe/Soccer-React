import { KIT_CONFIG } from '@/lib/kits';
import {
  DEFAULT_VITAL_GAUGE,
  HEALTH_KIT_MINIMUM_AFTER_HEAL,
  clampVitalGauge,
  resolvePlayerHealth,
} from '@/lib/playerVitals';
import type { KitType, Player } from '@/types';
import type { KitInventory } from '@/services/inventory';

export type KitOperation = {
  type: KitType;
  playerId: string;
};

export type KitOperationSkipReason = 'no_effect';

export type KitApplicabilityResult = {
  nextPlayer: Player;
  canApply: boolean;
  reason?: KitOperationSkipReason;
};

export const SAFE_KIT_THRESHOLD = 0.6;

const readGauge = (value: number | undefined | null): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampVitalGauge(value, DEFAULT_VITAL_GAUGE);
  }
  return DEFAULT_VITAL_GAUGE;
};

export const applyKitEffectToPlayer = (player: Player, type: KitType): Player => {
  const config = KIT_CONFIG[type];
  const currentHealth = resolvePlayerHealth(player.health, player.injuryStatus);
  const nextHealth =
    config.healsInjury
      ? Math.max(
          HEALTH_KIT_MINIMUM_AFTER_HEAL,
          clampVitalGauge(currentHealth + config.healthDelta, 1),
        )
      : clampVitalGauge(currentHealth + config.healthDelta, 1);

  return {
    ...player,
    health: nextHealth,
    condition: clampVitalGauge(readGauge(player.condition) + config.conditionDelta),
    motivation: clampVitalGauge(readGauge(player.motivation) + config.motivationDelta),
    injuryStatus: config.healsInjury ? 'healthy' : player.injuryStatus ?? 'healthy',
  };
};

const hasKitEffect = (player: Player, nextPlayer: Player): boolean =>
  nextPlayer.health !== player.health
  || nextPlayer.condition !== player.condition
  || nextPlayer.motivation !== player.motivation
  || (nextPlayer.injuryStatus ?? 'healthy') !== (player.injuryStatus ?? 'healthy');

export const getKitApplicability = (
  player: Player,
  type: KitType,
): KitApplicabilityResult => {
  const nextPlayer = applyKitEffectToPlayer(player, type);
  if (!hasKitEffect(player, nextPlayer)) {
    return {
      nextPlayer,
      canApply: false,
      reason: 'no_effect',
    };
  }

  return {
    nextPlayer,
    canApply: true,
  };
};

export const getApplicableKitPlayerIds = (
  players: Player[],
  type: KitType,
): string[] =>
  players
    .filter((player) => getKitApplicability(player, type).canApply)
    .map((player) => String(player.id));

export const buildThresholdKitPlan = (
  player: Player,
  threshold = SAFE_KIT_THRESHOLD,
): KitOperation[] => {
  const operations: KitOperation[] = [];
  let simulated = { ...player };
  let guard = 0;

  while (guard < 24) {
    guard += 1;

    const currentHealth = resolvePlayerHealth(simulated.health, simulated.injuryStatus);
    const currentCondition = readGauge(simulated.condition);
    const currentMotivation = readGauge(simulated.motivation);

    const needsHealth = simulated.injuryStatus === 'injured' || currentHealth < threshold;
    const needsCondition = currentCondition < threshold;
    const needsMotivation = currentMotivation < threshold;

    if (!needsHealth && !needsCondition && !needsMotivation) {
      break;
    }

    let nextType: KitType;

    if (needsHealth) {
      nextType = 'health';
    } else {
      const conditionGap = threshold - currentCondition;
      const motivationGap = threshold - currentMotivation;
      nextType = conditionGap >= motivationGap ? 'energy' : 'morale';
    }

    operations.push({
      type: nextType,
      playerId: player.id,
    });
    const application = getKitApplicability(simulated, nextType);
    if (!application.canApply) {
      break;
    }
    simulated = application.nextPlayer;
  }

  return operations;
};

export const countKitOperations = (
  operations: KitOperation[],
): Record<KitType, number> =>
  operations.reduce<Record<KitType, number>>(
    (accumulator, operation) => ({
      ...accumulator,
      [operation.type]: accumulator[operation.type] + 1,
    }),
    {
      energy: 0,
      morale: 0,
      health: 0,
    },
  );

export const splitKitOperationsByInventory = (
  operations: KitOperation[],
  kits: KitInventory,
): { ready: KitOperation[]; pending: KitOperation[] } => {
  const remaining = {
    energy: Math.max(0, Math.floor(kits.energy ?? 0)),
    morale: Math.max(0, Math.floor(kits.morale ?? 0)),
    health: Math.max(0, Math.floor(kits.health ?? 0)),
  };
  const ready: KitOperation[] = [];
  const pending: KitOperation[] = [];

  operations.forEach((operation) => {
    if (remaining[operation.type] > 0) {
      remaining[operation.type] -= 1;
      ready.push(operation);
      return;
    }
    pending.push(operation);
  });

  return { ready, pending };
};
