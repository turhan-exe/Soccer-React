import { translate } from '@/i18n/runtime';
import type { Player } from '@/types';

export function getTrainingAttributeLabel(
  attribute: keyof Player['attributes'],
): string {
  return translate(`common.trainingAttributes.${attribute}`);
}
