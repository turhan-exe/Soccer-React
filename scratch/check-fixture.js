import { generateRoundRobinFixtures } from '../src/functions/lib/utils/schedule.js';

const teams = ['A','B','C','D','E','F','G','H'];
const fixtures = generateRoundRobinFixtures(teams);

const seq = fixtures
  .filter((m) => m.homeTeamId === 'A' || m.awayTeamId === 'A')
  .sort((a, b) => a.round - b.round)
  .map((m) => `${m.round}: ${m.homeTeamId} vs ${m.awayTeamId}`);

console.log(seq.join('\n'));

