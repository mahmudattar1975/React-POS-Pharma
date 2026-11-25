import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// The locale is the single source of truth for BOTH the words on screen and the layout direction:
// Arabic implies RTL, English implies LTR. Persisting it next to the other operator preferences
// means a cashier who switches language at the end of a shift gets the same screen next morning.
export type Locale = 'en' | 'ar';

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggle: () => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: 'en', // English stays the default so existing bookmarks and E2E selectors are stable.
      setLocale: (locale) => set({ locale }),
      toggle: () => set((s) => ({ locale: s.locale === 'en' ? 'ar' : 'en' })),
    }),
    {
      name: 'pharmacy-locale',
      // Tolerate an old/absent persisted value rather than throwing on a fresh browser profile.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as { locale?: Locale };
        return { ...current, locale: saved.locale === 'ar' ? 'ar' : 'en' };
      },
    }
  )
);
