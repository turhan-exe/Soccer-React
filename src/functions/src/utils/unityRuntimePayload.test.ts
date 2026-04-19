import { describe, expect, it } from 'vitest';
import { buildUnityRuntimeTeamPayload } from './unityRuntimePayload';

function createPlayer(index: number, squadRole: 'starting' | 'bench' = 'bench') {
  return {
    id: `p${index}`,
    name: `Player ${index}`,
    squadRole,
    position: index === 1 ? 'GK' : 'CM',
    roles: ['CM'],
    overall: 70,
    potential: 75,
    age: 24,
    height: 180,
    weight: 75,
    condition: 0.8,
    motivation: 0.9,
    attributes: {
      strength: 70,
      acceleration: 70,
      topSpeed: 70,
      dribbleSpeed: 70,
      jump: 70,
      tackling: 70,
      ballKeeping: 70,
      passing: 70,
      longBall: 70,
      agility: 70,
      shooting: 70,
      shootPower: 70,
      positioning: 70,
      reaction: 70,
      ballControl: 70,
    },
    bio: {
      nationality: 'TR',
      city: 'Istanbul',
      notes: 'extra payload field',
    },
    contract: {
      salary: 1000 + index,
      signedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

describe('buildUnityRuntimeTeamPayload', () => {
  it('caps the runtime bench at 12 players and omits raw roster fields', () => {
    const players = Array.from({ length: 24 }, (_, index) =>
      createPlayer(index + 1, index < 11 ? 'starting' : 'bench'),
    );

    const payload = buildUnityRuntimeTeamPayload('team-1', {
      id: 'team-1',
      name: 'Test FC',
      clubName: 'Test FC',
      manager: 'Manager',
      badge: { url: 'badge.png' },
      logo: 'logo.png',
      players,
      lineup: {
        formation: '4-2-3-1',
        starters: players.slice(0, 11).map((player) => player.id),
        subs: players.slice(11).map((player) => player.id),
      },
    });

    expect(payload.teamKey).toBe('team-1');
    expect(payload.teamName).toBe('Test FC');
    expect(payload.lineup).toHaveLength(11);
    expect(payload.bench).toHaveLength(12);
    expect(payload.plan?.bench).toHaveLength(13);
    expect('players' in payload).toBe(false);
    expect('id' in payload).toBe(false);
    expect('teamId' in payload).toBe(false);
    expect('clubName' in payload).toBe(false);
    expect('manager' in payload).toBe(false);
    expect('logo' in payload).toBe(false);
  });
});
