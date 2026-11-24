import { create } from 'zustand';
import * as posApi from '../api/posApi';
import type { Shift, ShiftCloseResult } from '../types/auth';

interface ShiftState {
  shift: Shift | null;
  loading: boolean;
  error: string | null;
  lastClose: ShiftCloseResult | null;
  refresh: () => Promise<void>;
  open: (openingFloat: number) => Promise<void>;
  close: (closingAmount: number) => Promise<ShiftCloseResult>;
  clearLastClose: () => void;
}

// Not persisted - the open shift lives in dotnet-pos, keyed to whichever cashier is logged in, so
// this is always re-fetched from there (via refresh()) rather than trusted from localStorage.
export const useShiftStore = create<ShiftState>()((set) => ({
  shift: null,
  loading: true,
  error: null,
  lastClose: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const shift = await posApi.getCurrentShift();
      set({ shift, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },
  open: async (openingFloat) => {
    const shift = await posApi.openShift(openingFloat);
    set({ shift });
  },
  close: async (closingAmount) => {
    const result = await posApi.closeShift(closingAmount);
    set({ shift: null, lastClose: result });
    return result;
  },
  clearLastClose: () => set({ lastClose: null }),
}));
