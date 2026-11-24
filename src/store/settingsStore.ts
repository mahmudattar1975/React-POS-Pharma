import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StoreSettings } from '../types/settings';

interface SettingsState {
  settings: StoreSettings;
  update: (patch: Partial<StoreSettings>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: {
        storeNameAr: 'صيدلية الشفاء',
        storeNameEn: 'Al-Shifa Pharmacy',
        vatRegistrationNo: '300012345600003',
        crNumber: '1010123456',
        address: 'Riyadh, Saudi Arabia',
        defaultVatRate: 0.15,
        currency: 'SAR',
        cashierName: 'Cashier 1',
        alertSoundsEnabled: true,
        // This demo register belongs to the Riyadh branch (see seedCostCenters in
        // utils/seedData.ts) - sales/purchases post under its cost center by default.
        costCenterId: 'cc-br-001',
        // RSD reporting is opt-in; Settings > RSD flips it on after credentials/GLN are confirmed.
        rsdEnabled: false,
      },
      update: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
    }),
    {
      name: 'pharmacy-settings',
      // Sessions persisted before the cost-center field existed keep their whole old settings
      // object on read - stale-persisted state wins over the default - so backfill the field
      // here explicitly (same pattern as purchasingStore's merge backfills pre-Phase-1 invoice
      // lines), otherwise tagged documents would silently carry costCenterId: undefined forever.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { settings?: Partial<StoreSettings> };
        // Spread persisted fields OVER the current defaults, so a session persisted before the
        // cost-center field existed backfills it (and any future field) from the default without
        // clobbering what the user actually saved.
        return {
          ...current,
          ...p,
          settings: { ...current.settings, ...(p.settings ?? {}) },
        };
      },
    }
  )
);
