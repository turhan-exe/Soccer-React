import type { TranslationDictionary } from '@/i18n/types';
import { enAcademy } from './academy';
import { enChampionsLeague } from './championsLeague';
import { enFinance } from './finance';
import { enFixtures } from './fixtures';
import { enFriends } from './friends';
import { enLegends } from './legends';
import { enLeagues } from './leagues';
import { enMainMenu } from './mainMenu';
import { enMatchPreview } from './matchPreview';
import { enSettings } from './settings';
import { enShared } from './shared';
import { enTeamPlanning } from './teamPlanning';
import { enTraining } from './training';
import { enTransfer } from './transfer';
import { enYouth } from './youth';

export const enTranslations: TranslationDictionary = {
  ...enAcademy,
  ...enChampionsLeague,
  ...enFinance,
  ...enFixtures,
  ...enFriends,
  ...enLegends,
  ...enLeagues,
  ...enShared,
  ...enMainMenu,
  ...enMatchPreview,
  ...enSettings,
  ...enTeamPlanning,
  ...enTraining,
  ...enTransfer,
  ...enYouth,
};
