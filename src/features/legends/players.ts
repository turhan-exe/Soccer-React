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
    name: 'Diego Maradona',
    rating: 97,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Diego_Maradona_2017.jpg/64px-Diego_Maradona_2017.jpg',
    position: 'CAM',
  },
  {
    id: 3,
    name: 'Johan Cruyff',
    rating: 96,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Johan_Cruyff_1974.jpg/64px-Johan_Cruyff_1974.jpg',
    position: 'LW',
  },
  {
    id: 4,
    name: 'Franz Beckenbauer',
    rating: 96,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Franz_Beckenbauer_1966.jpg/64px-Franz_Beckenbauer_1966.jpg',
    position: 'CB',
  },
  {
    id: 5,
    name: 'Zinedine Zidane',
    rating: 95,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/Zinedine_Zidane_2015.jpg/64px-Zinedine_Zidane_2015.jpg',
    position: 'CM',
  },
  {
    id: 6,
    name: 'Ronaldo Nazário',
    rating: 95,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Ronaldo_Nazario_2019.jpg/64px-Ronaldo_Nazario_2019.jpg',
    position: 'ST',
  },
  {
    id: 7,
    name: 'Ronaldinho',
    rating: 94,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Ronaldinho_2019.jpg/64px-Ronaldinho_2019.jpg',
    position: 'CAM',
  },
  {
    id: 8,
    name: 'George Best',
    rating: 94,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/George_Best_1976.jpg/64px-George_Best_1976.jpg',
    position: 'RW',
  },
  {
    id: 9,
    name: 'Ferenc Puskás',
    rating: 96,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Ferenc_Pusk%C3%A1s_1990.jpg/64px-Ferenc_Pusk%C3%A1s_1990.jpg',
    position: 'ST',
  },
  {
    id: 10,
    name: 'Lev Yashin',
    rating: 95,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/Lev_Yashin_1966.jpg/64px-Lev_Yashin_1966.jpg',
    position: 'GK',
  },
  {
    id: 11,
    name: 'Paolo Maldini',
    rating: 95,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Paolo_Maldini_2014.jpg/64px-Paolo_Maldini_2014.jpg',
    position: 'CB',
  },
  {
    id: 12,
    name: 'Roberto Baggio',
    rating: 94,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Roberto_Baggio_2014.jpg/64px-Roberto_Baggio_2014.jpg',
    position: 'CAM',
  },
  {
    id: 13,
    name: 'Thierry Henry',
    rating: 94,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Thierry_Henry_%282014%29.jpg/64px-Thierry_Henry_%282014%29.jpg',
    position: 'ST',
  },
  {
    id: 14,
    name: 'Xavi',
    rating: 93,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Xavi_Hernandez_2011.jpg/64px-Xavi_Hernandez_2011.jpg',
    position: 'CM',
  },
  {
    id: 15,
    name: 'Andrés Iniesta',
    rating: 93,
    rarity: 'legend',
    weight: 1,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Andr%C3%A9s_Iniesta_2017.jpg/64px-Andr%C3%A9s_Iniesta_2017.jpg',
    position: 'CM',
  },
  {
    id: 16,
    name: 'Eric Cantona',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Eric_Cantona_2011.jpg/64px-Eric_Cantona_2011.jpg',
    position: 'ST',
  },
  {
    id: 17,
    name: 'Zico',
    rating: 92,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Zico_1981.jpg/64px-Zico_1981.jpg',
    position: 'CAM',
  },
  {
    id: 18,
    name: 'Lothar Matthäus',
    rating: 92,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Lothar_Matth%C3%A4us_2014.jpg/64px-Lothar_Matth%C3%A4us_2014.jpg',
    position: 'CM',
  },
  {
    id: 19,
    name: 'Marco van Basten',
    rating: 92,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Marco_Van_Basten_in_2014.jpg/64px-Marco_Van_Basten_in_2014.jpg',
    position: 'ST',
  },
  {
    id: 20,
    name: 'Michel Platini',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Michel_Platini_2010.jpg/64px-Michel_Platini_2010.jpg',
    position: 'CAM',
  },
  {
    id: 21,
    name: 'Garrincha',
    rating: 92,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Garrincha_1962.jpg/64px-Garrincha_1962.jpg',
    position: 'RW',
  },
  {
    id: 22,
    name: 'Eusébio',
    rating: 92,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Eusebio_%281963%29.jpg/64px-Eusebio_%281963%29.jpg',
    position: 'ST',
  },
  {
    id: 23,
    name: 'Gerd Müller',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Gerd_M%C3%BCller_2006_1.jpg/64px-Gerd_M%C3%BCller_2006_1.jpg',
    position: 'ST',
  },
  {
    id: 24,
    name: 'Bobby Charlton',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Bobby_Charlton_in_1969.jpg/64px-Bobby_Charlton_in_1969.jpg',
    position: 'CM',
  },
  {
    id: 25,
    name: 'Ruud Gullit',
    rating: 92,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Ruud_Gullit_2016.jpg/64px-Ruud_Gullit_2016.jpg',
    position: 'CM',
  },
  {
    id: 26,
    name: 'Hristo Stoichkov',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Hristo_Stoichkov_2012_2.jpg/64px-Hristo_Stoichkov_2012_2.jpg',
    position: 'LW',
  },
  {
    id: 27,
    name: 'Rivaldo',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Rivaldo_2014.jpg/64px-Rivaldo_2014.jpg',
    position: 'CAM',
  },
  {
    id: 28,
    name: 'Kaká',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Kak%C3%A1_2018.jpg/64px-Kak%C3%A1_2018.jpg',
    position: 'CAM',
  },
  {
    id: 29,
    name: 'Ryan Giggs',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Ryan_Giggs_2010.jpg/64px-Ryan_Giggs_2010.jpg',
    position: 'LM',
  },
  {
    id: 30,
    name: 'Dennis Bergkamp',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Dennis_Bergkamp_2006_%28cropped%29.jpg/64px-Dennis_Bergkamp_2006_%28cropped%29.jpg',
    position: 'ST',
  },
  {
    id: 31,
    name: 'Patrick Vieira',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/Patrick_Vieira_2010_%28cropped%29.jpg/64px-Patrick_Vieira_2010_%28cropped%29.jpg',
    position: 'CM',
  },
  {
    id: 32,
    name: 'Peter Schmeichel',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Peter_Schmeichel_2013.jpg/64px-Peter_Schmeichel_2013.jpg',
    position: 'GK',
  },
  {
    id: 33,
    name: 'Franco Baresi',
    rating: 91,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Franco_Baresi_2012_cropped.jpg/64px-Franco_Baresi_2012_cropped.jpg',
    position: 'CB',
  },
  {
    id: 34,
    name: 'Andrea Pirlo',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Andrea_Pirlo_2012_%28cropped%29.jpg/64px-Andrea_Pirlo_2012_%28cropped%29.jpg',
    position: 'CM',
  },
  {
    id: 35,
    name: 'Oliver Kahn',
    rating: 92,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Oliver_Kahn_2012.jpg/64px-Oliver_Kahn_2012.jpg',
    position: 'GK',
  },
  {
    id: 36,
    name: 'Alessandro Del Piero',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Del_Piero_at_Celebrity_Cup_2014.jpg/64px-Del_Piero_at_Celebrity_Cup_2014.jpg',
    position: 'ST',
  },
  {
    id: 37,
    name: 'Kenny Dalglish',
    rating: 90,
    rarity: 'rare',
    weight: 3,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Kenny_Dalglish_2010.jpg/64px-Kenny_Dalglish_2010.jpg',
    position: 'ST',
  },
  {
    id: 38,
    name: 'David Beckham',
    rating: 89,
    rarity: 'common',
    weight: 6,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/David_Beckham_2019.jpg/64px-David_Beckham_2019.jpg',
    position: 'RM',
  },
  {
    id: 39,
    name: 'Cafu',
    rating: 88,
    rarity: 'common',
    weight: 6,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Cafu%2C_2014.jpg/64px-Cafu%2C_2014.jpg',
    position: 'RB',
  },
  {
    id: 40,
    name: 'Roberto Carlos',
    rating: 89,
    rarity: 'common',
    weight: 6,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Roberto_Carlos_in_May_2011.jpg/64px-Roberto_Carlos_in_May_2011.jpg',
    position: 'LB',
  },
  {
    id: 41,
    name: 'Carles Puyol',
    rating: 88,
    rarity: 'common',
    weight: 6,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Carles_Puyol_in_2010.jpg/64px-Carles_Puyol_in_2010.jpg',
    position: 'CB',
  },
  {
    id: 42,
    name: 'Fernando Hierro',
    rating: 87,
    rarity: 'common',
    weight: 6,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Fernando_Hierro_2017.jpg/64px-Fernando_Hierro_2017.jpg',
    position: 'CB',
  },
  {
    id: 43,
    name: 'Clarence Seedorf',
    rating: 87,
    rarity: 'common',
    weight: 6,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Clarence_Seedorf_2012.jpg/64px-Clarence_Seedorf_2012.jpg',
    position: 'CM',
  },
  {
    id: 44,
    name: 'Pavel Nedvěd',
    rating: 88,
    rarity: 'common',
    weight: 6,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Pavel_Nedv%C4%9Bd_2019.jpg/64px-Pavel_Nedv%C4%9Bd_2019.jpg',
    position: 'LM',
  },
  {
    id: 45,
    name: 'Jay-Jay Okocha',
    rating: 86,
    rarity: 'common',
    weight: 6,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/Jay-Jay_Okocha_2014.jpg/64px-Jay-Jay_Okocha_2014.jpg',
    position: 'CAM',
  },
  {
    id: 46,
    name: 'Gheorghe Hagi',
    rating: 88,
    rarity: 'common',
    weight: 6,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Gheorghe_Hagi_2008.jpg/64px-Gheorghe_Hagi_2008.jpg',
    position: 'CAM',
  },
  {
    id: 47,
    name: 'Henrik Larsson',
    rating: 87,
    rarity: 'common',
    weight: 6,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Henrik_Larsson_2014.jpg/64px-Henrik_Larsson_2014.jpg',
    position: 'ST',
  },
  {
    id: 48,
    name: 'Didier Drogba',
    rating: 89,
    rarity: 'common',
    weight: 6,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Didier_Drogba_in_2017.jpg/64px-Didier_Drogba_in_2017.jpg',
    position: 'ST',
  },
  {
    id: 49,
    name: 'Claude Makélélé',
    rating: 87,
    rarity: 'common',
    weight: 6,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Claude_Makelele_2019.jpg/64px-Claude_Makelele_2019.jpg',
    position: 'CM',
  },
  {
    id: 50,
    name: 'Sócrates',
    rating: 88,
    rarity: 'common',
    weight: 6,
    image:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Socrates_2010.jpg/64px-Socrates_2010.jpg',
    position: 'CM',
  },
];
