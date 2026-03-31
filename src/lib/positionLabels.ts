import type { Position } from '@/types';

export const POSITION_LABELS_TR: Record<Position, string> = {
  GK: 'Kaleci',
  CB: 'Stoper',
  LB: 'Sol Bek',
  RB: 'Sağ Bek',
  CM: 'Merkez Orta Saha',
  LM: 'Sol Orta Saha',
  RM: 'Sağ Orta Saha',
  CAM: 'Ofansif Orta Saha',
  LW: 'Sol Kanat',
  RW: 'Sağ Kanat',
  ST: 'Santrfor',
};

export const getPositionLabel = (position?: Position | null): string => {
  if (!position) {
    return 'Belirsiz Mevki';
  }

  return POSITION_LABELS_TR[position] ?? position;
};

export const getPositionLabels = (positions?: Position[] | null): string[] => {
  if (!positions?.length) {
    return [];
  }

  return positions.map(getPositionLabel);
};
