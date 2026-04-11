import { differenceInCalendarDays, differenceInCalendarMonths } from 'date-fns';

import { translate } from '@/i18n/runtime';
import type { AppLanguage } from '@/i18n/types';
import { getGameTimeScale } from '@/lib/gameTime';

const safeNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
};

export const formatContractCountdown = (
  expiry: Date | string | null | undefined,
  leagueId?: string | null,
  language?: AppLanguage,
): string => {
  if (!expiry) {
    return translate('common.contract.empty', undefined, language);
  }

  const date = expiry instanceof Date ? expiry : new Date(expiry);
  if (Number.isNaN(date.getTime())) {
    return translate('common.contract.empty', undefined, language);
  }

  const now = new Date();
  if (date.getTime() <= now.getTime()) {
    return translate('common.contract.expired', undefined, language);
  }

  const { monthsPerSeason } = getGameTimeScale(leagueId);
  const scale = safeNumber(monthsPerSeason, 1);

  const diffMonths = differenceInCalendarMonths(date, now);
  const normalizedMonths = diffMonths / scale;

  if (normalizedMonths >= 1) {
    const monthsRemaining = Math.max(1, Math.ceil(normalizedMonths));
    return translate(
      'common.contract.monthsRemaining',
      { count: monthsRemaining },
      language,
    );
  }

  const diffDays = Math.max(0, differenceInCalendarDays(date, now));
  return translate(
    'common.contract.daysRemaining',
    { count: diffDays },
    language,
  );
};
