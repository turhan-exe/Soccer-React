import type { Training } from '@/types';

type CalculateDurationParams = {
  playersCount: number;
  trainings: Training[];
  vipDurationMultiplier: number;
};

const PLAYER_LOAD_COEFFICIENT = 0.35;

export function calculatePlayerLoadMultiplier(playersCount: number): number {
  if (!Number.isFinite(playersCount) || playersCount <= 0) {
    return 0;
  }

  if (playersCount === 1) {
    return 1;
  }

  // Group sessions scale sublinearly: larger squads take longer to organize,
  // but drills still happen in parallel and should not grow linearly.
  return Number(
    (1 + Math.sqrt(playersCount - 1) * PLAYER_LOAD_COEFFICIENT).toFixed(3),
  );
}

export function calculateSessionDurationMinutes({
  playersCount,
  trainings,
  vipDurationMultiplier,
}: CalculateDurationParams): number {
  if (playersCount <= 0 || trainings.length === 0) {
    return 0;
  }

  const totalTrainingMinutes = trainings.reduce((total, training) => {
    const duration = Number.isFinite(training.duration) ? training.duration : 0;
    return total + Math.max(0, duration);
  }, 0);

  if (totalTrainingMinutes <= 0) {
    return 0;
  }

  const playerLoadMultiplier = calculatePlayerLoadMultiplier(playersCount);
  const adjustedMinutes = Math.round(
    totalTrainingMinutes * playerLoadMultiplier * vipDurationMultiplier,
  );

  return Math.max(1, adjustedMinutes);
}
