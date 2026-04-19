import { describe, expect, it } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';
import {
  alignLeagueStartDate,
  assignLeagueKickoffHours,
  parseLeagueKickoffHours,
} from './leagueKickoff';

describe('league kickoff helpers', () => {
  it('assigns kickoff hours evenly across the configured pool', () => {
    const pool = parseLeagueKickoffHours('12,15,16,17,18,19');
    const hours = assignLeagueKickoffHours({ pool, count: 25 });

    const counts = new Map<number, number>();
    hours.forEach((hour) => counts.set(hour, (counts.get(hour) || 0) + 1));

    expect(hours).toHaveLength(25);
    expect(counts.get(12)).toBe(5);
    expect(counts.get(15)).toBe(4);
    expect(counts.get(16)).toBe(4);
    expect(counts.get(17)).toBe(4);
    expect(counts.get(18)).toBe(4);
    expect(counts.get(19)).toBe(4);
  });

  it('keeps the calendar day and swaps only the TR kickoff hour', () => {
    const aligned = alignLeagueStartDate(new Date('2026-04-01T16:00:00.000Z'), 12);

    expect(formatInTimeZone(aligned, 'Europe/Istanbul', 'yyyy-MM-dd HH:mm')).toBe('2026-04-01 12:00');
  });
});
