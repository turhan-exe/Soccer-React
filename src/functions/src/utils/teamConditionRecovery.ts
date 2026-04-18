const DEFAULT_VITAL_GAUGE = 0.75;
export const CONDITION_RECOVERY_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const CONDITION_RECOVERY_STEP = 0.01;

export type ConditionRecoveryPendingToast = {
  totalGain: number;
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
  totalGain: number;
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
    totalGain: number;
    totalPlayers: number;
    affectedPlayers: number;
    appliedTicks: number;
    updatedAt: string;
  },
): ConditionRecoveryPendingToast | null => {
  if (nextPartial.totalGain <= 0 || nextPartial.totalPlayers <= 0) {
    return currentPendingToast ?? null;
  }

  return {
    totalGain: roundGaugeValue(
      (currentPendingToast?.totalGain ?? 0) + nextPartial.totalGain,
    ),
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
      totalGain: 0,
      totalPlayers: safePlayers.length,
      affectedPlayers: 0,
      nextDueAt: dueAt,
      pendingToast: pendingToast ?? null,
    };
  }

  const appliedTicks =
    Math.floor((nowMs - dueAtMs) / CONDITION_RECOVERY_INTERVAL_MS) + 1;
  const grossGain = appliedTicks * CONDITION_RECOVERY_STEP;
  let changed = false;
  let totalGain = 0;
  let affectedPlayers = 0;

  const nextPlayers = safePlayers.map((player) => {
    const currentCondition = clampGauge(player.condition);
    const nextCondition = clampGauge(currentCondition + grossGain);
    const actualGain = roundGaugeValue(nextCondition - currentCondition);

    if (actualGain <= 0) {
      return player;
    }

    changed = true;
    totalGain = roundGaugeValue(totalGain + actualGain);
    affectedPlayers += 1;

    return {
      ...player,
      condition: nextCondition,
    };
  });

  const nextDueAt = new Date(
    dueAtMs + appliedTicks * CONDITION_RECOVERY_INTERVAL_MS,
  ).toISOString();

  return {
    players: nextPlayers,
    changed,
    appliedTicks,
    totalGain,
    totalPlayers: nextPlayers.length,
    affectedPlayers,
    nextDueAt,
    pendingToast: mergeConditionRecoveryPendingToast(pendingToast, {
      totalGain,
      totalPlayers: nextPlayers.length,
      affectedPlayers,
      appliedTicks,
      updatedAt: new Date(nowMs).toISOString(),
    }),
  };
};
