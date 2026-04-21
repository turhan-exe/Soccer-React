import type { ClubTeam, Player } from '@/types';
import { normalizeRatingTo100 } from '@/lib/player';
import { resolvePlayerSalary } from '@/lib/salary';
import type { FriendStatus } from '@/services/friends';

const ACTIVE_CONTRACT_STATUSES = new Set(['active', 'pending']);

export type FriendActionState =
  | 'self'
  | 'friend'
  | 'request_sent'
  | 'request_received'
  | 'can_request';

const isActivePlayer = (player: Player): boolean => {
  const status = player.contract?.status;
  return !status || ACTIVE_CONTRACT_STATUSES.has(status);
};

export function estimatePlayerMarketValue(player: Player): number {
  if (!isActivePlayer(player)) {
    return 0;
  }

  const rating = normalizeRatingTo100(player.overall);
  const potential = Math.max(rating, normalizeRatingTo100(player.potential));
  const salary = resolvePlayerSalary(player);
  const base = Math.max(25_000, Math.round(rating * 1_500));
  const salaryWeight = salary > 0 ? salary * 8 : 0;
  const potentialWeight = Math.max(0, potential - rating) * 1_250;

  let value = base + salaryWeight + potentialWeight;
  if (typeof player.age === 'number') {
    if (player.age < 24) {
      value *= 1.12;
    } else if (player.age > 32) {
      value *= 0.88;
    }
  }

  return Math.max(0, Math.round(value));
}

export function calculateTeamValue(players: Player[] = []): number {
  return players.reduce((sum, player) => sum + estimatePlayerMarketValue(player), 0);
}

export function getTeamDisplayFormation(team: ClubTeam | null | undefined): string {
  const values = [
    team?.plan?.shape,
    team?.lineup?.shape,
    team?.plan?.formation,
    team?.lineup?.formation,
  ];

  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '-';
}

export function getTeamSquadSummary(players: Player[] = []) {
  return players.reduce(
    (summary, player) => {
      if (player.squadRole === 'starting') summary.starters += 1;
      else if (player.squadRole === 'bench') summary.bench += 1;
      else summary.reserve += 1;
      return summary;
    },
    { starters: 0, bench: 0, reserve: 0, total: players.length },
  );
}

export function getTeamVitalAverages(players: Player[] = []) {
  if (!players.length) {
    return { condition: 0, motivation: 0, health: 0 };
  }

  const totals = players.reduce(
    (sum, player) => ({
      condition: sum.condition + (player.condition ?? 0),
      motivation: sum.motivation + (player.motivation ?? 0),
      health: sum.health + (player.health ?? 0),
    }),
    { condition: 0, motivation: 0, health: 0 },
  );

  return {
    condition: Math.round((totals.condition / players.length) * 100),
    motivation: Math.round((totals.motivation / players.length) * 100),
    health: Math.round((totals.health / players.length) * 100),
  };
}

export function getTopPlayers(players: Player[] = [], count = 5): Player[] {
  return [...players]
    .filter(isActivePlayer)
    .sort((left, right) => normalizeRatingTo100(right.overall) - normalizeRatingTo100(left.overall))
    .slice(0, count);
}

export function resolveFriendActionState(args: {
  currentUserId?: string | null;
  targetTeamId?: string | null;
  friendStatus?: FriendStatus | null;
}): FriendActionState {
  if (args.currentUserId && args.targetTeamId && args.currentUserId === args.targetTeamId) {
    return 'self';
  }

  if (args.friendStatus === 'friend') return 'friend';
  if (args.friendStatus === 'request_sent') return 'request_sent';
  if (args.friendStatus === 'request_received') return 'request_received';
  return 'can_request';
}
