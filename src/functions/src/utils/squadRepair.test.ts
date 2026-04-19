import { describe, expect, it } from 'vitest';
import {
  repairIncompleteSquad,
  SQUAD_REPAIR_BENCH_TARGET,
  SQUAD_REPAIR_STARTER_TARGET,
} from './squadRepair';

function createPlayer(index: number, role: 'starting' | 'bench' | 'reserve' = 'reserve') {
  const positions = ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CAM', 'LW', 'ST', 'RW'] as const;
  const position = positions[(index - 1) % positions.length] || 'CM';

  return {
    id: `p${index}`,
    name: `Player ${index}`,
    position,
    roles: [position, 'CM'],
    overall: 90 - index,
    squadRole: role,
    injuryStatus: 'healthy',
    contract: {
      status: 'active',
      expiresAt: '2026-12-31T00:00:00.000Z',
    },
  };
}

function createRoster() {
  const players = Array.from({ length: 24 }, (_, index) =>
    createPlayer(
      index + 1,
      index < SQUAD_REPAIR_STARTER_TARGET
        ? 'starting'
        : index < SQUAD_REPAIR_STARTER_TARGET + SQUAD_REPAIR_BENCH_TARGET
          ? 'bench'
          : 'reserve',
    ),
  );
  return players;
}

describe('repairIncompleteSquad', () => {
  it('keeps a valid saved lineup and only syncs player squad roles', () => {
    const players = createRoster();
    players[10] = { ...players[10], squadRole: 'reserve' };

    const starters = players.slice(0, 11).map((player) => player.id);
    const bench = players.slice(11, 22).map((player) => player.id);

    const result = repairIncompleteSquad({
      players,
      lineup: {
        formation: '4-2-3-1',
        starters,
        subs: bench,
      },
    });

    expect(result.status).toBe('repaired');
    if (result.status !== 'repaired') return;

    expect(result.sourceKind).toBe('lineup');
    expect(result.payload.players.filter((player) => player.squadRole === 'starting')).toHaveLength(11);
    expect(result.payload.players.find((player) => player.id === players[10].id)?.squadRole).toBe('starting');
    expect(result.payload.lineup.starters).toEqual(starters);
  });

  it('fills the bench from remaining eligible players while preserving the current first eleven', () => {
    const players = createRoster();
    players.forEach((player, index) => {
      if (index >= 16) {
        player.squadRole = 'reserve';
      }
    });

    const currentStarterIds = players
      .filter((player) => player.squadRole === 'starting')
      .map((player) => player.id);

    const result = repairIncompleteSquad({
      players,
    });

    expect(result.status).toBe('repaired');
    if (result.status !== 'repaired') return;

    expect(result.sourceKind).toBe('roles');
    expect(result.starters).toEqual(currentStarterIds);
    expect(result.bench).toHaveLength(SQUAD_REPAIR_BENCH_TARGET);
    expect(new Set(result.bench).size).toBe(result.bench.length);
  });

  it('does not use injured, expired, or released players while completing the squad', () => {
    const players = createRoster();
    players[9] = { ...players[9], squadRole: 'reserve' };
    players[10] = { ...players[10], squadRole: 'reserve' };
    players[11] = { ...players[11], squadRole: 'reserve' };
    players[12] = {
      ...players[12],
      squadRole: 'bench',
      injuryStatus: 'injured',
    };
    players[13] = {
      ...players[13],
      squadRole: 'bench',
      contract: {
        status: 'active',
        expiresAt: '2025-01-01T00:00:00.000Z',
      },
    };
    players[14] = {
      ...players[14],
      squadRole: 'bench',
      contract: {
        status: 'released',
        expiresAt: '2026-12-31T00:00:00.000Z',
      },
    };

    const result = repairIncompleteSquad({
      players,
    });

    expect(result.status).toBe('repaired');
    if (result.status !== 'repaired') return;

    expect(result.starters).not.toContain(players[12].id);
    expect(result.starters).not.toContain(players[13].id);
    expect(result.starters).not.toContain(players[14].id);
    expect(result.bench).not.toContain(players[12].id);
    expect(result.bench).not.toContain(players[13].id);
    expect(result.bench).not.toContain(players[14].id);
  });

  it('never places the same player in both starters and bench', () => {
    const players = createRoster();
    const starterIds = players.slice(0, 10).map((player) => player.id);
    const overlappingId = players[10].id;
    const benchIds = [overlappingId, ...players.slice(11, 20).map((player) => player.id)];

    const result = repairIncompleteSquad({
      players: players.map((player, index) => ({
        ...player,
        squadRole: index < 10 ? 'starting' : index < 20 ? 'bench' : 'reserve',
      })),
      lineup: {
        formation: '4-2-3-1',
        starters: starterIds,
        subs: benchIds,
      },
      plan: {
        formation: '4-2-3-1',
        starters: starterIds,
        bench: benchIds,
      },
    });

    expect(result.status).toBe('repaired');
    if (result.status !== 'repaired') return;

    expect(new Set([...result.starters, ...result.bench]).size).toBe(
      result.starters.length + result.bench.length,
    );
  });

  it('skips repair when there are not enough eligible players to reach eleven starters', () => {
    const players = createRoster().slice(0, 10);

    const result = repairIncompleteSquad({
      players,
    });

    expect(result.status).toBe('skipped_insufficient_roster');
  });

  it('regenerates slot assignments when the starter set changes', () => {
    const players = createRoster();
    players[8] = { ...players[8], squadRole: 'reserve' };
    players[9] = { ...players[9], squadRole: 'reserve' };

    const result = repairIncompleteSquad({
      players,
      lineup: {
        formation: '4-3-3',
        starters: players.slice(0, 9).map((player) => player.id),
        subs: players.slice(11, 20).map((player) => player.id),
      },
    });

    expect(result.status).toBe('repaired');
    if (result.status !== 'repaired') return;

    const slotAssignments = result.payload.lineup.slotAssignments || [];
    expect(slotAssignments).toHaveLength(SQUAD_REPAIR_STARTER_TARGET);
    expect(
      new Set(slotAssignments.map((assignment) => assignment.playerId)),
    ).toEqual(new Set(result.starters));
  });

  it('repairs saved record divergence even when the role counts are already healthy', () => {
    const players = createRoster();
    const starters = players.slice(0, 11).map((player) => player.id);
    const bench = players.slice(11, 22).map((player) => player.id);

    const result = repairIncompleteSquad({
      players,
      lineup: {
        formation: '4-2-3-1',
        starters,
        subs: bench,
      },
    });

    expect(result.status).toBe('repaired');
    if (result.status !== 'repaired') return;

    expect(result.payload.plan.starters).toEqual(starters);
  });
});
