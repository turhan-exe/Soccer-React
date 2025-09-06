import type { ClubTeam, Player } from '@/types';

export type ReplayEvent = { ts: number; type: string; payload?: any };
export type ReplayJson = {
  schemaVersion?: number;
  meta?: any;
  initial?: any;
  events: ReplayEvent[];
  final?: { score?: { h: number; a: number }; stats?: any; hash?: string };
};

function pickXI(team: ClubTeam): Player[] {
  const starters = team.players.filter((p) => p.squadRole === 'starting');
  if (starters.length >= 11) return starters.slice(0, 11);
  // Fallback: top 11 by overall
  const sorted = [...team.players].sort((a, b) => (b.overall || 0) - (a.overall || 0));
  return sorted.slice(0, 11);
}

function teamStrength(xi: Player[]): number {
  if (!xi.length) return 0.5;
  const avg = xi.reduce((s, p) => s + (p.overall || 0.5), 0) / xi.length;
  return Math.min(1, Math.max(0, avg));
}

export function simulateMatch(home: ClubTeam, away: ClubTeam, seed = Date.now()): { replay: ReplayJson; score: { h: number; a: number } } {
  // Simple seeded RNG
  let s = seed % 2147483647;
  const rand = () => (s = (s * 48271) % 2147483647) / 2147483647;

  const hXI = pickXI(home);
  const aXI = pickXI(away);
  const hStr = teamStrength(hXI) + 0.03; // tiny home advantage
  const aStr = teamStrength(aXI);
  const totalStr = hStr + aStr || 1;
  const hShare = hStr / totalStr;

  const events: ReplayEvent[] = [];
  const push = (t: number, type: string, payload?: any) => events.push({ ts: t, type, ...(payload !== undefined ? { payload } : {}) });

  push(0, 'kickoff', { home: home.name, away: away.name });

  // Compress 90 min into ~180 seconds playback; 2s per minute
  let hGoals = 0;
  let aGoals = 0;
  let t = 0;
  for (let minute = 1; minute <= 90; minute++) {
    t = minute * 2; // seconds in replay timeline
    // baseline chance rate; ~6-12 chances per match
    const chanceProb = 0.08 + (rand() - 0.5) * 0.02;
    if (rand() < chanceProb) {
      const homeAttacks = rand() < hShare;
      push(t, 'chance', { team: homeAttacks ? 'home' : 'away', minute });
      const quality = (homeAttacks ? hStr : aStr) + (rand() - 0.5) * 0.2;
      const goalProb = 0.28 + 0.3 * Math.max(0, quality - 0.5);
      if (rand() < goalProb) {
        if (homeAttacks) hGoals++; else aGoals++;
        const scorerPool = (homeAttacks ? hXI : aXI).filter((p) => ['ST', 'LW', 'RW', 'CAM'].includes(p.position));
        const scorer = scorerPool[Math.floor(rand() * Math.max(1, scorerPool.length))] || (homeAttacks ? hXI[0] : aXI[0]);
        push(t + 0.3, 'goal', { team: homeAttacks ? 'home' : 'away', minute, scorerId: scorer?.id, scorerName: scorer?.name });
      }
    }
    if (minute === 45) push(t, 'half_time');
  }

  push(180, 'full_time', { score: { h: hGoals, a: aGoals } });

  const replay: ReplayJson = {
    schemaVersion: 1,
    meta: { matchId: `LOCAL-${seed}`, home: { id: home.id, name: home.name }, away: { id: away.id, name: away.name } },
    events,
    final: { score: { h: hGoals, a: aGoals } },
  };

  return { replay, score: { h: hGoals, a: aGoals } };
}

