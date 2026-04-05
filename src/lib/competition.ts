export type CompetitionType = 'domestic' | 'champions_league';
export type CompetitionFormat = 'round_robin' | 'knockout';

export function getCompetitionType(data: Record<string, unknown> | null | undefined): CompetitionType {
  return data?.competitionType === 'champions_league' ? 'champions_league' : 'domestic';
}

export function getCompetitionFormat(data: Record<string, unknown> | null | undefined): CompetitionFormat {
  return data?.competitionFormat === 'knockout' ? 'knockout' : 'round_robin';
}

export function isChampionsLeagueCompetition(data: Record<string, unknown> | null | undefined) {
  return getCompetitionType(data) === 'champions_league';
}

export function shouldHideLeagueFromList(data: Record<string, unknown> | null | undefined) {
  return data?.hiddenFromLeagueList === true || isChampionsLeagueCompetition(data);
}
