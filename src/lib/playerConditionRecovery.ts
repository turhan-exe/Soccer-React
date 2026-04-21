import type { ConditionRecoveryPendingToast } from '@/types';

export const CONDITION_RECOVERY_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const CONDITION_RECOVERY_STEP = 0.02;
export const MOTIVATION_RECOVERY_STEP = 0.015;
export const HEALTH_RECOVERY_STEP = 0.01;
export const CONDITION_RECOVERY_TRIGGER_COOLDOWN_MS = 1500;

type ConditionRecoveryTriggerState = {
  inFlight?: boolean;
  lastRunAtMs?: number | null;
  lastUserId?: string | null;
};

type ConditionRecoveryTriggerInput = {
  userId: string;
  nowMs: number;
};

const roundToSingleDecimal = (value: number): number =>
  Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;

type ConditionRecoveryAverageGainPercents = {
  condition: number;
  motivation: number;
  health: number;
};

export const createConditionRecoveryDueAt = (nowMs = Date.now()): string =>
  new Date(nowMs + CONDITION_RECOVERY_INTERVAL_MS).toISOString();

export const readConditionRecoveryToastAverageGainPct = (
  pendingToast?: ConditionRecoveryPendingToast | null,
): number => {
  return readConditionRecoveryToastAverageGainPercents(pendingToast).condition;
};

export const readConditionRecoveryToastAverageGainPercents = (
  pendingToast?: ConditionRecoveryPendingToast | null,
): ConditionRecoveryAverageGainPercents => {
  if (!pendingToast) {
    return {
      condition: 0,
      motivation: 0,
      health: 0,
    };
  }

  const totalPlayers = Number.isFinite(pendingToast.totalPlayers)
    ? Number(pendingToast.totalPlayers)
    : 0;
  const conditionGain = Number.isFinite(pendingToast.conditionGain)
    ? Number(pendingToast.conditionGain)
    : Number.isFinite(pendingToast.totalGain)
      ? Number(pendingToast.totalGain)
      : 0;
  const motivationGain = Number.isFinite(pendingToast.motivationGain)
    ? Number(pendingToast.motivationGain)
    : 0;
  const healthGain = Number.isFinite(pendingToast.healthGain)
    ? Number(pendingToast.healthGain)
    : 0;

  if (totalPlayers <= 0) {
    return {
      condition: 0,
      motivation: 0,
      health: 0,
    };
  }

  return {
    condition:
      conditionGain > 0 ? roundToSingleDecimal((conditionGain / totalPlayers) * 100) : 0,
    motivation:
      motivationGain > 0 ? roundToSingleDecimal((motivationGain / totalPlayers) * 100) : 0,
    health:
      healthGain > 0 ? roundToSingleDecimal((healthGain / totalPlayers) * 100) : 0,
  };
};

export const formatConditionRecoveryGainPercent = (value: number): string => {
  const rounded = roundToSingleDecimal(Math.max(0, value));

  if (Number.isInteger(rounded)) {
    return String(rounded);
  }

  return rounded.toFixed(1).replace('.', ',');
};

export const shouldSkipConditionRecoveryTrigger = (
  state: ConditionRecoveryTriggerState,
  input: ConditionRecoveryTriggerInput,
): boolean => {
  if (state.inFlight) {
    return true;
  }

  const lastRunAtMs =
    typeof state.lastRunAtMs === 'number' && Number.isFinite(state.lastRunAtMs)
      ? state.lastRunAtMs
      : null;

  if (lastRunAtMs === null) {
    return false;
  }

  if (state.lastUserId !== input.userId) {
    return false;
  }

  return input.nowMs - lastRunAtMs < CONDITION_RECOVERY_TRIGGER_COOLDOWN_MS;
};
