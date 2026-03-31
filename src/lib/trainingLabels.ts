import type { Player } from '@/types';

const TRAINING_ATTRIBUTE_LABELS: Record<keyof Player['attributes'], string> = {
  strength: 'Güç',
  acceleration: 'Hızlanma',
  topSpeed: 'Maksimum Hız',
  dribbleSpeed: 'Dribling Hızı',
  jump: 'Sıçrama',
  tackling: 'Mücadele',
  ballKeeping: 'Top Saklama',
  passing: 'Pas',
  longBall: 'Uzun Top',
  agility: 'Çeviklik',
  shooting: 'Şut',
  shootPower: 'Şut Gücü',
  positioning: 'Pozisyon Alma',
  reaction: 'Refleks',
  ballControl: 'Top Kontrolü',
};

export function getTrainingAttributeLabel(
  attribute: keyof Player['attributes'],
): string {
  return TRAINING_ATTRIBUTE_LABELS[attribute] ?? attribute;
}
