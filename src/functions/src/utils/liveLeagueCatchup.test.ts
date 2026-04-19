import { describe, expect, it } from 'vitest';
import {
  MANUAL_CATCHUP_RESERVATION_BUFFER_MINUTES,
  resolveReservationKickoffAt,
  resolveSameDayRetryKickoffAt,
} from './liveLeagueCatchup';

describe('resolveReservationKickoffAt', () => {
  it('keeps scheduled automatic kickoff times unchanged', () => {
    const kickoffAt = new Date('2026-04-19T15:00:00.000Z');
    const resolved = resolveReservationKickoffAt(
      kickoffAt,
      {},
      new Date('2026-04-19T16:00:00.000Z'),
    );

    expect(resolved?.toISOString()).toBe('2026-04-19T15:00:00.000Z');
  });

  it('moves past manual catchup reservations into the future buffer window', () => {
    const now = new Date('2026-04-19T16:00:00.000Z');
    const resolved = resolveReservationKickoffAt(
      new Date('2026-04-19T13:00:00.000Z'),
      { allForDay: true },
      now,
    );

    expect(resolved?.toISOString()).toBe(
      new Date(
        now.getTime() +
          MANUAL_CATCHUP_RESERVATION_BUFFER_MINUTES * 60_000,
      ).toISOString(),
    );
  });

  it('does not shift future manual catchup reservations', () => {
    const resolved = resolveReservationKickoffAt(
      new Date('2026-04-19T18:00:00.000Z'),
      { kickoffHour: 21 },
      new Date('2026-04-19T16:00:00.000Z'),
    );

    expect(resolved?.toISOString()).toBe('2026-04-19T18:00:00.000Z');
  });

  it('finds the next same-day retry kickoff without moving the fixture day', () => {
    const resolved = resolveSameDayRetryKickoffAt(
      new Date('2026-04-19T09:00:00.000Z'),
      new Date('2026-04-19T09:10:00.000Z'),
      [12, 15, 16, 17, 18, 19],
      5,
    );

    expect(resolved?.toISOString()).toBe('2026-04-19T12:00:00.000Z');
  });

  it('returns null when no same-day retry slot remains', () => {
    const resolved = resolveSameDayRetryKickoffAt(
      new Date('2026-04-19T16:00:00.000Z'),
      new Date('2026-04-19T17:10:00.000Z'),
      [12, 15, 16, 17],
      5,
    );

    expect(resolved).toBeNull();
  });
});
