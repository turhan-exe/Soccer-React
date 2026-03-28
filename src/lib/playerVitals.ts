import type { InjuryStatus, Player, PlayerMotivationState } from '@/types';

export const DEFAULT_VITAL_GAUGE = 0.75;
export const DEFAULT_HEALTHY_HEALTH = 1;
export const DEFAULT_INJURED_HEALTH = 0.5;
export const TRAINING_CONDITION_LOSS = 0.08;
export const TRAINING_HEALTH_LOSS = 0.03;
export const UNDERPAID_SALARY_THRESHOLD = 0.7;
export const UNDERPAID_SALARY_RECOVERY_THRESHOLD = 0.85;
export const UNDERPAID_MOTIVATION_PENALTY = 0.05;
export const HEALTH_KIT_MINIMUM_AFTER_HEAL = 0.6;

export const clampVitalGauge = (
  value: unknown,
  fallback = DEFAULT_VITAL_GAUGE,
): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const clamped = Math.max(0, Math.min(1, numeric));
  return Number(clamped.toFixed(3));
};

export const normalizeInjuryStatus = (value: unknown): InjuryStatus =>
  value === 'injured' ? 'injured' : 'healthy';

export const resolvePlayerHealth = (
  health: unknown,
  injuryStatus?: InjuryStatus | null,
): number => {
  const numeric = typeof health === 'number' ? health : Number(health);
  if (Number.isFinite(numeric)) {
    return clampVitalGauge(numeric, DEFAULT_HEALTHY_HEALTH);
  }
  return injuryStatus === 'injured'
    ? DEFAULT_INJURED_HEALTH
    : DEFAULT_HEALTHY_HEALTH;
};

export const toGaugePercentage = (
  value: unknown,
  fallback = DEFAULT_VITAL_GAUGE,
): number => Math.round(clampVitalGauge(value, fallback) * 100);

export const normalizeMotivationState = (
  value: unknown,
): PlayerMotivationState | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as PlayerMotivationState;
  const next: PlayerMotivationState = {};

  if (typeof candidate.underpaidActive === 'boolean') {
    next.underpaidActive = candidate.underpaidActive;
  }

  if (
    typeof candidate.underpaidLastAppliedMonth === 'string' &&
    candidate.underpaidLastAppliedMonth.trim().length > 0
  ) {
    next.underpaidLastAppliedMonth = candidate.underpaidLastAppliedMonth.trim();
  }

  return Object.keys(next).length > 0 ? next : undefined;
};

export const normalizePlayerVitals = (player: Player): Player => {
  const injuryStatus = normalizeInjuryStatus(player.injuryStatus);
  const motivationState = normalizeMotivationState(player.motivationState);

  return {
    ...player,
    health: resolvePlayerHealth(player.health, injuryStatus),
    condition: clampVitalGauge(player.condition),
    motivation: clampVitalGauge(player.motivation),
    injuryStatus,
    motivationState,
  };
};

export const normalizeTeamPlayers = (players: Player[]): Player[] => {
  let starters = 0;

  return players.map((player) => {
    const normalized = normalizePlayerVitals(player);
    if (normalized.squadRole !== 'starting') {
      return normalized;
    }

    starters += 1;
    if (starters <= 11) {
      return normalized;
    }

    return {
      ...normalized,
      squadRole: 'bench',
    };
  });
};

export const applyTrainingVitalsLoss = (
  player: Player,
  options?: {
    conditionLoss?: number;
    healthLoss?: number;
  },
): Player => {
  const normalized = normalizePlayerVitals(player);
  const conditionLoss = options?.conditionLoss ?? TRAINING_CONDITION_LOSS;
  const healthLoss = options?.healthLoss ?? TRAINING_HEALTH_LOSS;

  return {
    ...normalized,
    condition: clampVitalGauge(normalized.condition - conditionLoss),
    health: clampVitalGauge(
      normalized.health - healthLoss,
      DEFAULT_HEALTHY_HEALTH,
    ),
  };
};
