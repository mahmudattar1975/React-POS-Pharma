import { useContext } from 'react';
import { I18nContext, type I18nContextValue } from './context';

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/** Translation function for strings used in props (label, helperText, aria-label, ...). */
export function useT(): (source: string) => string {
  return useI18n().t;
}
