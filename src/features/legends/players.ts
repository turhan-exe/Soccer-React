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
      '/legend-images/Pelé.png',
    position: 'ST',
  },
  {
    id: 2,
    name: 'Diego Maradona',
    rating: 97,
    rarity: 'legend',
    weight: 1,
    image:
      '/legend-images/Diego Maradona.png',
    position: 'CAM',
  },
  {
    id: 3,
    name: 'Johan Cruyff',
    rating: 96,
    rarity: 'legend',
    weight: 1,
    image:
      '/legend-images/Johan Cruyff.png',
    position: 'LW',
  },
  {
    id: 4,
    name: 'Franz Beckenbauer',
    rating: 96,
    rarity: 'legend',
    weight: 1,
    image:
      '/legend-images/Franz Beckenbauer.png',
    position: 'CB',
  },
  {
    id: 5,
    name: 'Zinedine Zidane',
    rating: 95,
    rarity: 'legend',
    weight: 1,
    image:
      '/legend-images/Zinedine Zidane.png',
    position: 'CM',
  },
  {
    id: 6,
    name: 'Ronaldo Nazário',
    rating: 95,
    rarity: 'legend',
    weight: 1,
    image:
      '/legend-images/Ronaldo Nazário.png',
    position: 'ST',
  },
  {
    id: 7,
    name: 'Ronaldinho',
    rating: 94,
    rarity: 'legend',
    weight: 1,
    image:
      '/legend-images/Ronaldinho.png',
    position: 'CAM',
  },
  {
    id: 8,
    name: 'George Best',
    rating: 94,
    rarity: 'legend',
    weight: 1,
    image:
      '/legend-images/George Best.png',
    position: 'RW',
  },
  {
    id: 9,
    name: 'Ferenc Puskás',
    rating: 96,
    rarity: 'legend',
    weight: 1,
    image:
      '/legend-images/Ferenc Puskás.png',
    position: 'ST',
  },
  {
    id: 10,
    name: 'Lev Yashin',
    rating: 95,
    rarity: 'legend',
    weight: 1,
    image:
      '/legend-images/Lev Yashin.png',
    position: 'GK',
  },
  {
    id: 11,
    name: 'Paolo Maldini',
    rating: 95,
    rarity: 'legend',
    weight: 1,
    image:
      '/legend-images/Paolo Maldini.png',
    position: 'CB',
  },
  {
    id: 12,
    name: 'Roberto Baggio',
    rating: 94,
    rarity: 'legend',
    weight: 1,
    image:
      '/legend-images/Roberto Baggio.png',
    position: 'CAM',
  },
  {
    id: 13,
    name: 'Thierry Henry',
    rating: 94,
    rarity: 'legend',
    weight: 1,
    image:
      '/legend-images/Thierry Henry.png',
    position: 'ST',
  },
  {
    id: 14,
    name: 'Xavi',
    rating: 93,
    rarity: 'legend',
    weight: 1,
    image:
      '/legend-images/Xavi.png',
    position: 'CM',
  },
  {
    id: 15,
    name: 'Andrés Iniesta',
    rating: 93,
    rarity: 'legend',
    weight: 1,
    image:
      '/legend-images/Andrés Iniesta.png',
    position: 'CM',
  },
  {
    id: 16,
    name: 'Eric Cantona',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Eric Cantona.png',
    position: 'ST',
  },
  {
    id: 17,
    name: 'Zico',
    rating: 92,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Zico.png',
    position: 'CAM',
  },
  {
    id: 18,
    name: 'Lothar Matthäus',
    rating: 92,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Lothar Matthäus.png',
    position: 'CM',
  },
  {
    id: 19,
    name: 'Marco van Basten',
    rating: 92,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Marco van Basten.png',
    position: 'ST',
  },
  {
    id: 20,
    name: 'Michel Platini',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Michel Platini.png',
    position: 'CAM',
  },
  {
    id: 21,
    name: 'Garrincha',
    rating: 92,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Garrincha.png',
    position: 'RW',
  },
  {
    id: 22,
    name: 'Eusébio',
    rating: 92,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Eusébio.png',
    position: 'ST',
  },
  {
    id: 23,
    name: 'Gerd Müller',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Gerd Müller.png',
    position: 'ST',
  },
  {
    id: 24,
    name: 'Bobby Charlton',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Bobby Charlton.png',
    position: 'CM',
  },
  {
    id: 25,
    name: 'Ruud Gullit',
    rating: 92,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Ruud Gullit.png',
    position: 'CM',
  },
  {
    id: 26,
    name: 'Hristo Stoichkov',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Hristo Stoichkov.png',
    position: 'LW',
  },
  {
    id: 27,
    name: 'Rivaldo',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Rivaldo.png',
    position: 'CAM',
  },
  {
    id: 28,
    name: 'Kaká',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Kaká.png',
    position: 'CAM',
  },
  {
    id: 29,
    name: 'Ryan Giggs',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Ryan Giggs.png',
    position: 'LM',
  },
  {
    id: 30,
    name: 'Dennis Bergkamp',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Dennis Bergkamp.png',
    position: 'ST',
  },
  {
    id: 31,
    name: 'Patrick Vieira',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Patrick Vieira.png',
    position: 'CM',
  },
  {
    id: 32,
    name: 'Peter Schmeichel',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Peter Schmeichel.png',
    position: 'GK',
  },
  {
    id: 33,
    name: 'Franco Baresi',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Franco Baresi.png',
    position: 'CB',
  },
  {
    id: 34,
    name: 'Andrea Pirlo',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Andrea Pirlo.png',
    position: 'CM',
  },
  {
    id: 35,
    name: 'Oliver Kahn',
    rating: 92,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Oliver Kahn.png',
    position: 'GK',
  },
  {
    id: 36,
    name: 'Alessandro Del Piero',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Alessandro Del Piero.png',
    position: 'ST',
  },
  {
    id: 37,
    name: 'Kenny Dalglish',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      '/legend-images/Kenny Dalglish.png',
    position: 'ST',
  },
  {
    id: 38,
    name: 'David Beckham',
    rating: 89,
    rarity: 'common',
    weight: 6,
    image:
      '/legend-images/David Beckham.png',
    position: 'RM',
  },
  {
    id: 39,
    name: 'Cafu',
    rating: 88,
    rarity: 'common',
    weight: 6,
    image:
      '/legend-images/Cafu.png',
    position: 'RB',
  },
  {
    id: 40,
    name: 'Roberto Carlos',
    rating: 89,
    rarity: 'common',
    weight: 6,
    image:
      '/legend-images/Roberto Carlos.png',
    position: 'LB',
  },
  {
    id: 41,
    name: 'Carles Puyol',
    rating: 88,
    rarity: 'common',
    weight: 6,
    image:
      '/legend-images/Carles Puyol.png',
    position: 'CB',
  },
  {
    id: 42,
    name: 'Fernando Hierro',
    rating: 87,
    rarity: 'common',
    weight: 6,
    image:
      '/legend-images/Fernando Hierro.png',
    position: 'CB',
  },
  {
    id: 43,
    name: 'Clarence Seedorf',
    rating: 87,
    rarity: 'common',
    weight: 6,
    image:
      '/legend-images/Clarence Seedorf.png',
    position: 'CM',
  },
  {
    id: 44,
    name: 'Pavel Nedvěd',
    rating: 88,
    rarity: 'common',
    weight: 6,
    image:
      '/legend-images/Pavel Nedvěd.png',
    position: 'LM',
  },
  {
    id: 45,
    name: 'Jay-Jay Okocha',
    rating: 86,
    rarity: 'common',
    weight: 6,
    image:
      '/legend-images/Jay-Jay Okocha.png',
    position: 'CAM',
  },
  {
    id: 46,
    name: 'Gheorghe Hagi',
    rating: 88,
    rarity: 'common',
    weight: 6,
    image:
      '/legend-images/Gheorghe Hagi.png',
    position: 'CAM',
  },
  {
    id: 47,
    name: 'Henrik Larsson',
    rating: 87,
    rarity: 'common',
    weight: 6,
    image:
      '/legend-images/Henrik Larsson.png',
    position: 'ST',
  },
  {
    id: 48,
    name: 'Didier Drogba',
    rating: 89,
    rarity: 'common',
    weight: 6,
    image:
      '/legend-images/Didier Drogba.png',
    position: 'ST',
  },
  {
    id: 49,
    name: 'Claude Makélélé',
    rating: 87,
    rarity: 'common',
    weight: 6,
    image:
      '/legend-images/Claude Makélélé.png',
    position: 'CM',
  },
  {
    id: 50,
    name: 'Sócrates',
    rating: 88,
    rarity: 'common',
    weight: 6,
    image:
      '/legend-images/Sócrates.png',
    position: 'CM',
  },
];
