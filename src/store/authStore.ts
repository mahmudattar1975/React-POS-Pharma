import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CashierSession } from '../types/auth';

interface AuthState {
  session: CashierSession | null;
  login: (session: CashierSession) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      session: null,
      login: (session) => set({ session }),
      logout: () => set({ session: null }),
    }),
    { name: 'pharmacy-auth' }
  )
);
