import type { TranslationDictionary } from '@/i18n/types';

export const enFriends: TranslationDictionary = {
  friends: {
    title: 'Social Hub',
    tabs: {
      friends: 'Friends',
      requests: 'Requests',
      add: 'Add',
      searchMobile: 'Search',
    },
    empty: {
      friendsTitle: 'You have no friends yet',
      friendsDescription: 'Start the rivalry by adding other managers!',
      requestsTitle: 'No incoming requests',
      requestsDescription: 'New friend requests will appear here.',
      searchDescription: 'Search for a manager or team name.',
    },
    placeholders: {
      search: 'Team Name or Manager Name...',
    },
    actions: {
      chat: 'Open Chat',
      friendly: 'Friendly Match',
      remove: 'Remove Friend',
      you: 'You',
      accept: 'Accept',
      reject: 'Reject',
      sendRequest: 'Send Request',
      alreadyFriends: 'Already Friends',
      requestSent: 'Request Sent',
      requestReceived: 'Request Received',
    },
    confirmations: {
      rejectRequest: 'Are you sure you want to reject this request?',
      removeFriend: 'Are you sure you want to remove {name}?',
    },
    toasts: {
      loadFailed: 'An error occurred while loading data.',
      userNotFound: 'User not found.',
      searchFailed: 'Search failed: {message}',
      requestSent: 'Friend request sent!',
      requestAccepted: 'Friend request accepted!',
      requestRejected: 'Request rejected.',
      requestRejectFailed: 'Request could not be rejected.',
      removeSuccess: 'Friend removed.',
      removeFailed: 'Remove action failed.',
      requestFailed: 'An error occurred while sending the request.',
      acceptFailed: 'An error occurred while accepting the request.',
    },
  },
};
