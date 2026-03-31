import type { Player, Position } from '@/types';
import { normalizeRatingTo100 } from '@/lib/player';
import { getPositionLabel } from '@/lib/positionLabels';

export const toPercent = (value?: number | null): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value * 100)));
};

export const getYouthOverall = (player: Player): number =>
  normalizeRatingTo100(player.overall);

export const getYouthPotential = (player: Player): number =>
  normalizeRatingTo100(player.potential ?? player.overall);

export const getYouthDevelopmentGap = (player: Player): number =>
  Math.max(0, getYouthPotential(player) - getYouthOverall(player));

export const getYouthReadiness = (player: Player): number =>
  Math.round(
    (toPercent(player.health) + toPercent(player.condition) + toPercent(player.motivation)) / 3,
  );

export const getYouthDevelopmentLabel = (gap: number): string => {
  if (gap >= 30) {
    return 'Çok Yüksek Potansiyel';
  }
  if (gap >= 20) {
    return 'Yüksek Potansiyel';
  }
  if (gap >= 10) {
    return 'Gelişime Açık';
  }
  return 'Hazıra Yakın';
};

export const getYouthRoleSummary = (player: Player): {
  primaryRole: string;
  secondaryRoles: string[];
} => {
  const primaryRole = getPositionLabel(player.position);
  const secondaryRoleSet = new Set<Position>(
    (player.roles ?? []).filter(role => role !== player.position),
  );

  return {
    primaryRole,
    secondaryRoles: Array.from(secondaryRoleSet).map(getPositionLabel),
  };
};

export const getYouthAvatarUrl = (player: Player): string =>
  player.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(player.name)}`;
