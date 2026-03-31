export type MonthlyLeagueResetSlotInput = {
  slotIndex: number;
  teamId: string | null;
  kind: 'human' | 'bot' | 'empty';
};

export type MonthlyLeagueResetLeagueInput = {
  leagueId: string;
  slots: MonthlyLeagueResetSlotInput[];
  extraHumanTeamIds?: string[];
};

export type MonthlyLeagueResetLeaguePlan = {
  leagueId: string;
  humanTeamIds: string[];
};

export type MonthlyLeagueResetNewLeaguePlan = {
  humanTeamIds: string[];
};

export type MonthlyLeagueResetPlan = {
  existingLeagues: MonthlyLeagueResetLeaguePlan[];
  newLeagues: MonthlyLeagueResetNewLeaguePlan[];
  assignedHumanTeamIds: string[];
};

function uniqueOrdered(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const teamId = String(value).trim();
    if (!teamId || seen.has(teamId)) continue;
    seen.add(teamId);
    ordered.push(teamId);
  }
  return ordered;
}

function derivePreferredHumanTeamIds(league: MonthlyLeagueResetLeagueInput) {
  const slotHumans = [...league.slots]
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .filter((slot) => slot.kind === 'human')
    .map((slot) => slot.teamId);
  return uniqueOrdered([...slotHumans, ...(league.extraHumanTeamIds || [])]);
}

export function buildMonthlyLeagueResetPlan(input: {
  capacity: number;
  leagues: MonthlyLeagueResetLeagueInput[];
  unassignedHumanTeamIds?: string[];
}): MonthlyLeagueResetPlan {
  const capacity = Math.max(1, Math.floor(input.capacity));
  const existingLeagues = input.leagues.map((league) => ({
    leagueId: league.leagueId,
    humanTeamIds: [] as string[],
  }));

  const overflow: string[] = [];

  input.leagues.forEach((league, index) => {
    const preferred = derivePreferredHumanTeamIds(league);
    existingLeagues[index]!.humanTeamIds = preferred.slice(0, capacity);
    overflow.push(...preferred.slice(capacity));
  });

  overflow.push(...uniqueOrdered(input.unassignedHumanTeamIds || []));

  for (const league of existingLeagues) {
    while (league.humanTeamIds.length < capacity && overflow.length > 0) {
      const next = overflow.shift();
      if (!next) break;
      league.humanTeamIds.push(next);
    }
  }

  const newLeagues: MonthlyLeagueResetNewLeaguePlan[] = [];
  while (overflow.length > 0) {
    newLeagues.push({
      humanTeamIds: overflow.splice(0, capacity),
    });
  }

  return {
    existingLeagues,
    newLeagues,
    assignedHumanTeamIds: [
      ...existingLeagues.flatMap((league) => league.humanTeamIds),
      ...newLeagues.flatMap((league) => league.humanTeamIds),
    ],
  };
}
