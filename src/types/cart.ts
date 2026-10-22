export interface CartLine {
  id: string; // client-side line id, stable while the line is in the cart
  itemId: string;
  itemNameAr: string;
  itemNameEn: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  unit: string;
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
}
