import type { Item, Batch, Offer } from '../types/catalog';
import type { CustomerTier } from '../types/customer';
import { TIER_DISCOUNT } from '../types/customer';
import type { CartLine } from '../types/cart';
import { lineVat, lineTotalInclVat, round2, round3, groupVatByRate, type VatBucket } from './vat';

export function activeOfferFor(item: Item, offers: Offer[], today: string): Offer | undefined {
  return offers.find((o) => o.itemId === item.id && o.activeFrom <= today && today <= o.activeTo);
}

// Real pharmacy pricing is set per BATCH, not per item (see types/catalog.ts's note on
// Batch.salePriceOverride) - an item pulled in live from XPH carries its batch's own price, while
// the local seed catalog never sets this and falls through to the item-level price.
export function resolveSalePrice(item: Item, batch: Batch): number {
  return batch.salePriceOverride ?? item.basePrice;
}

// Net cost after the vendor discount - e.g. purchasePrice 10, discount 0.10 -> 9.00. Computed
// once when a batch is received (see catalogStore.ts's receiveStock) and stored as Batch.costPrice
// rather than re-derived on every read, matching the real ERP's own schema (see types/catalog.ts).
// Rounded to 3 decimals, not 2 - a bulk purchase's per-unit net cost often lands on a fraction of
// a halala (confirmed live in XPH: net_pur_price 2.402), which round2 would silently truncate.
export function computeCostPrice(purchasePrice: number, purchaseDiscountPercent: number): number {
  return round3(purchasePrice * (1 - purchaseDiscountPercent));
}

// Applies, in order: an item-level promotional offer (percent / flat value / buy-X-get-Y-free),
// then the customer's tier discount on whatever remains - mirrors the legacy screen's two-stage
// "offer discount, then VIP/profile discount" flow (get_item_active_offer + read_bonuc_disc_rate).
export function priceCartLine(
  item: Item,
  batch: Batch,
  qty: number,
  offers: Offer[],
  customerTier: CustomerTier,
  existingId?: string,
  manualDiscount?: { type: 'amount' | 'percent'; value: number }
): CartLine {
  const today = new Date().toISOString().slice(0, 10);
  const offer = activeOfferFor(item, offers, today);
  const unitPrice = resolveSalePrice(item, batch);
  const gross = round2(qty * unitPrice);

  let offerDiscount = 0;
  let offerLabel: string | undefined;
  if (offer) {
    if (offer.type === 'percent' && offer.percent) {
      offerDiscount = round2(gross * offer.percent);
      offerLabel = offer.label;
    } else if (offer.type === 'value' && offer.value) {
      offerDiscount = round2(Math.min(offer.value * qty, gross));
      offerLabel = offer.label;
    } else if (offer.type === 'bogo' && offer.buyQty && offer.freeQty) {
      const bundleSize = offer.buyQty + offer.freeQty;
      const freeUnits = Math.floor(qty / bundleSize) * offer.freeQty;
      if (freeUnits > 0) {
        offerDiscount = round2(freeUnits * unitPrice);
        offerLabel = offer.label;
      }
    }
  }

  // Cashier-entered override (the POS "Discount" button per row). A promotional offer and a
  // manual discount stacking on the same line lets the till under-charge well past what either
  // discount alone allows, so once a line is actively earning its offer, any manual discount on
  // it - even one entered earlier, before a qty bump made the offer kick in - is dropped rather
  // than stacked. 'amount' is a flat SAR-off for the whole line (not per unit, unlike an offer's
  // 'value' type); 'percent' is entered as a fraction (0.15 = 15%), matching the fraction
  // convention already used for VAT_PERCENT throughout this app/ERP, not raw percentage points.
  const manualDiscountActive = !offerLabel && !!manualDiscount && manualDiscount.value > 0;
  let manualDiscountAmount = 0;
  if (manualDiscountActive) {
    manualDiscountAmount =
      manualDiscount!.type === 'percent' ? round2(gross * manualDiscount!.value) : round2(manualDiscount!.value);
    manualDiscountAmount = Math.max(0, Math.min(manualDiscountAmount, gross - offerDiscount));
  }

  const afterOffer = gross - offerDiscount - manualDiscountAmount;
  const tierRate = TIER_DISCOUNT[customerTier];
  const tierDiscount = round2(afterOffer * tierRate);
  const discountAmount = round2(offerDiscount + manualDiscountAmount + tierDiscount);
  const netExclVat = round2(gross - discountAmount);

  return {
    id: existingId ?? `cl-${batch.id}-${Date.now()}`,
    itemId: item.id,
    itemNameAr: item.nameAr,
    itemNameEn: item.nameEn,
    batchId: batch.id,
    batchNo: batch.batchNo,
    expiryDate: batch.expiryDate,
    unit: item.unit,
    qty,
    unitPrice,
    vatRate: item.vatRate,
    offerLabel,
    manualDiscountType: manualDiscountActive ? manualDiscount!.type : undefined,
    manualDiscountValue: manualDiscountActive ? manualDiscount!.value : undefined,
    discountAmount,
    netExclVat,
    vatAmount: lineVat(netExclVat, item.vatRate),
    totalInclVat: lineTotalInclVat(netExclVat, item.vatRate),
    qtyAvailable: batch.qtyOnHand,
  };
}

export interface CartTotals {
  subtotalExclVat: number;
  totalDiscount: number;
  totalVatAmount: number;
  totalInclVat: number;
  // One entry per distinct VAT rate present in the cart - a pharmacy invoice routinely mixes a
  // 0% (medicine) bucket with a 0.15 (cosmetics/other) bucket, so a single "VAT (15%)" figure is
  // wrong to show whenever more than one rate is in play. Mirrors the TaxSubtotal grouping
  // server/src/ubl/buildInvoiceXml.ts computes for the actual ZATCA submission - same grouping,
  // shown to the cashier/customer instead of only being an implementation detail of the XML.
  vatByRate: VatBucket[];
}

export function computeCartTotals(lines: CartLine[]): CartTotals {
  const subtotalExclVat = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const totalDiscount = round2(lines.reduce((s, l) => s + l.discountAmount, 0));
  const totalVatAmount = round2(lines.reduce((s, l) => s + l.vatAmount, 0));
  const totalInclVat = round2(lines.reduce((s, l) => s + l.totalInclVat, 0));
  const vatByRate = groupVatByRate(lines);

  return { subtotalExclVat, totalDiscount, totalVatAmount, totalInclVat, vatByRate };
}
