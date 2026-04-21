import type { TranslationDictionary } from '@/i18n/types';

export const enTeamDetail: TranslationDictionary = {
  teamDetail: {
    title: 'Team Detail',
    subtitle: 'Review the squad and social actions.',
    unknownTeam: 'Unknown Team',
    unknownManager: 'Manager',
    manager: 'Manager: {name}',
    notFoundTitle: 'Team not found',
    notFoundDescription: 'This team may no longer exist or access failed temporarily.',
    metrics: {
      formation: 'Formation',
      value: 'Team Value',
      strength: 'Squad Power',
      players: 'Players',
    },
    sections: {
      topPlayers: 'Best Players',
      squad: 'Squad Summary',
      vitals: 'Average Status',
    },
    squad: {
      starters: 'First 11',
      bench: 'Bench',
      reserve: 'Reserve',
    },
    vitals: {
      condition: 'Condition',
      motivation: 'Morale',
      health: 'Health',
    },
    actions: {
      yourTeam: 'Your Team',
      openRequest: 'Open Requests',
    },
    empty: {
      players: 'No active players to show.',
    },
    toasts: {
      loadFailed: 'Team detail could not be loaded.',
    },
  },
};
