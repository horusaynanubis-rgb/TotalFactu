import { Locale, Translations } from './types';
import { en } from './en';
import { es } from './es';

export type { Locale, Translations };

export const locales: Locale[] = ['en', 'es'];

export const localeNames: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
};

export const localeFlags: Record<Locale, string> = {
  en: '🇬🇧',
  es: '🇪🇸',
};

const translations: Record<Locale, Translations> = {
  en,
  es,
};

export function getTranslations(locale: Locale): Translations {
  return translations[locale] || translations.en;
}

export const defaultLocale: Locale = 'es';
