import { describe, expect, it } from 'vitest';
import {
  buildResolvedSlotAssignments,
  buildUnityRuntimeTeamPayload,
} from './unityRuntimePayload';

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

  it('preserves free-coordinate roles including shadow striker and extra striker counts', () => {
    const players = Array.from({ length: 11 }, (_, index) =>
      createPlayer(index + 1, 'starting'),
    );

    const assignments = buildResolvedSlotAssignments({
      formation: '4-4-2',
      players,
      starters: players.map((player) => player.id),
      customFormations: {
        '4-4-2': {
          p1: { x: 45, y: 95, position: 'GK', zoneId: 'kaleci' },
          p9: { x: 42, y: 18, position: 'ST', zoneId: 'santrafor' },
          p10: { x: 50, y: 28, position: 'CAM' },
          p11: { x: 58, y: 18, position: 'ST', zoneId: 'santrafor' },
        },
      },
    });

    expect(assignments).toHaveLength(11);
    expect(assignments?.map((assignment) => assignment.slotIndex)).toEqual(
      Array.from({ length: 11 }, (_, index) => index),
    );
    expect(assignments?.find((assignment) => assignment.playerId === 'p10')?.zoneId).toBe(
      'gizli forvet',
    );
    expect(assignments?.find((assignment) => assignment.playerId === 'p10')?.position).toBe(
      'CAM',
    );
    expect(
      assignments?.filter((assignment) => assignment.zoneId === 'santrafor').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('keeps the narrow goalkeeper band aligned with the editor zone rules', () => {
    const players = Array.from({ length: 11 }, (_, index) =>
      createPlayer(index + 1, 'starting'),
    );

    const assignments = buildResolvedSlotAssignments({
      formation: '4-4-2',
      players,
      starters: players.map((player) => player.id),
      customFormations: {
        '4-4-2': {
          p1: { x: 50, y: 93, position: 'GK' },
          p2: { x: 42, y: 88, position: 'CB' },
        },
      },
    });

    expect(assignments?.find((assignment) => assignment.playerId === 'p1')?.zoneId).toBe(
      'kaleci',
    );
    expect(assignments?.find((assignment) => assignment.playerId === 'p2')?.zoneId).toBe(
      'stoper sol',
    );
    expect(assignments?.find((assignment) => assignment.playerId === 'p2')?.position).toBe(
      'CB',
    );
  });
});
