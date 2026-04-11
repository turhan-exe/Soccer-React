import { translate } from '@/i18n/runtime';
import type { AppLanguage } from '@/i18n/types';
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

export const getYouthDevelopmentLabel = (gap: number, language?: AppLanguage): string => {
  if (gap >= 30) {
    return translate('common.youthDevelopmentLabels.elite', undefined, language);
  }
  if (gap >= 20) {
    return translate('common.youthDevelopmentLabels.high', undefined, language);
  }
  if (gap >= 10) {
    return translate('common.youthDevelopmentLabels.open', undefined, language);
  }
  return translate('common.youthDevelopmentLabels.ready', undefined, language);
};

export const getYouthRoleSummary = (
  player: Player,
  language?: AppLanguage,
): {
  primaryRole: string;
  secondaryRoles: string[];
} => {
  const primaryRole = getPositionLabel(player.position, language);
  const secondaryRoleSet = new Set<Position>(
    (player.roles ?? []).filter(role => role !== player.position),
  );

  return {
    primaryRole,
    secondaryRoles: Array.from(secondaryRoleSet).map(role =>
      getPositionLabel(role, language),
    ),
  };
};

export const getYouthAvatarUrl = (player: Player): string =>
  player.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(player.name)}`;
