import {
  buildResolvedSlotAssignments,
  canonicalizePosition,
  findFormationSlots,
  normalizeSlotAssignments,
  type TeamSlotAssignmentPayload,
} from './unityRuntimePayload.js';

export const SQUAD_REPAIR_STARTER_TARGET = 11;
export const SQUAD_REPAIR_BENCH_TARGET = 11;
export const SQUAD_REPAIR_DEFAULT_FORMATION = '4-2-3-1';

type SquadRole = 'starting' | 'bench' | 'reserve';

type PlayerContract = {
  expiresAt?: string | null;
  status?: string | null;
};

type ManualFormationMap = Record<
  string,
  Record<string, { x?: number; y?: number; position?: string }>
>;

export type SquadRepairPlayer = {
  id: string;
  position?: string | null;
  roles?: string[] | null;
  overall?: number | null;
  squadRole?: string | null;
  injuryStatus?: string | null;
  contract?: PlayerContract | null;
  [key: string]: unknown;
};

export type SquadRepairRecord = {
  formation?: string | null;
  shape?: string | null;
  tactics?: Record<string, unknown> | null;
  starters?: string[] | null;
  subs?: string[] | null;
  bench?: string[] | null;
  reserves?: string[] | null;
  slotAssignments?: TeamSlotAssignmentPayload[] | null;
  customFormations?: ManualFormationMap | null;
  updatedAt?: string | null;
  [key: string]: unknown;
};

export type SquadRepairTeam = {
  players?: SquadRepairPlayer[] | null;
  lineup?: SquadRepairRecord | null;
  plan?: SquadRepairRecord | null;
};

type SquadRepairSourceKind = 'lineup' | 'plan' | 'roles' | 'auto';

type SquadRepairSource = {
  kind: SquadRepairSourceKind;
  record: SquadRepairRecord | null;
  starters: string[];
  bench: string[];
  reserves: string[];
};

type FinalSquad = {
  starters: string[];
  bench: string[];
  reserves: string[];
  slotAssignments: TeamSlotAssignmentPayload[] | undefined;
};

export type SquadRepairPayload = {
  players: SquadRepairPlayer[];
  lineup: SquadRepairRecord;
  plan: SquadRepairRecord;
};

export type RepairIncompleteSquadResult =
  | {
      status: 'healthy';
      candidate: false;
      changed: false;
      reasons: string[];
      repairable: false;
    }
  | {
      status: 'skipped_insufficient_roster';
      candidate: true;
      changed: false;
      reasons: string[];
      repairable: false;
    }
  | {
      status: 'repaired';
      candidate: true;
      changed: true;
      reasons: string[];
      repairable: true;
      payload: SquadRepairPayload;
      formation: string;
      starters: string[];
      bench: string[];
      reserves: string[];
      sourceKind: SquadRepairSourceKind;
    };

type RepairIncompleteSquadOptions = {
  now?: Date;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function dedupeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );
}

function listFromRecord(record: SquadRepairRecord | null | undefined, key: 'starters' | 'subs' | 'bench' | 'reserves') {
  if (!record) return [];
  return dedupeIds(record[key]);
}

