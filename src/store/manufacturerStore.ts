// Manufacturer / company master store ("بيانات الشركات الصانعة"). It owns only the company rows
// and the running company number; the link to stock is one-way (Item.manufacturerNo stores the
// company number as text), so renaming or re-describing a company never rewrites the item master.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Manufacturer } from '../types/manufacturer';
import { seedManufacturers } from '../utils/seedData';
import { maxCompanyNumber, nextCompanyNumber } from '../utils/manufacturers';

export interface ManufacturerInput {
  // Optional: the form prefills it with nextCompanyNumber(), but the owner may type another free
  // number (the legacy company screen also allowed typing the number on add).
  companyNo?: number;
  nameAr: string;
  nameEn: string;
  details?: string;
  isActive?: boolean;
}

interface ManufacturerState {
  manufacturers: Manufacturer[];
  // Preview of the number the next company will get ("اخر رقم" + 1). addManufacturer assigns it.
  nextCompanyNo: () => number;
  addManufacturer: (input: ManufacturerInput) => Manufacturer;
  updateManufacturer: (id: string, input: Partial<Omit<ManufacturerInput, 'companyNo'>>) => void;
  removeManufacturer: (id: string) => void;
}

export const useManufacturerStore = create<ManufacturerState>()(
  persist(
    (set, get) => ({
      manufacturers: seedManufacturers,

      nextCompanyNo: () => nextCompanyNumber(get().manufacturers),

      addManufacturer: (input) => {
        const company: Manufacturer = {
          ...input,
          id: `mfr-${Date.now()}`,
          companyNo: input.companyNo ?? nextCompanyNumber(get().manufacturers),
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({ manufacturers: [...s.manufacturers, company] }));
        return company;
      },

      updateManufacturer: (id, input) => {
        set((s) => ({
          // companyNo is deliberately not patchable: it is the key item master rows store.
          manufacturers: s.manufacturers.map((m) =>
            m.id === id ? { ...m, ...input, companyNo: m.companyNo, updatedAt: new Date().toISOString() } : m
          ),
        }));
      },

      removeManufacturer: (id) => {
        set((s) => ({ manufacturers: s.manufacturers.filter((m) => m.id !== id) }));
      },
    }),
    {
      name: 'pharmacy-manufacturers',
      // Same merge philosophy as the purchasing store: keep the persisted master, append any NEW
      // seed company, and backfill a number for a row saved before numbering existed.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ManufacturerState>;
        let seq = maxCompanyNumber((p.manufacturers ?? []) as Pick<Manufacturer, 'companyNo'>[]) + 1;
        const persistedManufacturers = (p.manufacturers ?? current.manufacturers).map((m) => {
          const n = Number(m.companyNo);
          return Number.isInteger(n) && n > 0 ? m : { ...m, companyNo: seq++ };
        });
        const ids = new Set(persistedManufacturers.map((m) => m.id));
        return {
          ...current,
          ...p,
          manufacturers: [
            ...persistedManufacturers,
            ...current.manufacturers.filter((m) => !ids.has(m.id)),
          ],
        };
      },
    }
  )
);
