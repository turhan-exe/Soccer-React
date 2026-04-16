import type { TranslationDictionary } from '@/i18n/types';

export const enSettings: TranslationDictionary = {
  settings: {
    date: {
      notClaimedYet: 'Not claimed yet',
      unknown: 'Unknown',
    },
    header: {
      title: 'Settings',
      description:
        'Customize your club, adjust notifications, and manage your data.',
      themeLabel: 'Theme: {theme}',
    },
    language: {
      label: 'Language',
      help: 'The interface language is applied instantly and saved on this device.',
    },
    teamIdentity: {
      title: 'Club Identity',
      description:
        'Upload your crest to make your club stand out. You can choose a PNG, JPG, or SVG image up to 512 KB.',
      uploadLogo: 'Upload Logo',
      removeLogo: 'Remove Logo',
      updatedHint:
        'When the {teamName} logo is updated, it is refreshed automatically in the top menu and across the app.',
      fallbackTeamName: 'Your team',
      logoAlt: 'Team logo',
    },
    club: {
      title: 'Club and Stadium Name',
      clubName: 'Club name',
      stadiumName: 'Stadium name',
      renameCost: 'Rename cost: {cost} diamonds',
      renameClub: 'Rename club',
      renameStadium: 'Rename stadium',
      currentBalance: 'Current balance: {balance} diamonds',
      fallbackStadium: 'Your stadium',
    },
    contact: {
      title: 'Contact Details',
      description:
        'Save contact channels so other managers can reach you. These details are shown only with your consent.',
      phoneLabel: 'Phone number',
      phonePlaceholder: '+90 555 000 00 00',
      phoneHelp:
        'You can enter your number in international format. Once saved, it is only shared as your club contact channel.',
      cryptoLabel: 'Crypto account',
      cryptoPlaceholder: 'USDT (TRC20) wallet address',
      cryptoHelp:
        'Add your preferred wallet address or exchange account details for crypto payments.',
      reset: 'Reset fields',
      save: 'Save details',
    },
    appearance: {
      title: 'Appearance',
      description:
        'Dark theme is now the default for a more consistent game experience and is enabled for all users.',
      note:
        'The interface opens in dark mode regardless of your system theme. More theme options can be added in future updates.',
    },
    vip: {
      title: 'Daily Rewards and VIP',
      dailyTitle: 'Daily login reward',
      dailyDescription:
        'Once per day, one of the energy, morale, or health kits is added automatically.',
      lastRewardDate: 'Last reward date:',
      claimedToday: 'Claimed today',
      checkReward: 'Check reward',
      statusLabel: 'VIP status:',
      active: 'Active',
      inactive: 'Inactive',
      perkDaily: '- Daily +1 energy, morale, and health kit',
      perkDuration: '- Durations are reduced by %{percent}',
      perkStarCard: '- 1 star player card per month',
      selectedPlan: 'Selected plan:',
      expiry: 'VIP expires:',
      lastStarCard: 'Last star card:',
      starCardCredits: 'Star card credits:',
      claimMonthly: 'Claim monthly card',
      alreadyClaimedMonthly: 'Monthly card claimed',
      planNotSelected: 'Not selected',
      viewPlans: 'View VIP plans',
      disable: 'Disable VIP',
    },
    notifications: {
      title: 'Notifications',
      phoneTitle: 'Phone Notifications',
      phoneDescription:
        'Receive academy, training, and official league match reminders as phone notifications.',
      platformNote:
        'Android is fully supported. The iOS code path is ready, but live push requires `GoogleService-Info.plist` plus APNs/Firebase setup.',
      webNote:
        'Native device registration is not available in the web browser. This setting is for the mobile app.',
    },
    performance: {
      title: 'Audio and Performance',
      soundEffects: 'Sound Effects',
      soundEffectsDescription: 'Play sound effects during matches',
      animations: 'Animations',
      animationsDescription: 'Reduce transition animations',
      graphicsQuality: 'Graphics Quality',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
    },
    locale: {
      title: 'Language and Region',
      currency: 'Currency',
    },
    data: {
      title: 'Data Management',
      export: 'Export Data',
      clearCache: 'Clear Cache',
      adPrivacy: 'Ad privacy preferences',
      debugTitle: 'Rewarded Ads Debug',
      refreshDebug: 'Refresh ad debug info',
      openInspector: 'Open Ad Inspector',
      lastError: 'Last Error',
      ready: 'Ready',
      empty: 'Empty',
      secondsShort: 'sec',
      adminActions: 'Admin Actions',
      liveLeagueOps: 'Live League Operations Panel',
      gameData: 'Game Data:',
      cache: 'Cache:',
      total: 'Total:',
    },
    about: {
      title: 'About',
      version: 'Version:',
      versionLoading: 'Loading...',
      versionUnavailable: 'Unknown',
      androidBuild: 'Android build: {value}',
      lastUpdate: 'Last Update:',
      developer: 'Developer:',
      privacyPolicy: 'Privacy Policy',
      terms: 'Terms of Use',
      whatsappSupport: 'WhatsApp Support Line',
      whatsappHelp:
        'Players who run into in-game issues can message this line directly:',
    },
    dialogs: {
      clubRenameTitle: 'Update club name',
      clubRenameDescription:
        'Enter the new club name and confirm with {cost} diamonds.',
      clubNameLabel: 'Club name',
      stadiumRenameTitle: 'Update stadium name',
      stadiumRenameDescription:
        'Enter the new stadium name and confirm with {cost} diamonds.',
      stadiumNameLabel: 'Stadium name',
    },
    toasts: {
      sessionMissing: 'No active session was found.',
      clubTooShort: 'Club name must be at least {min} characters.',
      clubTooLong: 'Club name can be at most {max} characters.',
      clubSame: 'The new name matches the current one.',
      stadiumTooShort: 'Stadium name must be at least {min} characters.',
      stadiumTooLong: 'Stadium name can be at most {max} characters.',
      stadiumSame: 'The new stadium name matches the current one.',
      insufficientDiamonds: 'Not enough diamonds.',
      clubUpdated: 'Club name updated.',
      clubUpdateFailed: 'Club name could not be updated.',
      stadiumUpdated: 'Stadium name updated.',
      stadiumUpdateFailed: 'Stadium name could not be updated.',
      logoConvertFailed: 'The logo could not be converted.',
      logoReadFailed: 'An error occurred while reading the logo.',
      logoLoginRequired: 'You need to sign in to upload a logo.',
      logoUnsupportedTitle: 'Unsupported file format.',
      logoUnsupportedDescription:
        'Please upload a PNG, JPG, or SVG image.',
      logoTooLargeTitle: 'The logo file is too large.',
      logoTooLargeDescription: 'Choose an image smaller than 512 KB.',
      logoUpdated: 'Your team logo was updated successfully.',
      logoSaveFailed: 'The logo could not be saved.',
      logoRemoved: 'Your team logo was removed.',
      logoRemoveFailed: 'An error occurred while removing the logo.',
      contactLoginRequired: 'Sign in to save contact information.',
      contactUpdated: 'Contact information updated.',
      contactSaveFailed: 'Contact information could not be saved.',
      pushLoginRequired: 'Sign in to update notification settings.',
      pushEnabled: 'Phone notifications were enabled.',
      pushDisabled: 'Phone notifications were disabled.',
      pushSaveFailed: 'Notification preference could not be updated.',
      cacheCleared: 'Cache cleared',
      dataExported: 'Data exported',
      whatsappUnavailable:
        'The WhatsApp link could not be opened right now.',
      adPrivacyUnsupported:
        'Ad privacy preferences can only be opened in the Android app.',
      adPrivacyOpened: 'The ad privacy form was opened.',
      adPrivacyNone:
        'There is no ad privacy preference to update right now.',
      adPrivacyFailed: 'The ad privacy preference could not be opened.',
      debugUnsupported:
        'Ad debug information can only be read in the Android app.',
      debugRefreshed: 'Ad debug information refreshed.',
      inspectorUnsupported:
        'Ad Inspector can only be opened in the Android app.',
      inspectorClosed: 'Ad Inspector closed. Refresh debug info if needed.',
    },
  },
};
