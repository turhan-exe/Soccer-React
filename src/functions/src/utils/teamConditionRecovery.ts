const DEFAULT_VITAL_GAUGE = 0.75;
export const CONDITION_RECOVERY_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_HEALTHY_HEALTH = 1;
const DEFAULT_INJURED_HEALTH = 0.5;
export const CONDITION_RECOVERY_STEP = 0.02;
export const MOTIVATION_RECOVERY_STEP = 0.015;
export const HEALTH_RECOVERY_STEP = 0.01;

export type ConditionRecoveryPendingToast = {
  conditionGain?: number;
  motivationGain?: number;
  healthGain?: number;
  totalGain?: number;
  totalPlayers: number;
  affectedPlayers: number;
  appliedTicks: number;
  updatedAt: string;
};

type ResolveConditionRecoveryDueAtInput = {
  dueAt?: unknown;
  legacyRecoveryAt?: unknown;
  nowMs: number;
};

type ApplyScheduledConditionRecoveryInput = {
  players: Record<string, unknown>[];
  dueAt: string;
  nowMs: number;
  pendingToast?: ConditionRecoveryPendingToast | null;
};

export type ResolveConditionRecoveryDueAtResult = {
  dueAt: string;
  source: 'due' | 'legacy' | 'seeded';
};

export type ApplyScheduledConditionRecoveryResult = {
  players: Record<string, unknown>[];
  changed: boolean;
  appliedTicks: number;
  conditionGain: number;
  motivationGain: number;
  healthGain: number;
  totalPlayers: number;
  affectedPlayers: number;
  nextDueAt: string;
  pendingToast: ConditionRecoveryPendingToast | null;
};

const roundGaugeValue = (value: number): number => Number(value.toFixed(3));

const clampGauge = (value: unknown, fallback = DEFAULT_VITAL_GAUGE): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, Number(numeric.toFixed(3))));
};

const clampHealthGauge = (
  value: unknown,
  injuryStatus: unknown,
): number =>
  clampGauge(
    value,
    injuryStatus === 'injured' ? DEFAULT_INJURED_HEALTH : DEFAULT_HEALTHY_HEALTH,
  );

export const parseConditionRecoveryIsoMs = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const createConditionRecoveryDueAt = (nowMs: number): string =>
  new Date(nowMs + CONDITION_RECOVERY_INTERVAL_MS).toISOString();

export const resolveConditionRecoveryDueAt = ({
  dueAt,
  legacyRecoveryAt,
  nowMs,
}: ResolveConditionRecoveryDueAtInput): ResolveConditionRecoveryDueAtResult => {
  const dueAtMs = parseConditionRecoveryIsoMs(dueAt);
  if (dueAtMs !== null) {
    return {
      dueAt: new Date(dueAtMs).toISOString(),
      source: 'due',
    };
  }

  const legacyRecoveryAtMs = parseConditionRecoveryIsoMs(legacyRecoveryAt);
  if (legacyRecoveryAtMs !== null) {
    return {
      dueAt: new Date(
        legacyRecoveryAtMs + CONDITION_RECOVERY_INTERVAL_MS,
      ).toISOString(),
      source: 'legacy',
    };
  }

  return {
    dueAt: createConditionRecoveryDueAt(nowMs),
    source: 'seeded',
  };
};

const mergeConditionRecoveryPendingToast = (
  currentPendingToast: ConditionRecoveryPendingToast | null | undefined,
  nextPartial: {
    conditionGain: number;
    motivationGain: number;
    healthGain: number;
    totalPlayers: number;
    affectedPlayers: number;
    appliedTicks: number;
    updatedAt: string;
  },
): ConditionRecoveryPendingToast | null => {
  const currentConditionGain =
    Number.isFinite(currentPendingToast?.conditionGain)
      ? Number(currentPendingToast?.conditionGain)
      : Number.isFinite(currentPendingToast?.totalGain)
        ? Number(currentPendingToast?.totalGain)
        : 0;
  const currentMotivationGain = Number.isFinite(currentPendingToast?.motivationGain)
    ? Number(currentPendingToast?.motivationGain)
    : 0;
  const currentHealthGain = Number.isFinite(currentPendingToast?.healthGain)
    ? Number(currentPendingToast?.healthGain)
    : 0;
  const hasNextGain =
    nextPartial.conditionGain > 0 ||
    nextPartial.motivationGain > 0 ||
    nextPartial.healthGain > 0;

  if (!hasNextGain || nextPartial.totalPlayers <= 0) {
    if (
      currentConditionGain <= 0 &&
      currentMotivationGain <= 0 &&
      currentHealthGain <= 0
    ) {
      return null;
    }
    return currentPendingToast ?? null;
  }

  return {
    conditionGain: roundGaugeValue(
      currentConditionGain + nextPartial.conditionGain,
    ),
    motivationGain: roundGaugeValue(
      currentMotivationGain + nextPartial.motivationGain,
    ),
    healthGain: roundGaugeValue(currentHealthGain + nextPartial.healthGain),
    totalPlayers: nextPartial.totalPlayers,
    affectedPlayers: Math.max(
      currentPendingToast?.affectedPlayers ?? 0,
      nextPartial.affectedPlayers,
    ),
    appliedTicks: (currentPendingToast?.appliedTicks ?? 0) + nextPartial.appliedTicks,
    updatedAt: nextPartial.updatedAt,
  };
};

