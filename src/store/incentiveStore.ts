import { create } from 'zustand';
import * as incentiveApi from '../api/incentiveApi';
import type { IncentiveItem } from '../types/incentive';

interface IncentiveState {
  items: IncentiveItem[];
  active: IncentiveItem[]; // active rules for "today"
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshActive: (date?: string) => Promise<void>;
  addItem: (input: Omit<IncentiveItem, 'id' | 'itemNameEn' | 'itemNameAr'>) => Promise<IncentiveItem>;
  updateItem: (id: string, patch: Partial<Omit<IncentiveItem, 'id' | 'itemNameEn' | 'itemNameAr'>>) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  activeRuleFor: (itemId: string, date?: string) => IncentiveItem | null;
}

export const useIncentiveStore = create<IncentiveState>()((set, get) => ({
  items: [],
  active: [],
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const items = await incentiveApi.listIncentiveItems();
      set({ items, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  refreshActive: async (date) => {
    try {
      const active = await incentiveApi.getActiveIncentives(date);
      set({ active });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  addItem: async (input) => {
    const created = await incentiveApi.createIncentiveItem(input);
    set((s) => ({ items: [created, ...s.items] }));
    return created;
  },

  updateItem: async (id, patch) => {
    const updated = await incentiveApi.updateIncentiveItem(id, patch);
    set((s) => ({ items: s.items.map((it) => (it.id === id ? updated : it)) }));
  },

  removeItem: async (id) => {
    await incentiveApi.deleteIncentiveItem(id);
    set((s) => ({ items: s.items.filter((it) => it.id !== id), active: s.active.filter((it) => it.id !== id) }));
  },

  activeRuleFor: (itemId, date) => {
    const d = date ?? new Date().toISOString().slice(0, 10);
    const candidates = get().active.filter((r) => r.itemId === itemId && r.active && r.activeFrom <= d && r.activeTo >= d);
    return candidates.length ? candidates[candidates.length - 1] : null;
  },
}));
