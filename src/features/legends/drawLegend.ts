import type { LegendPlayer } from './players';

export function drawLegend(players: LegendPlayer[]): LegendPlayer {
  const total = players.reduce((sum, p) => sum + p.weight, 0);
  let target = Math.random() * total;
  for (const p of players) {
    target -= p.weight;
    if (target <= 0) {
      return p;
    }
  }
  return players[players.length - 1];
}