export const applyScheduledConditionRecovery = ({
  players,
  dueAt,
  nowMs,
  pendingToast,
}: ApplyScheduledConditionRecoveryInput): ApplyScheduledConditionRecoveryResult => {
  const safePlayers = Array.isArray(players) ? players : [];
  const dueAtMs = parseConditionRecoveryIsoMs(dueAt);

  if (dueAtMs === null || dueAtMs > nowMs) {
    return {
      players: safePlayers,
      changed: false,
      appliedTicks: 0,
      conditionGain: 0,
      motivationGain: 0,
      healthGain: 0,
      totalPlayers: safePlayers.length,
      affectedPlayers: 0,
      nextDueAt: dueAt,
      pendingToast: pendingToast ?? null,
    };
  }

  const appliedTicks =
    Math.floor((nowMs - dueAtMs) / CONDITION_RECOVERY_INTERVAL_MS) + 1;
  const grossConditionGain = appliedTicks * CONDITION_RECOVERY_STEP;
  const grossMotivationGain = appliedTicks * MOTIVATION_RECOVERY_STEP;
  const grossHealthGain = appliedTicks * HEALTH_RECOVERY_STEP;
  let changed = false;
  let conditionGain = 0;
  let motivationGain = 0;
  let healthGain = 0;
  let affectedPlayers = 0;

  const nextPlayers = safePlayers.map((player) => {
    const currentCondition = clampGauge(player.condition);
    const nextCondition = clampGauge(currentCondition + grossConditionGain);
    const actualConditionGain = roundGaugeValue(nextCondition - currentCondition);
    const currentMotivation = clampGauge(player.motivation);
    const nextMotivation = clampGauge(currentMotivation + grossMotivationGain);
    const actualMotivationGain = roundGaugeValue(nextMotivation - currentMotivation);
    const currentHealth = clampHealthGauge(player.health, player.injuryStatus);
    const nextHealth = clampHealthGauge(currentHealth + grossHealthGain, player.injuryStatus);
    const actualHealthGain = roundGaugeValue(nextHealth - currentHealth);

    if (
      actualConditionGain <= 0 &&
      actualMotivationGain <= 0 &&
      actualHealthGain <= 0
    ) {
      return player;
    }

    changed = true;
    conditionGain = roundGaugeValue(conditionGain + actualConditionGain);
    motivationGain = roundGaugeValue(motivationGain + actualMotivationGain);
    healthGain = roundGaugeValue(healthGain + actualHealthGain);
    affectedPlayers += 1;

    return {
      ...player,
      condition: nextCondition,
      motivation: nextMotivation,
      health: nextHealth,
    };
  });

  const nextDueAt = new Date(
    dueAtMs + appliedTicks * CONDITION_RECOVERY_INTERVAL_MS,
  ).toISOString();

  return {
    players: nextPlayers,
    changed,
    appliedTicks,
    conditionGain,
    motivationGain,
    healthGain,
    totalPlayers: nextPlayers.length,
    affectedPlayers,
    nextDueAt,
    pendingToast: mergeConditionRecoveryPendingToast(pendingToast, {
      conditionGain,
      motivationGain,
      healthGain,
      totalPlayers: nextPlayers.length,
      affectedPlayers,
      appliedTicks,
      updatedAt: new Date(nowMs).toISOString(),
    }),
  };
};
