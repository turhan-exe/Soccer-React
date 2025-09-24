export interface SlotMatch {
  round: number;
  homeSlot: number;
  awaySlot: number;
}

/**
 * Double round-robin for slots [1..n]. If n is odd, inserts a BYE and drops BYE pairs.
 * Returns 2*(n-1) rounds with balanced home/away.
 */
export function generateDoubleRoundRobinSlots(n: number): SlotMatch[] {
  if (n < 2) return [];
  const BYE = 0; // 0 is not a valid slot index
  const slots = Array.from({ length: n }, (_, i) => i + 1);
  const arr = [...slots];
  if (arr.length % 2 === 1) arr.push(BYE);
  const m = arr.length;
  const rounds = m - 1; // single round
  const half = m / 2;

  const firstLeg: SlotMatch[] = [];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[m - 1 - i];
      if (a === BYE || b === BYE) continue;
      const even = r % 2 === 0;
      firstLeg.push({ round: r + 1, homeSlot: even ? a : b, awaySlot: even ? b : a });
    }
    const last = arr.pop()!;
    arr.splice(1, 0, last);
  }

  const secondLeg: SlotMatch[] = firstLeg.map((m) => ({
    round: m.round + rounds,
    homeSlot: m.awaySlot,
    awaySlot: m.homeSlot,
  }));

  return [...firstLeg, ...secondLeg];
}

