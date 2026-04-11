import type { TranslationDictionary } from '@/i18n/types';

export const enFixtures: TranslationDictionary = {
  fixtures: {
    page: {
      title: 'Fixtures',
      description: 'Season schedule, live statuses, and results.',
      scheduleTitle: 'Fixture Schedule',
      scheduleDescription:
        'You can join live matches directly from the Android app when available.',
      back: 'Back',
      loading: 'Loading...',
      empty: 'No fixtures have been created yet.',
    },
    labels: {
      competitionName: 'Super League',
      currentlyPlaying: 'Match in Progress',
      watch: 'Watch',
      live: 'LIVE',
      preparing: 'PREPARING',
      finished: 'FINISHED',
      error: 'ERROR',
    },
    errors: {
      loginRequired: 'You need to sign in before joining a live match.',
      matchControlUnavailable: 'Match Control API is not configured.',
      noLiveConnection: 'There is no live connection for this match.',
      noLongerJoinable: 'This match is no longer open for live connection.',
      androidOnly: 'Live league matches can only be opened in the Android app right now.',
      unauthorized: 'You are not authorized to join this live match, or it is already closed.',
      joinFailed: 'Could not connect to the live match.',
    },
    toasts: {
      joinStarted: 'Live match connection started.',
    },
  },
};
