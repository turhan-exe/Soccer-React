import { differenceInCalendarMonths } from 'date-fns';
import type { Player } from '@/types';

export type GameTimeScale = {
  /**
   * How many real-world calendar months correspond to a single in-game year.
   * Example: 1 => every month counts as a full year.
   */
  monthsPerYear: number;
  /**
   * How many real-world calendar months correspond to a single in-game season.
   * Defaults to the same value as monthsPerYear for monthly leagues.
   */
  monthsPerSeason: number;
};

const DEFAULT_GAME_TIME_SCALE: GameTimeScale = {
  monthsPerYear: 1,
  monthsPerSeason: 1,
};

/**
 * Per-league overrides for calendar speed.
 * Extend this map when a league should progress faster/slower than the default.
 */
const LEAGUE_TIME_SCALE: Record<string, GameTimeScale> = Object.create(null);

const clampPositive = (value: number, fallback: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
};

export const getGameTimeScale = (leagueId?: string | null): GameTimeScale => {
  if (leagueId && LEAGUE_TIME_SCALE[leagueId]) {
    const scale = LEAGUE_TIME_SCALE[leagueId];
    return {
      monthsPerYear: clampPositive(scale.monthsPerYear, DEFAULT_GAME_TIME_SCALE.monthsPerYear),
      monthsPerSeason: clampPositive(scale.monthsPerSeason, scale.monthsPerYear),
    };
  }
  return DEFAULT_GAME_TIME_SCALE;
};

const addCalendarMonths = (date: Date, months: number): Date => {
  if (!Number.isFinite(months) || months === 0) {
    return new Date(date);
  }
  const wholeMonths = Math.trunc(months);
  const result = new Date(date);
  result.setMonth(result.getMonth() + wholeMonths);
  return result;
};

export const addGameYears = (date: Date, years: number, leagueId?: string | null): Date => {
  if (!Number.isFinite(years) || years === 0) {
    return new Date(date);
  }
  const { monthsPerYear } = getGameTimeScale(leagueId);
  const monthsToAdd = years * monthsPerYear;
  return addCalendarMonths(date, monthsToAdd);
};

export const addGameSeasons = (date: Date, seasons: number, leagueId?: string | null): Date => {
  if (!Number.isFinite(seasons) || seasons === 0) {
    return new Date(date);
  }
  const { monthsPerSeason } = getGameTimeScale(leagueId);
  const monthsToAdd = seasons * monthsPerSeason;
  return addCalendarMonths(date, monthsToAdd);
};

type AgingOptions = {
  leagueId?: string | null;
};

type AgingResult = {
  player: Player;
  changed: boolean;
};

export const applyGameAgingToPlayer = (
  player: Player,
  now: Date,
  options?: AgingOptions,
): AgingResult => {
  const { leagueId } = options ?? {};
  const { monthsPerYear } = getGameTimeScale(leagueId);
  const safeMonthsPerYear = clampPositive(monthsPerYear, DEFAULT_GAME_TIME_SCALE.monthsPerYear);

  const lastUpdate = (() => {
    if (player.ageUpdatedAt) {
      const parsed = new Date(player.ageUpdatedAt);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return null;
  })();

  if (!lastUpdate) {
    return {
      player: {
        ...player,
        ageUpdatedAt: now.toISOString(),
      },
      changed: true,
    };
  }

  const elapsedMonths = differenceInCalendarMonths(now, lastUpdate);
  if (elapsedMonths <= 0) {
    return { player, changed: false };
  }

  const elapsedYears = Math.floor(elapsedMonths / safeMonthsPerYear);
  if (elapsedYears <= 0) {
    return {
      player: {
        ...player,
        ageUpdatedAt: now.toISOString(),
      },
      changed: true,
    };
  }

  const updatedAge = (player.age ?? 0) + elapsedYears;
  const newStamp = addCalendarMonths(lastUpdate, elapsedYears * safeMonthsPerYear);

  return {
    player: {
      ...player,
      age: updatedAge,
      ageUpdatedAt: newStamp.toISOString(),
    },
    changed: true,
  };
};

export const applyGameAgingToPlayers = (
  players: Player[] | undefined,
  now: Date,
  options?: AgingOptions,
): { players: Player[]; changed: boolean } => {
  if (!Array.isArray(players) || players.length === 0) {
    return { players: players ?? [], changed: false };
  }

  let changed = false;
  const aged = players.map((player) => {
    const { player: nextPlayer, changed: playerChanged } = applyGameAgingToPlayer(
      player,
      now,
      options,
    );
    if (playerChanged) {
      changed = true;
    }
    return nextPlayer;
  });

  return { players: aged, changed };
};

