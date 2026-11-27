// Offline copy of the shared dbo.Units master. SQL is authoritative and App.tsx replaces the list
// on a successful boot sync; the seeded 14 rows keep the Item Master dropdown usable before that
// sync completes or while the till is offline.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Unit } from '../types/unit';
import { seedUnits } from '../utils/seedData';

interface UnitState {
  units: Unit[];
  replaceUnits: (units: Unit[]) => void;
  upsertUnit: (unit: Unit) => void;
}

export const useUnitStore = create<UnitState>()(
  persist(
    (set) => ({
      units: seedUnits,
      replaceUnits: (units) => {
        // An empty SQL master must not wipe the offline fallback.
        if (units.length === 0) return;
        set({ units });
      },
      upsertUnit: (unit) => set((s) => ({
        units: [
          ...s.units.filter((entry) => entry.unitId !== unit.unitId),
          unit,
        ].sort((a, b) => a.unitId - b.unitId),
      })),
    }),
    {
      name: 'pharmacy-units',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UnitState>;
        const stored = Array.isArray(p.units) ? p.units : current.units;
        const ids = new Set(stored.map((unit) => unit.unitId));
        const codes = new Set(stored.map((unit) => unit.unitCode.toLowerCase()));
        return {
          ...current,
          ...p,
          units: [
            ...stored,
            ...current.units.filter(
              (unit) => !ids.has(unit.unitId) && !codes.has(unit.unitCode.toLowerCase())
            ),
          ],
        };
      },
    }
  )
);
