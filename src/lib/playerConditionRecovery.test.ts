import { describe, expect, it } from 'vitest';
import {
  CONDITION_RECOVERY_STEP,
  CONDITION_RECOVERY_INTERVAL_MS,
  HEALTH_RECOVERY_STEP,
  MOTIVATION_RECOVERY_STEP,
  createConditionRecoveryDueAt,
  formatConditionRecoveryGainPercent,
  readConditionRecoveryToastAverageGainPct,
  shouldSkipConditionRecoveryTrigger,
} from './playerConditionRecovery';

describe('playerConditionRecovery', () => {
  it('uses the balanced four-hour recovery rates', () => {
    expect(CONDITION_RECOVERY_STEP).toBe(0.05);
    expect(MOTIVATION_RECOVERY_STEP).toBe(0.03);
    expect(HEALTH_RECOVERY_STEP).toBe(0.02);
  });

  it('creates the next due timestamp four hours ahead', () => {
    const nowMs = Date.parse('2026-04-18T12:00:00.000Z');
    expect(createConditionRecoveryDueAt(nowMs)).toBe(
      new Date(nowMs + CONDITION_RECOVERY_INTERVAL_MS).toISOString(),
    );
  });

  it('reads the accumulated average gain from the pending toast summary', () => {
    expect(
      readConditionRecoveryToastAverageGainPct({
        totalGain: 0.5,
        totalPlayers: 25,
        affectedPlayers: 25,
        appliedTicks: 2,
        updatedAt: '2026-04-18T16:00:00.000Z',
      }),
    ).toBe(2);

    expect(
      readConditionRecoveryToastAverageGainPct({
        totalGain: 0.03,
        totalPlayers: 2,
        affectedPlayers: 2,
        appliedTicks: 2,
        updatedAt: '2026-04-18T16:00:00.000Z',
      }),
    ).toBe(1.5);
  });

  it('returns zero average for empty or invalid pending toast data', () => {
    expect(readConditionRecoveryToastAverageGainPct(null)).toBe(0);
    expect(
      readConditionRecoveryToastAverageGainPct({
        totalGain: 0,
        totalPlayers: 25,
        affectedPlayers: 0,
        appliedTicks: 0,
        updatedAt: '2026-04-18T16:00:00.000Z',
      }),
    ).toBe(0);
    expect(
      readConditionRecoveryToastAverageGainPct({
        totalGain: 0.5,
        totalPlayers: 0,
        affectedPlayers: 0,
        appliedTicks: 2,
        updatedAt: '2026-04-18T16:00:00.000Z',
      }),
    ).toBe(0);
  });

  it('formats the gain percentage for toast output', () => {
    expect(formatConditionRecoveryGainPercent(2)).toBe('2');
    expect(formatConditionRecoveryGainPercent(1.5)).toBe('1,5');
    expect(formatConditionRecoveryGainPercent(1.04)).toBe('1');
  });

  it('throttles immediate duplicate login and foreground triggers for the same user', () => {
    const nowMs = Date.parse('2026-04-18T12:00:00.000Z');

    expect(
      shouldSkipConditionRecoveryTrigger(
        { inFlight: true, lastRunAtMs: nowMs, lastUserId: 'user-1' },
        { userId: 'user-1', nowMs },
      ),
    ).toBe(true);

    expect(
      shouldSkipConditionRecoveryTrigger(
        { inFlight: false, lastRunAtMs: nowMs, lastUserId: 'user-1' },
        { userId: 'user-1', nowMs: nowMs + 500 },
      ),
    ).toBe(true);

    expect(
      shouldSkipConditionRecoveryTrigger(
        { inFlight: false, lastRunAtMs: nowMs, lastUserId: 'user-1' },
        { userId: 'user-2', nowMs: nowMs + 500 },
      ),
    ).toBe(false);
  });

  it('allows a new trigger once the cooldown window expires', () => {
    const nowMs = Date.parse('2026-04-18T12:00:00.000Z');

    expect(
      shouldSkipConditionRecoveryTrigger(
        { inFlight: false, lastRunAtMs: nowMs, lastUserId: 'user-1' },
        { userId: 'user-1', nowMs: nowMs + 2_000 },
      ),
    ).toBe(false);
  });
});
