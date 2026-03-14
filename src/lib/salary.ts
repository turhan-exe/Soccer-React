import type { Player } from '@/types';
import { normalizeRatingTo100 } from '@/lib/player';

const SALARY_ROUNDING_UNIT = 250;
const LEGACY_SALARY_MAX = 5000;
const LEGACY_REFRESH_RATIO = 1.35;

const clampSalary = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
};

const roundSalary = (value: number): number => {
  const normalized = clampSalary(value);
  return Math.max(
    SALARY_ROUNDING_UNIT,
    Math.round(normalized / SALARY_ROUNDING_UNIT) * SALARY_ROUNDING_UNIT,
  );
};

const interpolate = (
  rating: number,
  minRating: number,
  maxRating: number,
  minSalary: number,
  maxSalary: number,
): number => {
  if (maxRating <= minRating) {
    return minSalary;
  }
  const progress = Math.max(0, Math.min(1, (rating - minRating) / (maxRating - minRating)));
  return minSalary + (maxSalary - minSalary) * progress;
};

const normalizeCurrentSalary = (salary: number | null | undefined): number => {
  if (typeof salary !== 'number' || !Number.isFinite(salary) || salary <= 0) {
    return 0;
  }
  return roundSalary(salary);
};

export const getSalaryForOverall = (overall: number): number => {
  const rating = normalizeRatingTo100(overall);

  if (rating <= 45) {
    return roundSalary(interpolate(rating, 0, 45, 1800, 4000));
  }
  if (rating <= 55) {
    return roundSalary(interpolate(rating, 45, 55, 4000, 6500));
  }
  if (rating <= 65) {
    return roundSalary(interpolate(rating, 55, 65, 6500, 9500));
  }
  if (rating <= 75) {
    return roundSalary(interpolate(rating, 65, 75, 9500, 14500));
  }
  if (rating <= 85) {
    return roundSalary(interpolate(rating, 75, 85, 14500, 22000));
  }
  if (rating <= 95) {
    return roundSalary(interpolate(rating, 85, 95, 22000, 34000));
  }

  return roundSalary(interpolate(rating, 95, 99, 34000, 42000));
};

export const shouldRefreshLegacySalary = (
  currentSalary: number | null | undefined,
  overall: number,
): boolean => {
  const normalizedCurrent = normalizeCurrentSalary(currentSalary);
  if (normalizedCurrent <= 0 || normalizedCurrent > LEGACY_SALARY_MAX) {
    return false;
  }
  const recommended = getSalaryForOverall(overall);
  return recommended >= normalizedCurrent * LEGACY_REFRESH_RATIO;
};

export const resolvePlayerSalary = (player: Player): number => {
  const recommended = getSalaryForOverall(player.overall);
  const currentSalary = normalizeCurrentSalary(player.contract?.salary);

  if (currentSalary <= 0) {
    return recommended;
  }

  if (shouldRefreshLegacySalary(currentSalary, player.overall)) {
    return recommended;
  }

  return currentSalary;
};

