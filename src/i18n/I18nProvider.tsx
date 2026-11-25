import { useContext, useEffect, useMemo, type ReactNode } from 'react';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { createAppTheme } from '../theme';
import { useLocaleStore } from './localeStore';
import { arTranslations } from './translations';
import { decodeEntities, I18nContext, type Direction, type I18nContextValue } from './context';

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const toggle = useLocaleStore((s) => s.toggle);
  const direction: Direction = locale === 'ar' ? 'rtl' : 'ltr';

  // The document element (not just the React tree) must carry dir/lang: tooltips, portals,
  // print styles and the browser's own text direction all read it from <html>.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [locale, direction]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      direction,
      setLocale,
      toggleLocale: toggle,
      t: (source) => {
        const raw = decodeEntities(source);
        const key = raw.trim();
        // Keep the source's edge spacing: codemod-generated translations split English sentences into
        // `${tr('part')}${value}` fragments, and the spaces around those fragments are meaningful.
        const leading = raw.slice(0, raw.length - raw.trimStart().length);
        const trailing = raw.slice(raw.trimEnd().length);
        const translated = locale === 'ar' ? (arTranslations[key] ?? key) : key;
        return leading + translated + trailing;
      },
    }),
    [locale, direction, setLocale, toggle]
  );

  // One theme instance per direction: MUI flips spacing, alignment and directional icons from the
  // theme's `direction`, so component code never has to branch on the language itself.
  const theme = useMemo(() => createAppTheme(direction), [direction]);

  return (
    <I18nContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </I18nContext.Provider>
  );
}

/** Translation component for static JSX text children. */
export function T({ children }: { children: string }) {
  const t = useContext(I18nContext).t;
  return <>{t(String(children))}</>;
}
