'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Locale, Translations } from './types';
import { getTranslations, defaultLocale } from './index';

interface LanguageContextType {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
}

const LanguageContext = createContext<LanguageContextType>({
  locale: defaultLocale,
  t: getTranslations(defaultLocale),
  setLocale: () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('totalfactu-locale') as Locale | null;
      if (saved && (saved === 'en' || saved === 'es')) {
        setLocaleState(saved);
      }
    } catch {
      // ignore
    }
    setMounted(true);
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem('totalfactu-locale', newLocale);
    } catch {
      // ignore
    }
    // Update html lang attribute
    if (typeof document !== 'undefined') {
      document.documentElement.lang = newLocale;
    }
  }, []);

  const t = getTranslations(locale);

  // Update html lang on mount
  useEffect(() => {
    if (mounted && typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale, mounted]);

  return (
    <LanguageContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return context;
}
