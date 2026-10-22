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
      },
      update: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
    }),
    { name: 'pharmacy-settings' }
  )
);
