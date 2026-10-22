import type { Item, Batch, Offer } from '../types/catalog';
import type { Customer } from '../types/customer';

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// VAT rate is set per item, read from the item master, exactly like the legacy system's own
// Wfcodstock_vat_percent field - never a single invoice-wide rate. In KSA, SFDA-registered
// medicines are zero-rated; cosmetics, hygiene products, and most supplements are standard-rated
// (15%) even when sold from the same pharmacy register in the same transaction as a zero-rated
// drug. Infant formula sits in its own separate zero-rating category (not because it's a
// "medicine") - kept zero here for the same real-world reason, not conflated with the drug rule.
export const seedItems: Item[] = [
  { id: 'itm-1', barcode: '6281007320014', nameAr: 'باراسيتامول 500 مجم', nameEn: 'Paracetamol 500mg (20 tabs)', unit: 'Strip', category: 'Analgesics', basePrice: 4.5, vatRate: 0, requiresBatchTracking: true, reorderLevel: 30 }, // SFDA-registered medicine - zero-rated
  { id: 'itm-2', barcode: '6281007320021', nameAr: 'أموكسيسيلين شراب 125مجم', nameEn: 'Amoxicillin Syrup 125mg/5ml', unit: 'Bottle', category: 'Antibiotics', basePrice: 12.0, vatRate: 0, requiresBatchTracking: true, reorderLevel: 15 }, // medicine - zero-rated
  { id: 'itm-3', barcode: '6281007320038', nameAr: 'انسولين لانتوس', nameEn: 'Insulin Lantus 100IU/ml', unit: 'Vial', category: 'Diabetes', basePrice: 95.0, vatRate: 0, requiresBatchTracking: true, reorderLevel: 10 }, // medicine - zero-rated
  { id: 'itm-4', barcode: '6281007320045', nameAr: 'فيتامين د3 1000 وحدة', nameEn: 'Vitamin D3 1000IU (30 caps)', unit: 'Box', category: 'Supplements', basePrice: 22.0, vatRate: 0.15, requiresBatchTracking: true, reorderLevel: 20 }, // OTC supplement, not an SFDA-registered drug - standard-rated
  { id: 'itm-5', barcode: '6281007320052', nameAr: 'حليب أطفال مدعم', nameEn: 'Infant Formula Milk 400g', unit: 'Tin', category: 'Baby Care', basePrice: 48.0, vatRate: 0, requiresBatchTracking: true, reorderLevel: 12 }, // separate zero-rating category, not a drug
  { id: 'itm-6', barcode: '6281007320069', nameAr: 'أوميبرازول 20 مجم', nameEn: 'Omeprazole 20mg (14 caps)', unit: 'Strip', category: 'Gastro', basePrice: 9.5, vatRate: 0, requiresBatchTracking: true, reorderLevel: 25 }, // medicine - zero-rated
  { id: 'itm-7', barcode: '6281007320076', nameAr: 'مطهر كحولي لليدين', nameEn: 'Hand Sanitizer Gel 500ml', unit: 'Bottle', category: 'Hygiene', basePrice: 15.0, vatRate: 0.15, requiresBatchTracking: false, reorderLevel: 40 }, // cosmetic/hygiene item, not a drug - standard-rated
  // Pre-flagged for testing the prescription/controlled-substance checkout gate (see
  // types/catalog.ts's ControlledStatus) - real SFDA schedule classes, not arbitrary demo values.
  { id: 'itm-8', barcode: '6281007320083', nameAr: 'ترامادول 50 مجم', nameEn: 'Tramadol 50mg (20 caps)', unit: 'Strip', category: 'Analgesics', basePrice: 18.0, vatRate: 0, requiresBatchTracking: true, reorderLevel: 10, controlledStatus: 'schedule_a' }, // narcotic analgesic
  { id: 'itm-9', barcode: '6281007320090', nameAr: 'ديازيبام 5 مجم', nameEn: 'Diazepam 5mg (20 tabs)', unit: 'Strip', category: 'Psychotropics', basePrice: 14.0, vatRate: 0, requiresBatchTracking: true, reorderLevel: 10, controlledStatus: 'schedule_c' }, // benzodiazepine, psychotropic
  { id: 'itm-10', barcode: '6281007320106', nameAr: 'أوجمنتين 1 جم', nameEn: 'Augmentin 1g (14 tabs)', unit: 'Box', category: 'Antibiotics', basePrice: 32.0, vatRate: 0, requiresBatchTracking: true, reorderLevel: 15, controlledStatus: 'prescription' }, // prescription-only antibiotic, not narcotic-scheduled
  // Deliberately low stock (2 units, see seedBatches below) so the "requested more than in stock"
  // warning (POSPage's updateQty handler) is trivially reproducible without a throwaway script.
  // Uses the real ERP item number (101682, confirmed live to have 4500 units at the real "Main
  // Store" branch - see server/src/erp/items.ts's getOtherBranchStock) as its id, namespaced the
  // same way catalogStore.ts's upsertErpItem would for a real scan - so "Check other branches"
  // queries the REAL backend for real data when it's reachable, exactly like a genuinely scanned
  // item would, rather than a fake demo-only button. If the ERP server isn't running, the dialog
  // degrades gracefully to its normal "can't check right now" state - see OtherBranchStockDialog.tsx.
  { id: 'erp-101682', barcode: '06285101000874', nameAr: 'سيفاكسون 1 جم وريد حقن', nameEn: 'CEFAXON 1000MG IV INJ VIAL', unit: 'BUTTL', category: 'XPH', basePrice: 48.05, vatRate: 0, requiresBatchTracking: true, reorderLevel: 0 },
];

