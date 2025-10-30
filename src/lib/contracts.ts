import { differenceInCalendarDays, differenceInCalendarMonths } from 'date-fns';
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
): string => {
  if (!expiry) {
    return 'Söz.: -';
  }

  const date = expiry instanceof Date ? expiry : new Date(expiry);
  if (Number.isNaN(date.getTime())) {
    return 'Söz.: -';
  }

  const now = new Date();
  if (date.getTime() <= now.getTime()) {
    return 'Söz.: 0 gün';
  }

  const { monthsPerSeason } = getGameTimeScale(leagueId);
  const scale = safeNumber(monthsPerSeason, 1);

  const diffMonths = differenceInCalendarMonths(date, now);
  const normalizedMonths = diffMonths / scale;

  if (normalizedMonths >= 1) {
    const monthsRemaining = Math.max(1, Math.ceil(normalizedMonths));
    return `Söz.: ${monthsRemaining} ay`;
  }

  const diffDays = Math.max(0, differenceInCalendarDays(date, now));
  return `Söz.: ${diffDays} gün`;
};

