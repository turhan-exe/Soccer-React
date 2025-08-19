// Utility for generating random names from large pools.
// We generate 500 first names and 500 last names by combining
// common Turkish syllable prefixes with various suffixes.

const firstPrefixes = [
  'Al', 'Ar', 'Ay', 'Ba', 'Be', 'Bu', 'Ca', 'Ce', 'Da', 'De',
  'El', 'Em', 'Fa', 'Fe', 'Ga', 'Ge', 'Ha', 'He', 'Il', 'Is',
  'Ka', 'Ke', 'Le', 'Ma', 'Me'
];

const lastPrefixes = [
  'Ak', 'Bal', 'Can', 'Dem', 'Er', 'Fer', 'Gul', 'Hak', 'Ilg', 'Kar',
  'Lem', 'Mor', 'Naz', 'Oz', 'Pol', 'Quz', 'Ras', 'Sar', 'Tas', 'Uzg',
  'Var', 'Yen', 'Zor', 'Bar', 'Cel'
];

const suffixes = [
  'a', 'e', 'i', 'o', 'u', 'an', 'en', 'in', 'on', 'un',
  'ar', 'er', 'ir', 'or', 'ur', 'am', 'em', 'im', 'om', 'um'
];

export const firstNames = firstPrefixes.flatMap(prefix =>
  suffixes.map(suffix => `${prefix}${suffix}`)
);

export const lastNames = lastPrefixes.flatMap(prefix =>
  suffixes.map(suffix => `${prefix}${suffix}`)
);

export const generateRandomName = () => {
  const first = firstNames[Math.floor(Math.random() * firstNames.length)];
  const last = lastNames[Math.floor(Math.random() * lastNames.length)];
  return `${first} ${last}`;
};

export const getRandomFirstName = () =>
  firstNames[Math.floor(Math.random() * firstNames.length)];

export const getRandomLastName = () =>
  lastNames[Math.floor(Math.random() * lastNames.length)];

