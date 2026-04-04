import { useState, useEffect, useCallback } from 'react';
import { t, getLocale, setLocale, onLocaleChange, type Locale } from '../i18n.js';

export function useI18n() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    return onLocaleChange(() => forceUpdate((n) => n + 1));
  }, []);

  const changeLocale = useCallback((locale: Locale) => {
    setLocale(locale);
  }, []);

  return { t, locale: getLocale(), setLocale: changeLocale };
}
