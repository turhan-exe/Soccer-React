export type AppLanguage = 'tr' | 'en';

export type TranslationValue = string | TranslationDictionary;

export type TranslationDictionary = {
  [key: string]: TranslationValue;
};

export type TranslationParams = Record<string, string | number | null | undefined>;

export type LanguageMeta = {
  label: string;
  nativeLabel: string;
  locale: string;
};
