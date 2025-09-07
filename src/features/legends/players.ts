import type { Player } from '@/types';

export type LegendPlayer = {
  id: number;
  name: string;
  rating: number;
  rarity: 'legend' | 'rare' | 'common';
  weight: number;
  image: string;
  position: Player['position'];
};

export const LEGEND_PLAYERS: LegendPlayer[] = [
  {
    id: 1,
    name: 'Pelé',
    rating: 98,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Pele_1970.jpg/64px-Pele_1970.jpg',
    position: 'ST',
  },
  {
    id: 2,
    name: 'Maradona',
    rating: 97,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Diego_Maradona_2017.jpg/64px-Diego_Maradona_2017.jpg',
    position: 'CAM',
  },
  {
    id: 3,
    name: 'Zico',
    rating: 93,
    rarity: 'rare',
    weight: 5,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Zico_1981.jpg/64px-Zico_1981.jpg',
    position: 'CAM',
  },
  {
    id: 4,
    name: 'Johan Cruyff',
    rating: 96,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Johan_Cruyff_1974.jpg/64px-Johan_Cruyff_1974.jpg',
    position: 'LW',
  },
  {
    id: 5,
    name: 'Eric Cantona',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Eric_Cantona_2011.jpg/64px-Eric_Cantona_2011.jpg',
    position: 'ST',
  },
  {
    id: 6,
    name: 'Bobby Charlton',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Bobby_Charlton_in_1969.jpg/64px-Bobby_Charlton_in_1969.jpg',
    position: 'CM',
  },
];
