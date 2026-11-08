// Purchasing-side types: the vendor master (mock seed data, see utils/seedData.ts's seedVendors)
// and the vendor purchase invoice - the header N-lines document a pharmacy receives from a
// distributor (Al-Dawaa/Nahdi-style: paper invoice with a supplier invoice number, lines each
// carrying their own batch/lot and expiry). Posting it creates/segments the stock batches via
// catalogStore's receiveStock (one ReceivingEvent per line, tagged with this invoice no) and
// records the header here for the Purchases history.
//
// The line/tier/bonus field names below intentionally shadow the live XPH tables (verified
// against server Mahmoud-pc/xph on 2026-10-26):
//   FTRNBUYR lines:   PUR_QTY / BONUS_QTY / TOTAL_QTY, DISCOUNT_1..5 + TOTAL_DISCOUNT_1..5,
//                     TOTAL_BONUS_AMOUNT, NET_RPUR_NVAT_AMOUNT, VAT_PERCENT, TOTAL_RPUR_VAT_AMOUNT
//   FQTYITEM batches: NET_PUR_PRICE (the diluted per-unit cost the batch is stocked at)
// This app stores the FIRST THREE tiers (the SCR 10.58 entry screen exposes exactly three
// discount fields, em_11-1..3, even though the table has five slots) + bonus qty.
import type { VatBucket } from '../utils/vat';
import type { PackLevel } from './catalog';

export interface Vendor {
  id: string;
  // System-assigned vendor number (VEN-000001...), never typed by a user - see
  // nextVendorNumber in utils/purchasing.ts. This is the master's stable display key (legacy
  // CUST_NO analogue), so a vendor rename doesn't change how history/payables refer to it.
  vendorNo: string;
  nameAr: string;
  nameEn: string;
  phone: string;
  // Suppliers are B2B - their VAT registration goes on their own paper invoice, and it's what
  // the pharmacy checks before paying recoverable input tax. Mock/demo numbers, not real ones.
  // OPTIONAL/nullable: a small local supplier may not be VAT-registered (or the number is simply
  // not on hand yet), so blank is a legal state - when present it must be exactly 15 digits
  // (KSA rule; enforced by the New Vendor form, see utils/vat.ts).
  vatNumber?: string;
  // ---- Vendor-file fields ported from the legacy FCODCSVN vendor screen ----------------
  // The app has no accounting ledger yet, so the legacy computed rollups (balance, monthly totals,
  // total purchases/sales) are NOT stored on the vendor: purchase history is derived from the
  // posted invoices on the Vendors page. These are the genuine master-data settings the owner sets.
  category?: string; // legacy cust_category lookup, kept as a label here
  creditLimit?: number; // legacy cust_limit - a real business setting, editable
  settlementDays?: number; // legacy setlemen_days
  vatType?: number; // legacy vat_type code (1 standard, 2 zero-rated, 3 exempt)
  glnNo?: string; // legacy gln_no - GS1 location number, 13 digits when present
  bonusDiscountSetNo?: number; // legacy bonus_discount_set_no
  limitationSetNo?: number; // legacy limitation_set_no
  notes?: string; // legacy note
  // undefined = active, the same convention as Item.isActive. Legacy lock_flag was the inverse
  // (0 = open), so imported rows leave this undefined and stay usable.
  isActive?: boolean;
  // Last save timestamp (ISO) - the legacy fmodifiedon column shown on the vendor list.
  updatedAt?: string;
}

