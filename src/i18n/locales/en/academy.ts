import type { TranslationDictionary } from '@/i18n/types';

export const enAcademy: TranslationDictionary = {
  academy: {
    title: 'Academy',
    loginRequired: 'You need to sign in.',
    generatePlayer: 'Generate Player',
    youngPlayer: 'Young Player',
    talented: 'Talented',
    averageAge: 'Avg. Age',
    youngPlayers: 'Young Players',
    candidateMissing: 'Candidate not found.',
    joinedTeam: '{name} joined the first team!',
    negotiationFailed: 'Negotiation could not be completed',
    errors: {
      permissionDenied: 'You do not have permission to access academy candidates.',
      indexRequired: 'The academy candidate query requires a Firestore index.',
      candidatesLoadFailed: 'Academy candidates could not be loaded.',
      cooldownLoadFailed: 'The academy cooldown could not be synchronized.',
    },
    generation: {
      title: 'Player Generation',
      next: 'Next generation: {time}',
      speedUp: 'Speed Up ({cost} Diamonds)',
    },
    candidate: {
      promote: 'Promote to Team',
      release: 'Release Player',
      potential: 'Max Potential: {value}',
      poolTitle: 'Player Pool',
      poolTrigger: 'Open the message shown when no youth player is available',
      poolEmpty: 'There are no youth players yet. Generate a new candidate.',
      listTitle: 'Academy Candidates',
      listTrigger: 'Open the message shown when there are no academy candidates',
      listEmpty: 'There are no candidates yet.',
      height: 'Height: {value} cm',
      weight: 'Weight: {value} kg',
    },
  },
};
