export interface MatchPair {
  round: number;
  homeTeamId: string;
  awayTeamId: string;
}

// Generates round robin fixtures using Berger algorithm for even number of teams
export function generateRoundRobinFixtures(teamIds: string[]): MatchPair[] {
  const n = teamIds.length;
  if (n % 2 !== 0) {
    throw new Error('Team count must be even');
  }
  const rounds = n - 1;
  const half = n / 2;
  const teams = [...teamIds];
  const fixtures: MatchPair[] = [];

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < half; i++) {
      const homeIdx = (round + i) % (n - 1);
      const awayIdx = (n - 1 - i + round) % (n - 1);
      let home = teams[homeIdx];
      let away = teams[awayIdx];
      if (i === 0) {
        away = teams[n - 1];
      }
      // alternate home/away per round
      if (round % 2 === 1) {
        const tmp = home;
        home = away;
        away = tmp;
      }
      fixtures.push({ round: round + 1, homeTeamId: home, awayTeamId: away });
    }
  }
  return fixtures;
}

// Returns a Date for tomorrow 19:00 in Europe/Istanbul
export function getNextStartDate(): Date {
  const now = new Date();
  const tz = 'Europe/Istanbul';
  // current time in TZ
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const year = Number(parts.find(p => p.type === 'year')?.value);
  const month = Number(parts.find(p => p.type === 'month')?.value);
  const day = Number(parts.find(p => p.type === 'day')?.value) + 1; // tomorrow
  const local = new Date(Date.UTC(year, month - 1, day, 19, 0, 0));
  // convert from TZ to UTC
  const tzOffset = new Date(local.toLocaleString('en-US', { timeZone: tz })).getTime() - local.getTime();
  return new Date(local.getTime() - tzOffset);
}
