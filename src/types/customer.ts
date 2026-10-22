export type CustomerTier = 'normal' | 'special' | 'vip';

export interface Customer {
  id: string;
  nameAr: string;
  nameEn: string;
  phone: string;
  email?: string;
  nationalId?: string; // Saudi national ID (citizen) or iqama (resident) - 10 digits, matches legacy PATIENT_ID_NO
  vatNumber?: string; // presence of a real VAT number makes the sale a B2B "standard" invoice, not "simplified"
  tier: CustomerTier;
  loyaltyPoints: number; // balance is phone-linked, like the legacy patient ledger - walk-in (no phone) never accrues
  // Links this customer's loyalty activity to a household "main account" holder (legacy
  // PATIENT_MAIN_NO) - a family member's purchases earn/redeem against the main account's
  // balance instead of their own. Always resolve through customerStore's rootId/pointsBalanceFor
  // rather than reading loyaltyPoints directly when this is set - it stays at 0 and is unused.
  mainAccountId?: string;
}

// Discount percent applied on top of any item-level offer, by customer tier.
export const TIER_DISCOUNT: Record<CustomerTier, number> = {
  normal: 0,
  special: 0.05,
  vip: 0.1,
};
