import { describe, expect, it } from 'vitest';
import {
  CONDITION_RECOVERY_INTERVAL_MS,
  applyScheduledConditionRecovery,
  createConditionRecoveryDueAt,
  parseConditionRecoveryIsoMs,
  resolveConditionRecoveryDueAt,
} from './teamConditionRecovery';

const createPlayer = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Recovery Test',
  condition: 0.8,
  motivation: 0.8,
  injuryStatus: 'healthy',
  squadRole: 'starting',
  ...overrides,
});

describe('teamConditionRecovery', () => {
  it('applies one tick when the due time is exactly reached', () => {
    const nowMs = Date.parse('2026-04-18T12:00:00.000Z');
    const result = applyScheduledConditionRecovery({
      players: [createPlayer({ condition: 0.5 })],
      dueAt: '2026-04-18T12:00:00.000Z',
      nowMs,
    });

    expect(result.appliedTicks).toBe(1);
    expect(result.players[0]?.condition).toBe(0.51);
    expect(result.totalGain).toBe(0.01);
    expect(result.nextDueAt).toBe(
      new Date(nowMs + CONDITION_RECOVERY_INTERVAL_MS).toISOString(),
    );
  });

  it('applies two ticks after ten hours from the original seed time', () => {
    const dueAt = '2026-04-18T16:00:00.000Z';
    const nowMs = Date.parse('2026-04-18T22:00:00.000Z');
    const result = applyScheduledConditionRecovery({
      players: [createPlayer({ condition: 0.5 })],
      dueAt,
      nowMs,
    });

    expect(result.appliedTicks).toBe(2);
    expect(result.players[0]?.condition).toBe(0.52);
    expect(result.nextDueAt).toBe(
      new Date(Date.parse(dueAt) + 2 * CONDITION_RECOVERY_INTERVAL_MS).toISOString(),
    );
  });

  it('keeps gain at zero when the player is already capped', () => {
    const result = applyScheduledConditionRecovery({
      players: [createPlayer({ condition: 1 })],
      dueAt: '2026-04-18T16:00:00.000Z',
      nowMs: Date.parse('2026-04-18T22:00:00.000Z'),
    });

    expect(result.appliedTicks).toBe(2);
    expect(result.players[0]?.condition).toBe(1);
    expect(result.totalGain).toBe(0);
    expect(result.pendingToast).toBeNull();
  });

  it('does not apply the same due interval twice once the due time is advanced', () => {
    const first = applyScheduledConditionRecovery({
      players: [createPlayer({ condition: 0.5 })],
      dueAt: '2026-04-18T16:00:00.000Z',
      nowMs: Date.parse('2026-04-18T22:00:00.000Z'),
    });
    const second = applyScheduledConditionRecovery({
      players: first.players,
      dueAt: first.nextDueAt,
      nowMs: Date.parse('2026-04-18T22:00:00.000Z'),
      pendingToast: first.pendingToast,
    });

    expect(first.appliedTicks).toBe(2);
    expect(second.appliedTicks).toBe(0);
    expect(second.totalGain).toBe(0);
    expect(second.players[0]?.condition).toBe(0.52);
  });

  it('derives the new due time from the legacy conditionRecoveryAt value', () => {
    const nowMs = Date.parse('2026-04-18T18:00:00.000Z');
    const resolved = resolveConditionRecoveryDueAt({
      dueAt: null,
      legacyRecoveryAt: '2026-04-18T08:00:00.000Z',
      nowMs,
    });

    expect(resolved.source).toBe('legacy');
    expect(resolved.dueAt).toBe('2026-04-18T12:00:00.000Z');
  });

  it('seeds missing recovery data without granting free progress', () => {
    const nowMs = Date.parse('2026-04-18T18:00:00.000Z');
    const resolved = resolveConditionRecoveryDueAt({
      dueAt: null,
      legacyRecoveryAt: null,
      nowMs,
    });

    expect(resolved.source).toBe('seeded');
    expect(parseConditionRecoveryIsoMs(resolved.dueAt)).toBe(
      nowMs + CONDITION_RECOVERY_INTERVAL_MS,
    );
  });

  it('accumulates pending toast totals across multiple offline ticks', () => {
    const first = applyScheduledConditionRecovery({
      players: [createPlayer({ id: 'p1', condition: 0.5 }), createPlayer({ id: 'p2', condition: 0.5 })],
      dueAt: '2026-04-18T12:00:00.000Z',
      nowMs: Date.parse('2026-04-18T12:00:00.000Z'),
    });
    const second = applyScheduledConditionRecovery({
      players: first.players,
      dueAt: first.nextDueAt,
      nowMs: Date.parse('2026-04-18T16:00:00.000Z'),
      pendingToast: first.pendingToast,
    });

    expect(first.pendingToast).toMatchObject({
      totalGain: 0.02,
      totalPlayers: 2,
      appliedTicks: 1,
    });
    expect(second.pendingToast).toMatchObject({
      totalGain: 0.04,
      totalPlayers: 2,
      appliedTicks: 2,
    });
  });

  it('creates new due times four hours ahead for new teams', () => {
    const nowMs = Date.parse('2026-04-18T12:00:00.000Z');
    expect(createConditionRecoveryDueAt(nowMs)).toBe(
      '2026-04-18T16:00:00.000Z',
    );
  });
});
