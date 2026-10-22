// SFDA's real narcotic/psychotropic drug schedules (A-E, adapted from the 1971 UN Convention
// categories) plus a plain 'prescription' tier for prescription-only drugs that aren't
// schedule-classified narcotics. Confirmed against SFDA's own "Procedures and Controls for
// Narcotic and Psychotropic Substances" regulation - not present anywhere in the legacy item
// master (FcodStock has no schedule/narcotic field, only a broader SFDA-serialization
// tracking_flag unrelated to controlled-substance classification), so this is new to this app.
export type ControlledStatus = 'prescription' | 'schedule_a' | 'schedule_b' | 'schedule_c' | 'schedule_d' | 'schedule_e';

export interface Item {
  id: string;
  barcode: string; // base unit GTIN/EAN printed on the pack
  nameAr: string;
  nameEn: string;
  unit: string; // Box, Strip, Bottle, ...
  category: string;
  basePrice: number; // unit sale price, VAT-EXCLUSIVE, SAR
  // undefined = no restriction. Set manually per item (Inventory & Expiry page) - there's no
  // reliable source for this in the ERP data, so it's never inferred automatically. Selling an
  // item with this set requires prescription info to be captured at checkout - see
  // types/sales.ts's PrescriptionInfo and POSPage's checkout gate.
  controlledStatus?: ControlledStatus;
  // Set per item in the item master, never a single invoice-wide rate - a KSA pharmacy invoice
  // routinely mixes zero-rated and standard-rated lines. SFDA-registered medicines are 0 (zero-
  // rated); cosmetics, hygiene products, and most OTC supplements are 0.15 (standard-rated), even
  // when sold from the same register in the same transaction as a zero-rated drug. Every VAT
  // calculation in this app (utils/pricing.ts, utils/vat.ts, the UBL TaxSubtotal grouping in
  // server/src/ubl/buildInvoiceXml.ts) reads this field per line - see utils/seedData.ts for
  // worked examples of both categories.
  vatRate: number;
  requiresBatchTracking: boolean; // true for virtually all pharmacy stock
  reorderLevel: number;
}

export interface Batch {
  id: string;
  itemId: string;
  batchNo: string;
  expiryDate: string; // ISO date (yyyy-mm-dd)
  receivedDate: string; // ISO date
  qtyOnHand: number;
  // Purchase price (the supplier's box/invoice price, before discount), the vendor discount
  // applied to it, and the resulting net cost - all stored separately rather than only keeping
  // the final cost, matching the real ERP's own schema (confirmed live from XPH's FqtyItem table:
  // pur_price, discount_1, net_pur_price are three distinct stored columns, with
  // net_pur_price = pur_price * (1 - discount_1) computed once at receiving time, not re-derived
  // on every read). costPrice is that same computed net cost - see
  // utils/pricing.ts's computeCostPrice, used by Stock Receiving when a new batch is created.
  purchasePrice: number;
  purchaseDiscountPercent: number; // fraction, e.g. 0.10 = 10% off the purchase price
  costPrice: number; // = purchasePrice * (1 - purchaseDiscountPercent)
  gtin?: string; // captured from a GS1 scan, if it differed from the item's own barcode
  // Real pharmacy pricing (confirmed live from XPH's FqtyItem table) is set per BATCH, not per
  // item - two batches of the same product can carry different sale prices. The local seed
  // catalog only ever had one price per item (Item.basePrice), so that field was never wrong for
  // it - but an item pulled in from the live ERP integration (store/catalogStore.ts's
  // upsertErpItem) needs this override so its batches price correctly even when they differ.
  // utils/pricing.ts prefers this over Item.basePrice whenever it's set.
  salePriceOverride?: number;
}

export type OfferType = 'percent' | 'value' | 'bogo';

export interface Offer {
  id: string;
  itemId: string;
  type: OfferType;
  percent?: number; // for 'percent': 0.10 = 10% off
  value?: number; // for 'value': flat SAR off per unit
  buyQty?: number; // for 'bogo': buy this many...
  freeQty?: number; // ...get this many free
  activeFrom: string; // ISO date
  activeTo: string; // ISO date
  label: string; // short human description shown on the cart line
}
