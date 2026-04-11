import { formatCurrencyValue } from '@/i18n/runtime';

export const INITIAL_CLUB_BALANCE = 50_000;

export const normalizeClubBalance = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.round(fallback));
  }
  return Math.max(0, Math.round(numeric));
};

export const formatClubCurrency = (value: number): string =>
  formatCurrencyValue(normalizeClubBalance(value));
