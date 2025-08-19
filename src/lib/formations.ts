import { Player } from '@/types';

export interface FormationPosition {
  position: Player['position'];
  x: number; // percentage from 0 to 100
  y: number; // percentage from 0 to 100
}

export interface Formation {
  name: string;
  positions: FormationPosition[];
}

export const formations: Formation[] = [
  {
    name: '4-4-2',
    positions: [
      { position: 'GK', x: 50, y: 90 },
      { position: 'LB', x: 15, y: 70 },
      { position: 'CB', x: 35, y: 65 },
      { position: 'CB', x: 65, y: 65 },
      { position: 'RB', x: 85, y: 70 },
      { position: 'LM', x: 15, y: 45 },
      { position: 'CM', x: 40, y: 45 },
      { position: 'CM', x: 60, y: 45 },
      { position: 'RM', x: 85, y: 45 },
      { position: 'ST', x: 40, y: 20 },
      { position: 'ST', x: 60, y: 20 },
    ],
  },
  {
    name: '4-3-3',
    positions: [
      { position: 'GK', x: 50, y: 90 },
      { position: 'LB', x: 15, y: 70 },
      { position: 'CB', x: 35, y: 65 },
      { position: 'CB', x: 65, y: 65 },
      { position: 'RB', x: 85, y: 70 },
      { position: 'CM', x: 30, y: 45 },
      { position: 'CM', x: 50, y: 40 },
      { position: 'CM', x: 70, y: 45 },
      { position: 'LW', x: 20, y: 25 },
      { position: 'ST', x: 50, y: 15 },
      { position: 'RW', x: 80, y: 25 },
    ],
  },
  {
    name: '3-5-2',
    positions: [
      { position: 'GK', x: 50, y: 90 },
      { position: 'CB', x: 30, y: 70 },
      { position: 'CB', x: 50, y: 65 },
      { position: 'CB', x: 70, y: 70 },
      { position: 'LM', x: 10, y: 45 },
      { position: 'CM', x: 30, y: 45 },
      { position: 'CAM', x: 50, y: 40 },
      { position: 'CM', x: 70, y: 45 },
      { position: 'RM', x: 90, y: 45 },
      { position: 'ST', x: 40, y: 20 },
      { position: 'ST', x: 60, y: 20 },
    ],
  },
];