// purchasePrice/purchaseDiscountPercent are the real inputs; costPrice = purchasePrice *
// (1 - purchaseDiscountPercent) - see utils/pricing.ts's computeCostPrice. Most batches here were
// bought with no special vendor discount (purchasePrice === costPrice, discount 0); a couple carry
// a real discount to demonstrate the computation (bat-1a: 3.50 less 20% = 2.80; bat-3a: 77.78 less
// 10% = 70.00) without changing any other batch's existing cost value.
export const seedBatches: Batch[] = [
  { id: 'bat-1a', itemId: 'itm-1', batchNo: 'PC24A17', expiryDate: isoDaysFromNow(400), receivedDate: isoDaysFromNow(-90), qtyOnHand: 120, purchasePrice: 3.5, purchaseDiscountPercent: 0.2, costPrice: 2.8 },
  { id: 'bat-1b', itemId: 'itm-1', batchNo: 'PC23F02', expiryDate: isoDaysFromNow(35), receivedDate: isoDaysFromNow(-300), qtyOnHand: 18, purchasePrice: 2.6, purchaseDiscountPercent: 0, costPrice: 2.6 },
  { id: 'bat-2a', itemId: 'itm-2', batchNo: 'AX24C09', expiryDate: isoDaysFromNow(210), receivedDate: isoDaysFromNow(-60), qtyOnHand: 40, purchasePrice: 7.5, purchaseDiscountPercent: 0, costPrice: 7.5 },
  { id: 'bat-3a', itemId: 'itm-3', batchNo: 'LN24G51', expiryDate: isoDaysFromNow(150), receivedDate: isoDaysFromNow(-45), qtyOnHand: 22, purchasePrice: 77.78, purchaseDiscountPercent: 0.1, costPrice: 70.0 },
  { id: 'bat-3b', itemId: 'itm-3', batchNo: 'LN23K12', expiryDate: isoDaysFromNow(20), receivedDate: isoDaysFromNow(-260), qtyOnHand: 6, purchasePrice: 68.0, purchaseDiscountPercent: 0, costPrice: 68.0 },
  { id: 'bat-4a', itemId: 'itm-4', batchNo: 'VD24D22', expiryDate: isoDaysFromNow(500), receivedDate: isoDaysFromNow(-30), qtyOnHand: 60, purchasePrice: 14.0, purchaseDiscountPercent: 0, costPrice: 14.0 },
  { id: 'bat-5a', itemId: 'itm-5', batchNo: 'IF24E14', expiryDate: isoDaysFromNow(300), receivedDate: isoDaysFromNow(-70), qtyOnHand: 35, purchasePrice: 34.0, purchaseDiscountPercent: 0, costPrice: 34.0 },
  { id: 'bat-6a', itemId: 'itm-6', batchNo: 'OM24B31', expiryDate: isoDaysFromNow(280), receivedDate: isoDaysFromNow(-50), qtyOnHand: 50, purchasePrice: 5.2, purchaseDiscountPercent: 0, costPrice: 5.2 },
  { id: 'bat-6b', itemId: 'itm-6', batchNo: 'OM23H07', expiryDate: isoDaysFromNow(8), receivedDate: isoDaysFromNow(-330), qtyOnHand: 9, purchasePrice: 5.0, purchaseDiscountPercent: 0, costPrice: 5.0 },
  { id: 'bat-7a', itemId: 'itm-7', batchNo: 'HS24J03', expiryDate: isoDaysFromNow(600), receivedDate: isoDaysFromNow(-20), qtyOnHand: 80, purchasePrice: 8.0, purchaseDiscountPercent: 0, costPrice: 8.0 },
  { id: 'bat-8a', itemId: 'itm-8', batchNo: 'TR24L19', expiryDate: isoDaysFromNow(250), receivedDate: isoDaysFromNow(-40), qtyOnHand: 25, purchasePrice: 11.0, purchaseDiscountPercent: 0, costPrice: 11.0 },
  { id: 'bat-9a', itemId: 'itm-9', batchNo: 'DZ24M08', expiryDate: isoDaysFromNow(320), receivedDate: isoDaysFromNow(-25), qtyOnHand: 30, purchasePrice: 8.5, purchaseDiscountPercent: 0, costPrice: 8.5 },
  { id: 'bat-10a', itemId: 'itm-10', batchNo: 'AG24N27', expiryDate: isoDaysFromNow(180), receivedDate: isoDaysFromNow(-35), qtyOnHand: 40, purchasePrice: 19.0, purchaseDiscountPercent: 0, costPrice: 19.0 },
  // Only 2 on hand, on purpose - see the itm-erp-101682 comment above.
  { id: 'erp-batch-101682-C123075.2', itemId: 'erp-101682', batchNo: 'C123075.2', expiryDate: isoDaysFromNow(1), receivedDate: isoDaysFromNow(-5), qtyOnHand: 2, purchasePrice: 0, purchaseDiscountPercent: 0, costPrice: 0, salePriceOverride: 48.05 },
];

