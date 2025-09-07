export type LegendPlayer = {
  id: number;
  name: string;
  rating: number;
  rarity: 'legend' | 'rare' | 'common';
  weight: number;
};

export const LEGEND_PLAYERS: LegendPlayer[] = [
  { id: 1, name: 'Pelé', rating: 98, rarity: 'legend', weight: 1 },
  { id: 2, name: 'Maradona', rating: 97, rarity: 'legend', weight: 1 },
  { id: 3, name: 'Zico', rating: 93, rarity: 'rare', weight: 5 },
  { id: 4, name: 'Johan Cruyff', rating: 96, rarity: 'legend', weight: 1 },
  { id: 5, name: 'Eric Cantona', rating: 90, rarity: 'rare', weight: 3 },
  { id: 6, name: 'Bobby Charlton', rating: 91, rarity: 'rare', weight: 3 },
];
