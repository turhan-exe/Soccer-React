import { enTranslations } from '@/i18n/locales/en';
import { trTranslations } from '@/i18n/locales/tr';
import type { AppLanguage, LanguageMeta, TranslationDictionary } from '@/i18n/types';

export type {
  AppLanguage,
  LanguageMeta,
  TranslationDictionary,
  TranslationParams,
  TranslationValue,
} from '@/i18n/types';

export const LANGUAGE_META: Record<AppLanguage, LanguageMeta> = {
  tr: {
    label: 'Turkish',
    nativeLabel: 'Turkce',
    locale: 'tr-TR',
  },
  en: {
    label: 'English',
    nativeLabel: 'English',
    locale: 'en-US',
  },
};

export const TRANSLATIONS: Record<AppLanguage, TranslationDictionary> = {
  tr: trTranslations,
  en: enTranslations,
};
