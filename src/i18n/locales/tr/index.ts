import type { TranslationDictionary } from '@/i18n/types';
import { trAcademy } from './academy';
import { trChampionsLeague } from './championsLeague';
import { trFinance } from './finance';
import { trFixtures } from './fixtures';
import { trFriends } from './friends';
import { trLegends } from './legends';
import { trLeagues } from './leagues';
import { trMainMenu } from './mainMenu';
import { trMatchPreview } from './matchPreview';
import { trSettings } from './settings';
import { trShared } from './shared';
import { trTeamPlanning } from './teamPlanning';
import { trTraining } from './training';
import { trTransfer } from './transfer';
import { trYouth } from './youth';

export const trTranslations: TranslationDictionary = {
  ...trAcademy,
  ...trChampionsLeague,
  ...trFinance,
  ...trFixtures,
  ...trFriends,
  ...trLegends,
  ...trLeagues,
  ...trShared,
  ...trMainMenu,
  ...trMatchPreview,
  ...trSettings,
  ...trTeamPlanning,
  ...trTraining,
  ...trTransfer,
  ...trYouth,
};