export interface PurchaseLine {
  id: string;
  itemId: string;
  itemNameAr: string;
  itemNameEn: string;
  unit: string;
  // Packed items only: the level the supplier invoiced (carton/box/strip/tablet). qty,
  // bonusQty, unitPurchasePrice and the cost figures are all in THIS unit; stock posting converts
  // to tablets (see catalogStore.receiveStock).
  packLevel?: PackLevel;
  vatRate: number; // from the item master - input tax is per line, like sales (see types/catalog.ts)
  batchNo: string;
  expiryDate: string; // ISO date
  // PAID quantity - the supplier's chargeable units (legacy em_5 / FTRNBUYR.PUR_QTY), excluding
  // free goods. round3 applies to tier/cost math, not here.
  qty: number;
  // Free goods on this delivery line, charged at 0 (legacy em_6 / FTRNBUYR.BONUS_QTY). They are
  // NOT part of gross/VAT - live XPH bonus rows (e.g. invoice 23243570: PUR_QTY 0 + 2760 bonus,
  // net 0) show bonus never taxed - but they DO dilute the batch's per-unit cost (NET_PUR_PRICE).
  bonusQty: number;
  // qty + bonusQty (legacy FTRNBUYR.TOTAL_QTY) - the units that actually land in the batch.
  totalQty: number;
  // What the free goods are worth at the line's purchase price (legacy TOTAL_BONUS_AMOUNT,
  // e.g. 250+250 @ 35.64 -> 8910.00). Informational: the vendor "charges" 0 for them.
  bonusValue: number;
  // The supplier's unit price before any vendor discount - same convention as Batch.purchasePrice
  // and the existing one-at-a-time Stock Receiving page (VAT-exclusive; input VAT is computed on
  // the net line).
  unitPurchasePrice: number;
  // Up to three cascading vendor discount tiers as fractions (0.2 = 20%), the legacy
  // call_discount() cascade: tier N applies to the balance AFTER the previous tiers.
  // tier1Amount = gross*d1; tier2 = (gross-tier1)*d2; tier3 = (gross-tier1-tier2)*d3.
  discount1Percent: number;
  discount2Percent: number;
  discount3Percent: number;
  // The SAR amount each tier actually took off (legacy TOTAL_DISCOUNT_1..3 / TOTAL_DISCOUNT_AMOUNT).
  // round3, matching the SCR screen's own ###.### masks (its 12.01 - 80% -> 2.402 case).
  discount1Amount: number;
  discount2Amount: number;
  discount3Amount: number;
  discountTotal: number; // t1+t2+t3 = gross - netExclVat
  // Single-equivalent fraction 1 - (1-d1)(1-d2)(1-d3) - what batch costing and the receiving
  // log see, exactly like computeCostPrice's single discount. Derived, kept on the line so the
  // persisted invoice is self-describing without re-computing.
  purchaseDiscountPercent: number;
  unitCostPrice: number; // per PAID unit = unitPurchasePrice - tiers, via computeCostPrice
  // Per RECEIVED unit (paid + bonus) = netExclVat / totalQty, round3 - the cost the batch is
  // actually stocked at (legacy FQTYITEM.NET_PUR_PRICE), e.g. 100 + 10 bonus @ 20 -> 18.182.
  // Optional on the type because invoices posted before bonus-diluted costing existed only carry
  // unitCostPrice; the page falls back to that for history rows.
  dilutedUnitCostPrice?: number;
  netExclVat: number; // qty * unitPurchasePrice - discountTotal) on the paid gross, before VAT
  vatAmount: number; // recoverable input tax - on the paid net only, never on bonus value
  totalInclVat: number;
}

export interface PurchaseInvoice {
  id: string;
  // This app's own sequential document number (PUR-xxxxxx) - NOT the supplier's number, which is
  // tracked separately below since it's the key a paper invoice is found by (and the
  // vendor+number pair is what guards against double-posting the same delivery).
  invoiceNo: string;
  vendorInvoiceNo: string; // the number printed on the vendor's own paper/PDF invoice
  vendorId: string;
  // Vendor-number snapshot at posting time (VEN-000001...). Kept on the invoice so history keeps
  // the number even if the vendor master row is later edited; undefined on pre-vendor-number
  // invoices (backward compatible).
  vendorNo?: string;
  vendorNameAr: string;
  vendorNameEn: string;
  date: string; // yyyy-mm-dd - the vendor invoice's date, defaulting to today
  notes?: string;
  // Branch cost center this purchase is attributed to (Phase A cost-center tagging, see
  // types/costCenters.ts) - optional for backward compatibility with already-posted invoices;
  // undefined rows surface in the Expenses page's unassigned exception list instead of blocking
  // anything. Defaults from settings.costCenterId ("current store"), overridable in the header.
  costCenterId?: string;
  receivedAt: string; // ISO datetime - when it was posted into stock
  receivedBy: string; // cashier/staff name snapshot, like SaleHeader.cashierName
  lines: PurchaseLine[];
  subtotalExclVat: number; // sum of gross (qty * unitPurchasePrice), before tier discounts
  totalDiscount: number; // sum of per-line tier discounts (discountTotal)
  totalBonusValue: number; // what the free goods were worth at line prices (legacy TOTAL_BONUS)
  netExclVat: number; // subtotal - discounts = the taxable base across lines
  totalVatAmount: number; // recoverable input tax
  totalInclVat: number; // what the vendor's paper invoice bottom-line will actually say
  // One bucket per distinct VAT rate present - the same mixed 0%/15% split as sales, since input
  // tax follows the item master exactly like output tax does.
  vatByRate: VatBucket[];
}
