import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Customer } from '../types/customer';
import { seedCustomers } from '../utils/seedData';

interface CustomerState {
  customers: Customer[];
  byId: (id: string) => Customer | undefined;
  byPhone: (phone: string) => Customer | undefined;
  addCustomer: (
    input: Pick<Customer, 'nameAr' | 'nameEn' | 'phone' | 'tier'> &
      Partial<Pick<Customer, 'email' | 'nationalId' | 'mainAccountId'>>
  ) => Customer;
  // Resolves a household sub-account to the main account that actually holds the points balance
  // (one level only, matching the legacy PATIENT_MAIN_NO relationship - not a chain). Returns the
  // id unchanged for a customer with no mainAccountId, or if the linked account no longer exists.
  rootId: (customerId: string) => string;
  pointsBalanceFor: (customerId: string) => number;
  earnPoints: (customerId: string, points: number) => void;
  redeemPoints: (customerId: string, points: number) => void;
}

export const useCustomerStore = create<CustomerState>()(
  persist(
    (set, get) => ({
      customers: seedCustomers,

      byId: (id) => get().customers.find((c) => c.id === id),

      byPhone: (phone) => get().customers.find((c) => c.phone === phone),

      // First-time lookup with no match creates the record, matching the legacy patient screen's
      // "not found - create it" flow (w_list_pharmacy_patient_data), minus the multi-branch sync.
      addCustomer: (input) => {
        const customer: Customer = { id: crypto.randomUUID(), loyaltyPoints: 0, ...input };
        set((s) => ({ customers: [...s.customers, customer] }));
        return customer;
      },

      rootId: (customerId) => {
        const c = get().byId(customerId);
        if (!c?.mainAccountId || c.mainAccountId === c.id) return customerId;
        return get().byId(c.mainAccountId) ? c.mainAccountId : customerId;
      },

      pointsBalanceFor: (customerId) => get().byId(get().rootId(customerId))?.loyaltyPoints ?? 0,

      earnPoints: (customerId, points) => {
        const targetId = get().rootId(customerId);
        set((s) => ({
          customers: s.customers.map((c) => (c.id === targetId ? { ...c, loyaltyPoints: c.loyaltyPoints + points } : c)),
        }));
      },

      // Clamped at 0 - never lets a rounding edge case push a balance negative.
      redeemPoints: (customerId, points) => {
        const targetId = get().rootId(customerId);
        set((s) => ({
          customers: s.customers.map((c) =>
            c.id === targetId ? { ...c, loyaltyPoints: Math.max(0, c.loyaltyPoints - points) } : c
          ),
        }));
      },
    }),
    { name: 'pharmacy-customers' }
  )
);
