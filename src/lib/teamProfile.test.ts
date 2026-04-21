import { describe, expect, it } from 'vitest';
import type { ClubTeam, Player } from '@/types';
import {
  calculateTeamValue,
  getTeamDisplayFormation,
  getTeamSquadSummary,
  getTeamVitalAverages,
  resolveFriendActionState,
} from './teamProfile';

const createPlayer = (overrides: Partial<Player> = {}): Player => ({
  id: overrides.id ?? 'p1',
  name: overrides.name ?? 'Player',
  position: overrides.position ?? 'CM',
  roles: overrides.roles ?? ['CM'],
  overall: overrides.overall ?? 0.62,
  potential: overrides.potential ?? 0.68,
  attributes: overrides.attributes ?? {
    strength: 0.5,
    acceleration: 0.5,
    topSpeed: 0.5,
    dribbleSpeed: 0.5,
    jump: 0.5,
    tackling: 0.5,
    ballKeeping: 0.5,
    passing: 0.5,
    longBall: 0.5,
    agility: 0.5,
    shooting: 0.5,
    shootPower: 0.5,
    positioning: 0.5,
    reaction: 0.5,
    ballControl: 0.5,
  },
  age: overrides.age ?? 25,
  height: overrides.height ?? 180,
  weight: overrides.weight ?? 75,
  health: overrides.health ?? 1,
  condition: overrides.condition ?? 1,
  motivation: overrides.motivation ?? 1,
  injuryStatus: overrides.injuryStatus ?? 'healthy',
  squadRole: overrides.squadRole ?? 'reserve',
  contract: overrides.contract ?? {
    status: 'active',
    salary: 10_000,
    expiresAt: '2027-01-01T00:00:00.000Z',
    extensions: 0,
  },
  rename: overrides.rename,
});

describe('teamProfile helpers', () => {
  it('returns zero value for an empty squad', () => {
    expect(calculateTeamValue([])).toBe(0);
  });

  it('calculates deterministic team value from player quality, salary, potential, and age', () => {
    const value = calculateTeamValue([
      createPlayer({ id: 'a', overall: 0.70, potential: 0.82, age: 21, contract: { status: 'active', salary: 12_000, expiresAt: '2027-01-01', extensions: 0 } }),
      createPlayer({ id: 'b', overall: 0.48, potential: 0.50, age: 34, contract: { status: 'active', salary: 4_000, expiresAt: '2027-01-01', extensions: 0 } }),
    ]);

    expect(value).toBe(335_640);
  });

  it('ignores released players in team value', () => {
    expect(
      calculateTeamValue([
        createPlayer({ contract: { status: 'released', salary: 20_000, expiresAt: '2027-01-01', extensions: 0 } }),
      ]),
    ).toBe(0);
  });

  it('prefers shape before formation labels', () => {
    const team = {
      plan: { shape: 'Serbest: 3-2-5', formation: '4-4-2', starters: [], bench: [], reserves: [] },
      lineup: { shape: '4-3-3', formation: '4-3-3' },
    } as ClubTeam;

    expect(getTeamDisplayFormation(team)).toBe('Serbest: 3-2-5');
  });

  it('summarizes squad roles and vitals', () => {
    const players = [
      createPlayer({ id: 'a', squadRole: 'starting', condition: 0.5, motivation: 0.7, health: 1 }),
      createPlayer({ id: 'b', squadRole: 'bench', condition: 1, motivation: 0.9, health: 0.8 }),
      createPlayer({ id: 'c', squadRole: 'reserve', condition: 1, motivation: 0.5, health: 0.6 }),
    ];

    expect(getTeamSquadSummary(players)).toEqual({ starters: 1, bench: 1, reserve: 1, total: 3 });
    expect(getTeamVitalAverages(players)).toEqual({ condition: 83, motivation: 70, health: 80 });
  });

  it('resolves friend CTA states', () => {
    expect(resolveFriendActionState({ currentUserId: 'u1', targetTeamId: 'u1', friendStatus: 'none' })).toBe('self');
    expect(resolveFriendActionState({ currentUserId: 'u1', targetTeamId: 'u2', friendStatus: 'friend' })).toBe('friend');
    expect(resolveFriendActionState({ currentUserId: 'u1', targetTeamId: 'u2', friendStatus: 'request_sent' })).toBe('request_sent');
    expect(resolveFriendActionState({ currentUserId: 'u1', targetTeamId: 'u2', friendStatus: 'request_received' })).toBe('request_received');
    expect(resolveFriendActionState({ currentUserId: 'u1', targetTeamId: 'u2', friendStatus: 'none' })).toBe('can_request');
  });
});
