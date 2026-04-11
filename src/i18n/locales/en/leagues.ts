import type { TranslationDictionary } from '@/i18n/types';

export const enLeagues: TranslationDictionary = {
  leagues: {
    listPage: {
      title: 'Leagues',
      description: 'League overview.',
      listTitle: 'League List',
      columns: {
        detail: 'League Details',
        season: 'Season',
        occupancy: 'Occupancy',
        status: 'Status',
      },
      loading: 'Loading leagues...',
      empty: 'No leagues found yet.',
      currentLeague: 'Your Current League',
    },
    detailPage: {
      title: 'League Details',
      description: 'Standings and statistics.',
      standingsTitle: 'Standings',
      columns: {
        rank: 'R',
        team: 'Team',
        played: 'P',
        won: 'W',
        draw: 'D',
        lost: 'L',
        goalsFor: 'GF',
        goalsAgainst: 'GA',
        goalDiff: 'GD',
        points: 'Pts',
      },
      botPrefix: 'Bot',
    },
    states: {
      active: 'Active',
      forming: 'Forming',
      scheduled: 'Scheduled',
      completed: 'Completed',
    },
  },
};
