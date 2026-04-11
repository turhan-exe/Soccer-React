import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  type AppLanguage,
  LANGUAGE_META,
  type TranslationParams,
} from '@/i18n/translations';
import {
  getInitialLanguage,
  getCurrentLocale,
  LANGUAGE_STORAGE_KEY,
  normalizeLanguage,
  setCurrentLanguage,
  translate,
  formatNumberValue,
  formatDateValue,
  formatCurrencyValue,
} from '@/i18n/runtime';

type LanguageOption = {
  code: AppLanguage;
  label: string;
  nativeLabel: string;
  locale: string;
};

type LanguageContextValue = {
  language: AppLanguage;
  locale: string;
  availableLanguages: LanguageOption[];
  setLanguage: (language: AppLanguage) => void;
  t: (key: string, params?: TranslationParams) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  formatCurrency: (value: number, options?: Intl.NumberFormatOptions) => string;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

const createLanguageOptions = (): LanguageOption[] =>
  (Object.keys(LANGUAGE_META) as AppLanguage[]).map((code) => ({
    code,
    label: LANGUAGE_META[code].label,
    nativeLabel: LANGUAGE_META[code].nativeLabel,
    locale: LANGUAGE_META[code].locale,
  }));

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<AppLanguage>(getInitialLanguage);
  const locale = getCurrentLocale(language);
  const availableLanguages = useMemo(() => createLanguageOptions(), []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = locale;
    document.documentElement.setAttribute('data-language', language);
    setCurrentLanguage(language);
  }, [language, locale]);

  const setLanguage = useCallback((nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage);
  }, []);

  const t = useCallback(
    (key: string, params?: TranslationParams): string => translate(key, params, language),
    [language],
  );

  const formatNumber = useCallback(
    (value: number, options?: Intl.NumberFormatOptions): string =>
      formatNumberValue(value, options, language),
    [language],
  );

  const formatDate = useCallback(
    (value: Date | string | number, options?: Intl.DateTimeFormatOptions): string => {
      return formatDateValue(value, options, language);
    },
    [language],
  );

  const formatCurrency = useCallback(
    (value: number, options?: Intl.NumberFormatOptions): string =>
      formatCurrencyValue(value, options, language),
    [language],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      locale,
      availableLanguages,
      setLanguage,
      t,
      formatNumber,
      formatDate,
      formatCurrency,
    }),
    [
      availableLanguages,
      formatCurrency,
      formatDate,
      formatNumber,
      language,
      locale,
      setLanguage,
      t,
    ],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useTranslation = (): LanguageContextValue => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }

  return context;
};
