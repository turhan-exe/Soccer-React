import { translate } from '@/i18n/runtime';

export type TrainingResult =
  | 'fail'
  | 'very_low'
  | 'low'
  | 'medium'
  | 'high'
  | 'full'
  | 'average'
  | 'success';

export type TrainingOutcome = {
  result: Exclude<TrainingResult, 'average' | 'success'>;
  gainMultiplier: number;
};

type TrainingOutcomeThreshold = TrainingOutcome & {
  upperBoundExclusive: number;
};

const TRAINING_OUTCOME_THRESHOLDS: TrainingOutcomeThreshold[] = [
  { upperBoundExclusive: 1, result: 'fail', gainMultiplier: 0 },
  { upperBoundExclusive: 26, result: 'very_low', gainMultiplier: 0.1 },
  { upperBoundExclusive: 50, result: 'low', gainMultiplier: 0.25 },
  { upperBoundExclusive: 75, result: 'medium', gainMultiplier: 0.5 },
  { upperBoundExclusive: 90, result: 'high', gainMultiplier: 0.75 },
  { upperBoundExclusive: 101, result: 'full', gainMultiplier: 1 },
];

export function resolveTrainingOutcome(rollPercent: number): TrainingOutcome {
  const normalizedRoll = Number.isFinite(rollPercent)
    ? Math.max(0, Math.min(100, rollPercent))
    : 0;

  return (
    TRAINING_OUTCOME_THRESHOLDS.find(
      threshold => normalizedRoll < threshold.upperBoundExclusive,
    ) ?? TRAINING_OUTCOME_THRESHOLDS[0]
  );
}

export function getTrainingResultLabel(result: TrainingResult): string {
  return translate(`common.trainingResultLabels.${result}`);
}

export type TrainingResultTone = 'fail' | 'low' | 'medium' | 'high' | 'full';

export function getTrainingResultTone(result: TrainingResult): TrainingResultTone {
  switch (result) {
    case 'very_low':
    case 'low':
      return 'low';
    case 'medium':
    case 'average':
      return 'medium';
    case 'high':
      return 'high';
    case 'full':
    case 'success':
      return 'full';
    case 'fail':
    default:
      return 'fail';
  }
}
