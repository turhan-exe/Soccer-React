import {
  LANGUAGE_META,
  TRANSLATIONS,
  type AppLanguage,
  type TranslationDictionary,
  type TranslationParams,
} from '@/i18n/translations';

export const LANGUAGE_STORAGE_KEY = 'fm_language_v1';
export const DEFAULT_LANGUAGE: AppLanguage = 'tr';

let activeLanguage: AppLanguage = DEFAULT_LANGUAGE;
const missingTranslationWarnings = new Set<string>();

export const normalizeLanguage = (value?: string | null): AppLanguage | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('tr')) {
    return 'tr';
  }

  if (normalized.startsWith('en')) {
    return 'en';
  }

  return null;
};

export const getInitialLanguage = (): AppLanguage => {
  if (typeof window === 'undefined') {
    return DEFAULT_LANGUAGE;
  }

  const stored = normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  if (stored) {
    return stored;
  }

  return normalizeLanguage(window.navigator.language) ?? DEFAULT_LANGUAGE;
};

const getTranslationValue = (
  dictionary: TranslationDictionary,
  key: string,
): string | null => {
  const segments = key.split('.');
  let current: string | TranslationDictionary | undefined = dictionary;

  for (const segment of segments) {
    if (!current || typeof current === 'string') {
      return null;
    }
    current = current[segment];
  }

  return typeof current === 'string' ? current : null;
};

const interpolate = (template: string, params?: TranslationParams): string => {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, token: string) => {
    const value = params[token];
    return value == null ? '' : String(value);
  });
};

const warnMissingTranslation = (language: AppLanguage, key: string): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const warningId = `${language}:${key}`;
  if (missingTranslationWarnings.has(warningId)) {
    return;
  }

  missingTranslationWarnings.add(warningId);
  console.warn(`[i18n] missing translation: ${warningId}`);
};

export const setCurrentLanguage = (language: AppLanguage): void => {
  activeLanguage = language;
};

export const getCurrentLanguage = (): AppLanguage => activeLanguage;

export const getCurrentLocale = (language: AppLanguage = activeLanguage): string =>
  LANGUAGE_META[language].locale;

export const translate = (
  key: string,
  params?: TranslationParams,
  language: AppLanguage = activeLanguage,
): string => {
  const activeValue = getTranslationValue(TRANSLATIONS[language], key);
  const fallbackValue = getTranslationValue(TRANSLATIONS[DEFAULT_LANGUAGE], key);

  if (!activeValue) {
    warnMissingTranslation(language, key);
  }

  const resolved = activeValue ?? fallbackValue ?? key;
  return interpolate(resolved, params);
};

export const formatNumberValue = (
  value: number,
  options?: Intl.NumberFormatOptions,
  language: AppLanguage = activeLanguage,
): string => new Intl.NumberFormat(getCurrentLocale(language), options).format(value);

export const formatDateValue = (
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  language: AppLanguage = activeLanguage,
): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(getCurrentLocale(language), options).format(date);
};

export const formatCurrencyValue = (
  value: number,
  options?: Intl.NumberFormatOptions,
  language: AppLanguage = activeLanguage,
): string =>
  formatNumberValue(
    value,
    {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
      ...options,
    },
    language,
  );
