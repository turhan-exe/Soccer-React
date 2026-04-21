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
      preparingCta: 'Preparing',
      live: 'LIVE',
      preparing: 'PREPARING',
      queued: 'QUEUED',
      preparingDelayed: 'PREPARING (DELAYED)',
      resultPending: 'RESULT PENDING',
      resultPendingShort: 'Result pending',
      finished: 'FINISHED',
      error: 'ERROR',
      queueHint: 'The match is waiting for free capacity. Watch will open when it is ready.',
      preparingDelayedHint: 'The match server is preparing. Watch will open shortly.',
      resultPendingHint: 'The match has ended and the score is still being processed.',
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
