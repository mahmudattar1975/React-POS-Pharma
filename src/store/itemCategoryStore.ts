// Offline copy of the shared dbo.ItemCategories master. It is read-only from the till's point of
// view: the SQL table is authoritative and App.tsx replaces the list on a successful boot sync,
// while the seeded 28 rows keep the Item Master and Excel importer usable before that sync.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ItemCategory } from '../types/catalog';
import { seedItemCategories } from '../utils/seedData';

interface ItemCategoryState {
  categories: ItemCategory[];
  replaceCategories: (categories: ItemCategory[]) => void;
}

export const useItemCategoryStore = create<ItemCategoryState>()(
  persist(
    (set) => ({
      categories: seedItemCategories,
      replaceCategories: (categories) => {
        // An empty SQL master must not wipe the offline fallback.
        if (categories.length === 0) return;
        set({ categories });
      },
    }),
    {
      name: 'pharmacy-item-categories',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ItemCategoryState>;
        const stored = Array.isArray(p.categories) ? p.categories : current.categories;
        const ids = new Set(stored.map((category) => category.categoryId));
        const codes = new Set(stored.map((category) => category.categoryCode.toLowerCase()));
        return {
          ...current,
          ...p,
          categories: [
            ...stored,
            ...current.categories.filter(
              (category) => !ids.has(category.categoryId) && !codes.has(category.categoryCode.toLowerCase())
            ),
          ],
        };
      },
    }
  )
);
