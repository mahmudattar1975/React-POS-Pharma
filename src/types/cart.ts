import type { PackLevel } from './catalog';
import type { DosageSnapshot } from './dosage';
import type { DrugSerial } from './serial';

export interface CartLine {
  id: string; // client-side line id, stable while the line is in the cart
  itemId: string;
  itemNameAr: string;
  itemNameEn: string;
  batchId: string;
  batchNo: string;
  expiryDate: string | null;
  unit: string;
  // Set only for items with a pack ladder. `qty`/`unitPrice` are in this level (2 boxes @ 10.00),
  // while baseQty is the tablet count actually deducted from the batch at checkout.
  packLevel?: PackLevel;
  baseQty: number;
  qty: number;
  unitPrice: number; // VAT-exclusive
  vatRate: number;
  offerLabel?: string;
  manualDiscountType?: 'amount' | 'percent'; // cashier-entered override, stacked on top of offer/tier
  manualDiscountValue?: number; // raw entered number - SAR off the line if 'amount', else a percent of gross (e.g. 10 = 10%)
  discountAmount: number; // VAT-exclusive discount total for the whole line (offer + manual + tier)
  netExclVat: number;
  vatAmount: number;
  totalInclVat: number;
  qtyAvailable: number; // batch's qtyOnHand at the moment the line was added, for a max-qty guard
  // Physical units captured from their GS1 DataMatrix while this line was being scanned. Each
  // entry is one pack the pharmacy is about to sell, kept so RSD's Pharmacy Sale can report the
  // unit later (see types/serial.ts). Undefined for ordinary barcode scans and loose units.
  serials?: DrugSerial[];
  // Directions the pharmacist picked for this line, frozen at selection time (not just an id), so
  // re-pricing the cart or editing the DOS master cannot change what is about to be printed.
  dosage?: DosageSnapshot;
  // True when the line is part of the active Wasfaty dispense (money model Option A). The flag is
  // decided when the line is added: an item on the Wasfaty list (or one with a NUPCO code) is
  // covered, anything else stays a normal patient-paid line in the same basket. `nupcoCode` is the
  // snapshot used for the checkout guard and the claim record - if it is missing on a covered line,
  // the sale is blocked until the item is mapped (see POSPage's checkout guard).
  wasfaty?: boolean;
  nupcoCode?: string;
}