export const seedOffers: Offer[] = [
  { id: 'off-1', itemId: 'itm-1', type: 'bogo', buyQty: 2, freeQty: 1, activeFrom: isoDaysFromNow(-30), activeTo: isoDaysFromNow(60), label: 'Buy 2 Get 1 Free' },
  { id: 'off-2', itemId: 'itm-7', type: 'percent', percent: 0.2, activeFrom: isoDaysFromNow(-10), activeTo: isoDaysFromNow(30), label: '20% Off' },
];

export const seedCustomers: Customer[] = [
  { id: 'cus-walkin', nameAr: 'عميل نقدي', nameEn: 'Walk-in Customer', phone: '', tier: 'normal', loyaltyPoints: 0 },
  { id: 'cus-1', nameAr: 'أحمد العتيبي', nameEn: 'Ahmed Al-Otaibi', phone: '0501234567', email: 'ahmed.otaibi@example.com', nationalId: '1012345678', tier: 'vip', loyaltyPoints: 500 },
  { id: 'cus-2', nameAr: 'سارة القحطاني', nameEn: 'Sara Al-Qahtani', phone: '0559876543', email: 'sara.q@example.com', nationalId: '1023456789', tier: 'special', loyaltyPoints: 320 },
  { id: 'cus-3', nameAr: 'مؤسسة الفيصل التجارية', nameEn: 'Al-Faisal Trading Est.', phone: '0112223344', vatNumber: '300123456700003', tier: 'normal', loyaltyPoints: 0 },
];
