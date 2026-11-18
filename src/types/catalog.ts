// SFDA's real narcotic/psychotropic drug schedules (A-E, adapted from the 1971 UN Convention
// categories) plus a plain 'prescription' tier for prescription-only drugs that aren't
// schedule-classified narcotics. Confirmed against SFDA's own "Procedures and Controls for
// Narcotic and Psychotropic Substances" regulation - not present anywhere in the legacy item
// master (FcodStock has no schedule/narcotic field, only a broader SFDA-serialization
// tracking_flag unrelated to controlled-substance classification), so this is new to this app.
export type ControlledStatus = 'prescription' | 'schedule_a' | 'schedule_b' | 'schedule_c' | 'schedule_d' | 'schedule_e';

// Pack ladder for a product sold in nested packaging. Stock is always counted in tablets (the
// smallest unit); carton/box/strip are multipliers. See utils/packUnits.ts.
export type PackLevel = 'carton' | 'box' | 'strip' | 'tablet';

export interface PackConfig {
  cartonSize: number; // boxes per carton
  boxSize: number; // strips per box
  stripSize: number; // tablets per strip
}

export interface Item {
  id: string;
  // Legacy FCODSTOCK.ITEM_NO shown as "رقم الصنف" on the Item Master screen. Local seed/created
  // items carry a made-up 4-digit number (1001, 1002, ...) while items scanned in from XPH keep
  // their real ERP item number (see catalogStore.ts's upsertErpItem) - optional so catalogs saved
  // before the Item Master page existed still load; utils/itemMaster.ts derives a stable number
  // from the id when it is missing.
  itemNo?: number;
  barcode: string; // primary scannable code - the one on the box/pack
  // Any other codes the same product carries (strip barcode, old packaging, supplier code). They
  // are aliases: scanning one finds this item and adds its default (box) level. `barcode` stays
  // the canonical code used on receipts and the ERP/ZATCA payloads.
  barcodes?: string[];
  nameAr: string;
  nameEn: string;
  unit: string; // Box, Strip, Bottle, ...
  // Optional nested-pack ladder. When set, Batch.qtyOnHand is counted in TABLETS and basePrice is
  // the BOX price; strip/tablet prices are derived (box price ÷ how many fit in a box). Items
  // without it keep their existing single-unit behaviour, so old catalogs and ERP rows are untouched.
  pack?: PackConfig;
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
  // Whether the product carries an expiry date at all. undefined = yes (the safe default for every
  // item that existed before this flag). Set to false for non-dated goods (supplies, equipment,
  // some cosmetics) so receiving stores a null expiry instead of a fake 1900-01-01 that would then
  // sort as "expired" in FEFO and every expiry report.
  hasExpiry?: boolean;
  reorderLevel: number;
  // ---- Optional item-master metadata, mirroring FCODSTOCK -------------------------------------
  // The legacy screen (phstock.pbl's w_scrn_stock_data) carries these beside the sell-side fields
  // above. They are optional rather than required so older persisted catalogs and ERP-scanned
  // items (whose integration does not return them) keep loading unchanged.
  gtin?: string; // the pack's GTIN when it differs from the internal barcode
  registrationNo?: string; // SFDA / drug registration number ("رقم التسجيل")
  customsNo?: string; // customs tariff number ("الرقم الجمركي")
  scientificName?: string; // active ingredient ("المادة العلمية")
  manufacturerNo?: string; // manufacturer / company number ("رقم الشركة المصنعة")
  vendorNo?: string; // preferred vendor number - matches Vendor.vendorNo in types/purchasing.ts
  // Dosage instructions (DOS/SIG) that suit this product, from the shared library in
  // types/dosage.ts. The item can link several (e.g. a 5-day and a 3-day course) and mark one as
  // the suggestion the POS shows first. The links are OPTIONAL and never block a sale: the
  // pharmacist still chooses the final instruction per line at the till.
  dosageIds?: string[];
  defaultDosageId?: string; // one of dosageIds, shown first / marked "Suggested" in the POS picker
  location?: string; // shelf / store location ("موقع الصنف")
  cartonQty?: number; // units per carton ("كمية الكرتونة")
  maxLevel?: number; // maximum stock level ("الحد الاعلى") - reorderLevel is the minimum
  // false = discontinued. undefined means active, so every row saved before this field existed
  // (and every ERP item, which has no status column in the integration) keeps selling normally.
  isActive?: boolean;
  // ---- Wasfaty / NUPCO mapping (Phase 0) -------------------------------------------------------
  // `nupcoCode` is the item's code on NUPCO's approved Wasfaty item list. It is pharmacy-specific
  // mapping data, not something to infer: one NUPCO code belongs to exactly one local item, and the
  // mapping screen refuses duplicates. `wasfatyEligible` records whether the item is on the
  // approved Wasfaty list even before a code has been entered, so an eligible-but-unmapped item can
  // be blocked with a fix path instead of being silently sold as a private item.
  //
  // `wasfatyPrice` is the NUPCO-approved selling price for one item unit (the box price when the
  // item has a pack ladder), used for money model Option A. Undefined means the normal sale price is
  // also the NUPCO-approved price; the POS still records the price it actually invoiced on the sale.
  nupcoCode?: string;
  wasfatyPrice?: number;
  wasfatyEligible?: boolean;
}

export interface Batch {
  id: string;
  itemId: string;
  batchNo: string;
  expiryDate: string | null; // ISO date (yyyy-mm-dd); null = the item has no expiry date
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