function parseContractExpiryMs(contract: PlayerContract | null | undefined): number | null {
  const raw = normalizeString(contract?.expiresAt);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function isEligibleSquadRepairPlayer(player: SquadRepairPlayer, now = new Date()): boolean {
  if (!player || !normalizeString(player.id)) {
    return false;
  }

  if (String(player.injuryStatus || '').trim().toLowerCase() === 'injured') {
    return false;
  }

  if (String(player.contract?.status || '').trim().toLowerCase() === 'released') {
    return false;
  }

  const expiresAtMs = parseContractExpiryMs(player.contract);
  if (expiresAtMs !== null && expiresAtMs <= now.getTime()) {
    return false;
  }

  return true;
}

function rolePriority(role: unknown): number {
  switch (String(role || '').trim()) {
    case 'bench':
      return 0;
    case 'reserve':
      return 1;
    case 'starting':
      return 2;
    default:
      return 3;
  }
}

function overallValue(player: SquadRepairPlayer): number {
  const numeric = typeof player.overall === 'number' ? player.overall : Number(player.overall);
  return Number.isFinite(numeric) ? numeric : 0;
}

function compareIdSets(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

function sanitizeCurrentRoleSource(players: SquadRepairPlayer[]): SquadRepairSource | null {
  const starters = dedupeIds(players.filter((player) => player.squadRole === 'starting').map((player) => player.id));
  const bench = dedupeIds(players.filter((player) => player.squadRole === 'bench').map((player) => player.id))
    .filter((id) => !starters.includes(id));
  const reserves = dedupeIds(players.filter((player) => player.squadRole === 'reserve').map((player) => player.id))
    .filter((id) => !starters.includes(id) && !bench.includes(id));

  if (starters.length === 0 && bench.length === 0 && reserves.length === 0) {
    return null;
  }

  return {
    kind: 'roles',
    record: null,
    starters,
    bench,
    reserves,
  };
}

function sanitizeSavedSource(args: {
  kind: 'lineup' | 'plan';
  record: SquadRepairRecord | null | undefined;
  rosterIds: Set<string>;
  eligibleIds: Set<string>;
}): SquadRepairSource | null {
  const { kind, record, rosterIds, eligibleIds } = args;
  if (!record) return null;

  const starters = listFromRecord(record, 'starters');
  if (starters.length === 0 || starters.length > SQUAD_REPAIR_STARTER_TARGET) {
    return null;
  }

  const benchSource = Array.isArray(record.subs) ? record.subs : record.bench;
  const bench = dedupeIds(benchSource).filter((id) => !starters.includes(id));
  const reserves = listFromRecord(record, 'reserves').filter(
    (id) => !starters.includes(id) && !bench.includes(id),
  );

  const uniqueInputCount =
    starters.length +
    dedupeIds(benchSource).length +
    listFromRecord(record, 'reserves').length;
  const uniqueSanitizedCount = starters.length + bench.length + reserves.length;
  if (uniqueInputCount !== uniqueSanitizedCount) {
    return null;
  }

  const allIds = [...starters, ...bench, ...reserves];
  if (allIds.some((id) => !rosterIds.has(id) || !eligibleIds.has(id))) {
    return null;
  }

  return {
    kind,
    record,
    starters,
    bench,
    reserves,
  };
}

function pickSource(args: {
  team: SquadRepairTeam;
  players: SquadRepairPlayer[];
  rosterIds: Set<string>;
  eligibleIds: Set<string>;
}): SquadRepairSource | null {
  const lineupSource = sanitizeSavedSource({
    kind: 'lineup',
    record: args.team.lineup,
    rosterIds: args.rosterIds,
    eligibleIds: args.eligibleIds,
  });
  if (lineupSource) return lineupSource;

  const planSource = sanitizeSavedSource({
    kind: 'plan',
    record: args.team.plan,
    rosterIds: args.rosterIds,
    eligibleIds: args.eligibleIds,
  });
  if (planSource) return planSource;

  const roleSource = sanitizeCurrentRoleSource(args.players);
  if (!roleSource) return null;

  const roleIds = [...roleSource.starters, ...roleSource.bench, ...roleSource.reserves];
  if (roleIds.some((id) => !args.rosterIds.has(id) || !args.eligibleIds.has(id))) {
    return null;
  }

  return roleSource;
}

function resolveBaseFormation(team: SquadRepairTeam, source: SquadRepairSource | null): string {
  return (
    normalizeString(source?.record?.formation) ||
    normalizeString(team.lineup?.formation) ||
    normalizeString(team.plan?.formation) ||
    SQUAD_REPAIR_DEFAULT_FORMATION
  );
}

function resolveBaseShape(team: SquadRepairTeam, source: SquadRepairSource | null): string | undefined {
  return (
    normalizeString(source?.record?.shape) ||
    normalizeString(team.lineup?.shape) ||
    normalizeString(team.plan?.shape) ||
    undefined
  ) ?? undefined;
}

function resolveBaseTactics(team: SquadRepairTeam, source: SquadRepairSource | null): Record<string, unknown> {
  if (isObject(team.lineup?.tactics)) {
    return team.lineup?.tactics as Record<string, unknown>;
  }
  if (isObject(source?.record?.tactics)) {
    return source?.record?.tactics as Record<string, unknown>;
  }
  return {};
}

function resolveBaseCustomFormations(team: SquadRepairTeam, source: SquadRepairSource | null): ManualFormationMap | undefined {
  if (isObject(source?.record?.customFormations)) {
    return source?.record?.customFormations as ManualFormationMap;
  }
  if (isObject(team.lineup?.customFormations)) {
    return team.lineup?.customFormations as ManualFormationMap;
  }
  if (isObject(team.plan?.customFormations)) {
    return team.plan?.customFormations as ManualFormationMap;
  }
  return undefined;
}

function compareCandidatesForSlot(
  left: SquadRepairPlayer,
  right: SquadRepairPlayer,
  slotPosition: string,
  playerIndex: Map<string, number>,
): number {
  const canonicalSlot = canonicalizePosition(slotPosition, 'CM');
  const leftPosition = canonicalizePosition(left.position, 'CM');
  const rightPosition = canonicalizePosition(right.position, 'CM');
  const leftRoleMatch =
    leftPosition === canonicalSlot ||
    (Array.isArray(left.roles) &&
      left.roles.some((role) => canonicalizePosition(role, canonicalSlot) === canonicalSlot));
  const rightRoleMatch =
    rightPosition === canonicalSlot ||
    (Array.isArray(right.roles) &&
      right.roles.some((role) => canonicalizePosition(role, canonicalSlot) === canonicalSlot));

  const leftExact = leftPosition === canonicalSlot ? 1 : 0;
  const rightExact = rightPosition === canonicalSlot ? 1 : 0;
  if (rightExact !== leftExact) {
    return rightExact - leftExact;
  }

  const leftFlexible = leftRoleMatch ? 1 : 0;
  const rightFlexible = rightRoleMatch ? 1 : 0;
  if (rightFlexible !== leftFlexible) {
    return rightFlexible - leftFlexible;
  }

  const overallDelta = overallValue(right) - overallValue(left);
  if (overallDelta !== 0) {
    return overallDelta;
  }

  const priorityDelta = rolePriority(left.squadRole) - rolePriority(right.squadRole);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return (playerIndex.get(String(left.id)) ?? Number.MAX_SAFE_INTEGER) -
    (playerIndex.get(String(right.id)) ?? Number.MAX_SAFE_INTEGER);
}

function compareBenchCandidates(
  left: SquadRepairPlayer,
  right: SquadRepairPlayer,
  playerIndex: Map<string, number>,
): number {
  const overallDelta = overallValue(right) - overallValue(left);
  if (overallDelta !== 0) {
    return overallDelta;
  }

  const priorityDelta = rolePriority(left.squadRole) - rolePriority(right.squadRole);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return (playerIndex.get(String(left.id)) ?? Number.MAX_SAFE_INTEGER) -
    (playerIndex.get(String(right.id)) ?? Number.MAX_SAFE_INTEGER);
}

function completeStarters(args: {
  formation: string;
  players: SquadRepairPlayer[];
  preservedStarterIds: string[];
  customFormations?: ManualFormationMap;
  playerIndex: Map<string, number>;
}): { starterIds: string[]; assignments: TeamSlotAssignmentPayload[] | undefined } {
  const slots = findFormationSlots(args.formation);
  if (slots.length === 0) {
    return { starterIds: [], assignments: undefined };
  }

  const initialAssignments =
    buildResolvedSlotAssignments({
      formation: args.formation,
      players: args.players,
      starters: args.preservedStarterIds,
      customFormations: args.customFormations,
    }) || [];

  const playersById = new Map(args.players.map((player) => [String(player.id), player] as const));
  const assignmentBySlot = new Map(initialAssignments.map((assignment) => [assignment.slotIndex, assignment] as const));
  const usedIds = new Set(initialAssignments.map((assignment) => assignment.playerId));

  slots.forEach((slot, slotIndex) => {
    if (assignmentBySlot.has(slotIndex)) {
      return;
    }

    const candidates = args.players
      .filter((player) => !usedIds.has(String(player.id)))
      .sort((left, right) =>
        compareCandidatesForSlot(left, right, slot.position, args.playerIndex),
      );
    const candidate = candidates[0];
    if (!candidate) {
      return;
    }

    const playerId = String(candidate.id);
    assignmentBySlot.set(slotIndex, {
      playerId,
      slotIndex,
      position: canonicalizePosition(slot.position, 'CM'),
      x: slot.x,
      y: slot.y,
    });
    usedIds.add(playerId);
  });

  const assignments = slots
    .map((slot, slotIndex) => {
      const assignment = assignmentBySlot.get(slotIndex);
      if (!assignment) return null;
      const player = playersById.get(assignment.playerId);
      if (!player) return null;
      return {
        playerId: assignment.playerId,
        slotIndex,
        position: canonicalizePosition(assignment.position || slot.position, canonicalizePosition(slot.position, 'CM')),
        x: typeof assignment.x === 'number' ? assignment.x : slot.x,
        y: typeof assignment.y === 'number' ? assignment.y : slot.y,
      } satisfies TeamSlotAssignmentPayload;
    })
    .filter((assignment): assignment is TeamSlotAssignmentPayload => assignment !== null);

  return {
    starterIds: assignments.map((assignment) => assignment.playerId),
    assignments: assignments.length > 0 ? assignments : undefined,
  };
}

function buildFinalSquad(args: {
  team: SquadRepairTeam;
  players: SquadRepairPlayer[];
  eligiblePlayers: SquadRepairPlayer[];
  source: SquadRepairSource | null;
  formation: string;
  customFormations?: ManualFormationMap;
  playerIndex: Map<string, number>;
}): FinalSquad {
  const completed = completeStarters({
    formation: args.formation,
    players: args.eligiblePlayers,
    preservedStarterIds: args.source?.starters || [],
    customFormations: args.customFormations,
    playerIndex: args.playerIndex,
  });

  const starterIds =
    args.source &&
    args.source.starters.length === SQUAD_REPAIR_STARTER_TARGET &&
    compareIdSets(args.source.starters, completed.starterIds)
      ? args.source.starters
      : completed.starterIds;

  const starterSet = new Set(starterIds);

  const benchIds = [...(args.source?.bench || [])].filter((id) => !starterSet.has(id));
  const benchSet = new Set(benchIds);

  const benchCandidates = args.eligiblePlayers
    .filter((player) => !starterSet.has(String(player.id)) && !benchSet.has(String(player.id)))
    .sort((left, right) => compareBenchCandidates(left, right, args.playerIndex));

  for (const player of benchCandidates) {
    if (benchIds.length >= SQUAD_REPAIR_BENCH_TARGET) {
      break;
    }
    const playerId = String(player.id);
    benchIds.push(playerId);
    benchSet.add(playerId);
  }

  const reserveIds = [...(args.source?.reserves || [])].filter(
    (id) => !starterSet.has(id) && !benchSet.has(id),
  );
  const reserveSet = new Set(reserveIds);

  args.players.forEach((player) => {
    const playerId = String(player.id);
    if (starterSet.has(playerId) || benchSet.has(playerId) || reserveSet.has(playerId)) {
      return;
    }
    reserveIds.push(playerId);
    reserveSet.add(playerId);
  });

  const starterSetChanged =
    !args.source || !compareIdSets(args.source.starters, starterIds);
  const existingSlotAssignments =
    args.source?.record?.slotAssignments != null
      ? normalizeSlotAssignments(args.source.record.slotAssignments)?.filter((assignment) =>
          starterSet.has(assignment.playerId),
        )
      : undefined;
  const reusableSlotAssignments =
    !starterSetChanged &&
    existingSlotAssignments &&
    existingSlotAssignments.length === starterIds.length &&
    compareIdSets(
      existingSlotAssignments.map((assignment) => assignment.playerId),
      starterIds,
    )
      ? existingSlotAssignments
      : undefined;

  return {
    starters: starterIds,
    bench: benchIds,
    reserves: reserveIds,
    slotAssignments: reusableSlotAssignments || completed.assignments,
  };
}

function buildPlayersWithRoles(
  players: SquadRepairPlayer[],
  starters: string[],
  bench: string[],
): SquadRepairPlayer[] {
  const starterSet = new Set(starters);
  const benchSet = new Set(bench);

  return players.map((player) => {
    const playerId = String(player.id);
    let nextRole: SquadRole = 'reserve';
    if (starterSet.has(playerId)) {
      nextRole = 'starting';
    } else if (benchSet.has(playerId)) {
      nextRole = 'bench';
    }

    if (player.squadRole === nextRole) {
      return player;
    }

    return {
      ...player,
      squadRole: nextRole,
    };
  });
}

function snapshotPlayers(players: SquadRepairPlayer[]) {
  return players.map((player) => ({
    id: String(player.id),
    squadRole: String(player.squadRole || 'reserve'),
  }));
}

function snapshotPlan(record: SquadRepairRecord | null | undefined) {
  return {
    formation: normalizeString(record?.formation) || null,
    shape: normalizeString(record?.shape) || null,
    starters: listFromRecord(record, 'starters'),
    bench: dedupeIds(Array.isArray(record?.subs) ? record?.subs : record?.bench),
    reserves: listFromRecord(record, 'reserves'),
    slotAssignments: normalizeSlotAssignments(record?.slotAssignments) || [],
    customFormations: isObject(record?.customFormations) ? record?.customFormations : null,
  };
}

function snapshotLineup(record: SquadRepairRecord | null | undefined) {
  return {
    formation: normalizeString(record?.formation) || null,
    shape: normalizeString(record?.shape) || null,
    tactics: isObject(record?.tactics) ? record?.tactics : {},
    starters: listFromRecord(record, 'starters'),
    subs: dedupeIds(Array.isArray(record?.subs) ? record?.subs : record?.bench),
    reserves: listFromRecord(record, 'reserves'),
    slotAssignments: normalizeSlotAssignments(record?.slotAssignments) || [],
    customFormations: isObject(record?.customFormations) ? record?.customFormations : null,
  };
}

function buildCandidateReasons(args: {
  players: SquadRepairPlayer[];
  source: SquadRepairSource | null;
  lineup: SquadRepairRecord | null | undefined;
  plan: SquadRepairRecord | null | undefined;
}): string[] {
  const reasons: string[] = [];
  const currentStarterIds = dedupeIds(
    args.players.filter((player) => player.squadRole === 'starting').map((player) => player.id),
  );
  const currentBenchIds = dedupeIds(
    args.players.filter((player) => player.squadRole === 'bench').map((player) => player.id),
  );

  if (currentStarterIds.length < SQUAD_REPAIR_STARTER_TARGET) {
    reasons.push('starter_shortage');
  }
  if (currentBenchIds.length < SQUAD_REPAIR_BENCH_TARGET) {
    reasons.push('bench_shortage');
  }

  if (args.source?.kind === 'lineup' || args.source?.kind === 'plan') {
    if (!compareIdSets(currentStarterIds, args.source.starters) || !compareIdSets(currentBenchIds, args.source.bench)) {
      reasons.push('saved_source_role_mismatch');
    }

    const secondarySnapshot =
      args.source.kind === 'lineup'
        ? snapshotPlan(args.plan)
        : snapshotLineup(args.lineup);
    const primarySnapshot =
      args.source.kind === 'lineup'
        ? {
            starters: args.source.starters,
            bench: args.source.bench,
            reserves: args.source.reserves,
          }
        : {
            starters: args.source.starters,
            bench: args.source.bench,
            reserves: args.source.reserves,
          };

    if (
      !compareIdSets(secondarySnapshot.starters, primarySnapshot.starters) ||
      !compareIdSets(
        'bench' in secondarySnapshot ? secondarySnapshot.bench : secondarySnapshot.subs,
        primarySnapshot.bench,
      ) ||
      !compareIdSets(secondarySnapshot.reserves, primarySnapshot.reserves)
    ) {
      reasons.push('saved_record_divergence');
    }
  }

  return Array.from(new Set(reasons));
}

export function repairIncompleteSquad(
  team: SquadRepairTeam,
  options: RepairIncompleteSquadOptions = {},
): RepairIncompleteSquadResult {
  const now = options.now instanceof Date && !Number.isNaN(options.now.getTime())
    ? options.now
    : new Date();
  const nowIso = now.toISOString();
  const players = Array.isArray(team.players) ? team.players.slice() : [];
  const rosterIds = new Set(players.map((player) => String(player.id)));
  const eligiblePlayers = players.filter((player) => isEligibleSquadRepairPlayer(player, now));
  const eligibleIds = new Set(eligiblePlayers.map((player) => String(player.id)));
  const playerIndex = new Map(players.map((player, index) => [String(player.id), index] as const));
  const source = pickSource({
    team,
    players,
    rosterIds,
    eligibleIds,
  });

  const reasons = buildCandidateReasons({
    players,
    source,
    lineup: team.lineup,
    plan: team.plan,
  });

  if (reasons.length === 0) {
    return {
      status: 'healthy',
      candidate: false,
      changed: false,
      reasons,
      repairable: false,
    };
  }

  if (eligiblePlayers.length < SQUAD_REPAIR_STARTER_TARGET) {
    return {
      status: 'skipped_insufficient_roster',
      candidate: true,
      changed: false,
      reasons,
      repairable: false,
    };
  }

  const formation = resolveBaseFormation(team, source);
  const shape = resolveBaseShape(team, source);
  const tactics = resolveBaseTactics(team, source);
  const customFormations = resolveBaseCustomFormations(team, source);
  const finalSquad = buildFinalSquad({
    team,
    players,
    eligiblePlayers,
    source,
    formation,
    customFormations,
    playerIndex,
  });

  if (finalSquad.starters.length < SQUAD_REPAIR_STARTER_TARGET) {
    return {
      status: 'skipped_insufficient_roster',
      candidate: true,
      changed: false,
      reasons,
      repairable: false,
    };
  }

  const nextPlayers = buildPlayersWithRoles(players, finalSquad.starters, finalSquad.bench);
  const nextLineup: SquadRepairRecord = {
    ...(isObject(team.lineup) ? team.lineup : {}),
    formation,
    tactics,
    starters: finalSquad.starters,
    subs: finalSquad.bench,
    reserves: finalSquad.reserves,
    updatedAt: nowIso,
    ...(shape ? { shape } : {}),
    ...(customFormations ? { customFormations } : {}),
    ...(finalSquad.slotAssignments ? { slotAssignments: finalSquad.slotAssignments } : {}),
  };
  const nextPlan: SquadRepairRecord = {
    ...(isObject(team.plan) ? team.plan : {}),
    formation,
    starters: finalSquad.starters,
    bench: finalSquad.bench,
    reserves: finalSquad.reserves,
    updatedAt: nowIso,
    ...(shape ? { shape } : {}),
    ...(customFormations ? { customFormations } : {}),
    ...(finalSquad.slotAssignments ? { slotAssignments: finalSquad.slotAssignments } : {}),
  };

  const changed =
    JSON.stringify(snapshotPlayers(players)) !== JSON.stringify(snapshotPlayers(nextPlayers)) ||
    JSON.stringify(snapshotPlan(team.plan)) !== JSON.stringify(snapshotPlan(nextPlan)) ||
    JSON.stringify(snapshotLineup(team.lineup)) !== JSON.stringify(snapshotLineup(nextLineup));

  if (!changed) {
    return {
      status: 'skipped_insufficient_roster',
      candidate: true,
      changed: false,
      reasons,
      repairable: false,
    };
  }

  return {
    status: 'repaired',
    candidate: true,
    changed: true,
    reasons,
    repairable: true,
    payload: {
      players: nextPlayers,
      lineup: nextLineup,
      plan: nextPlan,
    },
    formation,
    starters: finalSquad.starters,
    bench: finalSquad.bench,
    reserves: finalSquad.reserves,
    sourceKind: source?.kind || 'auto',
  };
}
