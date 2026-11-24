// The global dosage-instruction (DOS/SIG) library.
//
// One row per reusable direction, shared by every item that uses it. The numbering is
// system-assigned and gap-free in the same style as the vendor/company masters (DOS-000001), so
// staff can quote a direction without depending on its wording, and editing can never collide with
// an existing code.
//
// Deleting a row is safe from the patient's point of view: issued sales carry their own frozen
// snapshot (SaleLine.dosage). The only clean-up needed is removing the now-dangling links from item
// rows, which catalogStore.unlinkDosage does.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DosageInstruction, DosageInstructionInput } from '../types/dosage';
import { seedDosages } from '../utils/seedData';
import { mergeDosageMaster, nextDosageCode } from '../utils/dosages';
import { useCatalogStore } from './catalogStore';

interface DosageState {
  dosages: DosageInstruction[];
  addDosage: (input: DosageInstructionInput, isActive?: boolean) => DosageInstruction;
  updateDosage: (id: string, input: DosageInstructionInput, isActive?: boolean) => void;
  removeDosage: (id: string) => void;
  dosageById: (id: string) => DosageInstruction | undefined;
}

export const useDosageStore = create<DosageState>()(
  persist(
    (set, get) => ({
      dosages: seedDosages,

      addDosage: (input, isActive = true) => {
        const now = new Date().toISOString();
        const dosage: DosageInstruction = {
          ...input,
          id: `dos-${crypto.randomUUID()}`,
          code: nextDosageCode(get().dosages),
          isActive,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ dosages: [...s.dosages, dosage] }));
        return dosage;
      },

      updateDosage: (id, input, isActive = true) => {
        set((s) => ({
          // The code and creation time are identities: correcting the wording must not change how
          // an existing instruction is referred to or when it entered the library.
          dosages: s.dosages.map((d) =>
            d.id === id
              ? { ...d, ...input, isActive, updatedAt: new Date().toISOString() }
              : d
          ),
        }));
      },

      removeDosage: (id) => {
        set((s) => ({ dosages: s.dosages.filter((d) => d.id !== id) }));
        useCatalogStore.getState().unlinkDosage(id);
      },

      dosageById: (id) => get().dosages.find((d) => d.id === id),
    }),
    {
      name: 'pharmacy-dosages',
      // Same "keep local edits, append missing seed rows" merge as the catalogue: a returning
      // browser session keeps its corrections while still seeing a newly added starter direction.
      // Rows saved before codes existed get one assigned on load instead of showing a blank code.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DosageState>;
        return {
          ...current,
          ...p,
          dosages: mergeDosageMaster(p.dosages, current.dosages),
        };
      },
    }
  )
);
