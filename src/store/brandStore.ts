// Offline copy of the shared dbo.BrandMaster. SQL is authoritative and App.tsx replaces the list
// after a successful boot sync; the 131 seeded brands keep the dropdown usable before that sync or
// while the till is offline.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Brand } from '../types/brand';
import { seedBrands } from '../utils/brandSeeds';

interface BrandState {
  brands: Brand[];
  replaceBrands: (brands: Brand[]) => void;
  upsertBrand: (brand: Brand) => void;
}

export const useBrandStore = create<BrandState>()(
  persist(
    (set) => ({
      brands: seedBrands,
      replaceBrands: (brands) => {
        // An empty SQL master must not wipe the offline fallback.
        if (brands.length === 0) return;
        set({ brands: [...brands].sort((a, b) => a.brandId - b.brandId) });
      },
      upsertBrand: (brand) => set((s) => ({
        brands: [
          ...s.brands.filter((entry) => entry.brandId !== brand.brandId),
          brand,
        ].sort((a, b) => a.brandId - b.brandId),
      })),
    }),
    {
      name: 'pharmacy-brands',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<BrandState>;
        const stored = Array.isArray(p.brands) ? p.brands : current.brands;
        const ids = new Set(stored.map((brand) => brand.brandId));
        const codes = new Set(stored.map((brand) => brand.brandCode.toLowerCase()));
        return {
          ...current,
          ...p,
          brands: [
            ...stored,
            ...current.brands.filter(
              (brand) => !ids.has(brand.brandId) && !codes.has(brand.brandCode.toLowerCase())
            ),
          ].sort((a, b) => a.brandId - b.brandId),
        };
      },
    }
  )
);
