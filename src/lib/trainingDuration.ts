import type { Training } from '@/types';

type CalculateDurationParams = {
  playersCount: number;
  trainings: Training[];
  vipDurationMultiplier: number;
};

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

  const adjustedMinutes = Math.round(totalTrainingMinutes * vipDurationMultiplier);

  return Math.max(1, adjustedMinutes);
}
