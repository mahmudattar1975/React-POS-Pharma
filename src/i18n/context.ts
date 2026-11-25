import { createContext } from 'react';
import type { Locale } from './localeStore';

export type Direction = 'ltr' | 'rtl';

export interface I18nContextValue {
  locale: Locale;
  direction: Direction;
  t: (source: string) => string;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

// JSX source text uses HTML entities for a few characters (&amp;, &gt;). Normalise before looking
// up the translation so the dictionary can be keyed by the text a user actually sees.
export function decodeEntities(source: string): string {
  return source
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// A no-provider fallback keeps isolated unit tests and any component rendered outside the app
// behaving exactly as before: English text, LTR layout.
const fallback: I18nContextValue = {
  locale: 'en',
  direction: 'ltr',
  t: (source) => {
    const raw = decodeEntities(source);
    const key = raw.trim();
    const leading = raw.slice(0, raw.length - raw.trimStart().length);
    const trailing = raw.slice(raw.trimEnd().length);
    return leading + key + trailing;
  },
  setLocale: () => {},
  toggleLocale: () => {},
};

export const I18nContext = createContext<I18nContextValue>(fallback);
