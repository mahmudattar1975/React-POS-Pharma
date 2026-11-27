// Offline copy of the shared dbo.Locations master. SQL is authoritative and App.tsx replaces the
// list on a successful boot sync; the seeded shelf labels keep the Item Master dropdown usable
// before that sync completes or while the till is offline.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Location } from '../types/location';
import { seedLocations } from '../utils/seedData';

interface LocationState {
  locations: Location[];
  replaceLocations: (locations: Location[]) => void;
  upsertLocation: (location: Location) => void;
}

export const useLocationStore = create<LocationState>()(
  persist(
    (set) => ({
      locations: seedLocations,
      replaceLocations: (locations) => {
        // An empty SQL master must not wipe the offline fallback.
        if (locations.length === 0) return;
        set({ locations });
      },
      upsertLocation: (location) => set((s) => ({
        locations: [
          ...s.locations.filter((entry) => entry.locationId !== location.locationId),
          location,
        ].sort((a, b) => a.locationId - b.locationId),
      })),
    }),
    {
      name: 'pharmacy-locations',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LocationState>;
        const stored = Array.isArray(p.locations) ? p.locations : current.locations;
        const ids = new Set(stored.map((location) => location.locationId));
        const codes = new Set(stored.map((location) => location.locationCode.toLowerCase()));
        return {
          ...current,
          ...p,
          locations: [
            ...stored,
            ...current.locations.filter(
              (location) => !ids.has(location.locationId) && !codes.has(location.locationCode.toLowerCase())
            ),
          ],
        };
      },
    }
  )
);
