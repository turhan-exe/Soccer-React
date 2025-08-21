export interface CandidatePlayer {
  name: string;
  age: number;
  position: string;
  overall: number;
  potential: number;
  traits: string[];
  attributes: {
    topSpeed: number;
    shooting: number;
  };
}

const NAMES = ['Ahmet', 'Mehmet', 'Ali', 'Can', 'Emre', 'Mert'];
const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'];
const TRAITS = ['Hızlı', 'Güçlü', 'Teknik', 'Dayanıklı'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateMockCandidate(): CandidatePlayer {
  const overall = Math.random();
  const potential = Math.min(1, overall + Math.random() * 0.2);
  return {
    name: pick(NAMES),
    age: randomInt(16, 19),
    position: pick(POSITIONS),
    overall,
    potential,
    traits: [pick(TRAITS)],
    attributes: {
      topSpeed: Math.random(),
      shooting: Math.random(),
    },
  };
}
