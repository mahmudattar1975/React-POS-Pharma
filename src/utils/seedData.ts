import type { Item, Batch, Offer, ItemCategory } from '../types/catalog';
import type { Customer } from '../types/customer';
import type { Vendor } from '../types/purchasing';
import type { CostCenter } from '../types/costCenters';
import type { Manufacturer } from '../types/manufacturer';
import type { DosageInstruction } from '../types/dosage';

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Offline fallback for dbo.ItemCategories. The SQL master is authoritative and synced on boot;
// these rows keep the Item Master dropdown and Excel importer usable before that sync completes.
// CategoryId values match the migration's explicit seed so imported references stay stable.
export const seedItemCategories: ItemCategory[] = [
  { categoryId: 1, categoryCode: 'CAT-001', nameAr: 'أدوية', nameEn: 'Medicines', parentCategoryId: null, isActive: true },
  { categoryId: 2, categoryCode: 'CAT-002', nameAr: 'مستلزمات طبية', nameEn: 'Medical Supplies', parentCategoryId: null, isActive: true },
  { categoryId: 3, categoryCode: 'CAT-003', nameAr: 'حفائض', nameEn: 'Diapers', parentCategoryId: null, isActive: true },
  { categoryId: 4, categoryCode: 'CAT-004', nameAr: 'مستحضرات تجميل', nameEn: 'Cosmetics', parentCategoryId: null, isActive: true },
  { categoryId: 5, categoryCode: 'CAT-005', nameAr: 'منتجات العناية بالبشرة', nameEn: 'Skin Care Products', parentCategoryId: null, isActive: true },
  { categoryId: 6, categoryCode: 'CAT-006', nameAr: 'منتجات العناية بالشعر', nameEn: 'Hair Care Products', parentCategoryId: null, isActive: true },
  { categoryId: 7, categoryCode: 'CAT-007', nameAr: 'منتجات العناية بالفم والأسنان', nameEn: 'Oral & Dental Care', parentCategoryId: null, isActive: true },
  { categoryId: 8, categoryCode: 'CAT-008', nameAr: 'الفيتامينات والمكملات الغذائية', nameEn: 'Vitamins & Supplements', parentCategoryId: null, isActive: true },
  { categoryId: 9, categoryCode: 'CAT-009', nameAr: 'منتجات الأطفال والرضع', nameEn: 'Baby Care Products', parentCategoryId: null, isActive: true },
  { categoryId: 10, categoryCode: 'CAT-010', nameAr: 'منتجات الأمومة', nameEn: 'Maternity Products', parentCategoryId: null, isActive: true },
  { categoryId: 11, categoryCode: 'CAT-011', nameAr: 'منتجات النظافة الشخصية', nameEn: 'Personal Hygiene Products', parentCategoryId: null, isActive: true },
  { categoryId: 12, categoryCode: 'CAT-012', nameAr: 'المطهرات والمعقمات', nameEn: 'Disinfectants & Sanitizers', parentCategoryId: null, isActive: true },
  { categoryId: 13, categoryCode: 'CAT-013', nameAr: 'الإسعافات الأولية', nameEn: 'First Aid Products', parentCategoryId: null, isActive: true },
  { categoryId: 14, categoryCode: 'CAT-014', nameAr: 'الأجهزة والمعدات الطبية', nameEn: 'Medical Devices & Equipment', parentCategoryId: null, isActive: true },
  { categoryId: 15, categoryCode: 'CAT-015', nameAr: 'أجهزة قياس السكر والضغط', nameEn: 'Glucose & Blood Pressure Monitors', parentCategoryId: null, isActive: true },
  { categoryId: 16, categoryCode: 'CAT-016', nameAr: 'مستلزمات مرضى السكري', nameEn: 'Diabetic Supplies', parentCategoryId: null, isActive: true },
  { categoryId: 17, categoryCode: 'CAT-017', nameAr: 'مستلزمات العظام والمفاصل', nameEn: 'Orthopedic Supplies', parentCategoryId: null, isActive: true },
  { categoryId: 18, categoryCode: 'CAT-018', nameAr: 'مستلزمات الجروح والضمادات', nameEn: 'Wound Care & Dressings', parentCategoryId: null, isActive: true },
  { categoryId: 19, categoryCode: 'CAT-019', nameAr: 'منتجات العناية بالعيون', nameEn: 'Eye Care Products', parentCategoryId: null, isActive: true },
  { categoryId: 20, categoryCode: 'CAT-020', nameAr: 'منتجات العناية بالأذن', nameEn: 'Ear Care Products', parentCategoryId: null, isActive: true },
  { categoryId: 21, categoryCode: 'CAT-021', nameAr: 'منتجات التخسيس والتغذية', nameEn: 'Weight Management & Nutrition', parentCategoryId: null, isActive: true },
  { categoryId: 22, categoryCode: 'CAT-022', nameAr: 'منتجات العناية بالقدم', nameEn: 'Foot Care Products', parentCategoryId: null, isActive: true },
  { categoryId: 23, categoryCode: 'CAT-023', nameAr: 'منتجات الحماية والوقاية', nameEn: 'Protective Products', parentCategoryId: null, isActive: true },
  { categoryId: 24, categoryCode: 'CAT-024', nameAr: 'مستلزمات كبار السن', nameEn: 'Elderly Care Products', parentCategoryId: null, isActive: true },
  { categoryId: 25, categoryCode: 'CAT-025', nameAr: 'مستلزمات طبية استهلاكية', nameEn: 'Disposable Medical Supplies', parentCategoryId: null, isActive: true },
  { categoryId: 26, categoryCode: 'CAT-026', nameAr: 'أغذية ومشروبات صحية', nameEn: 'Health Foods & Beverages', parentCategoryId: null, isActive: true },
  { categoryId: 27, categoryCode: 'CAT-027', nameAr: 'منتجات طبيعية وعشبية', nameEn: 'Herbal & Natural Products', parentCategoryId: null, isActive: true },
  { categoryId: 28, categoryCode: 'CAT-028', nameAr: 'منتجات موسمية', nameEn: 'Seasonal Products', parentCategoryId: null, isActive: true },
];

// VAT rate is set per item, read from the item master, exactly like the legacy system's own
// Wfcodstock_vat_percent field - never a single invoice-wide rate. In KSA, SFDA-registered
// medicines are zero-rated; cosmetics, hygiene products, and most supplements are standard-rated
// (15%) even when sold from the same pharmacy register in the same transaction as a zero-rated
// drug. Infant formula sits in its own separate zero-rating category (not because it's a
// "medicine") - kept zero here for the same real-world reason, not conflated with the drug rule.
export const seedItems: Item[] = [
  // Wasfaty demo mapping: real medicines carry a 13-digit NUPCO item code and an approved price.
  // The approved price is deliberately a little below the retail price on some lines so the Option A
  // behaviour (invoice at the NUPCO value, patient pays 0.00) is visible in the demo.
  { id: 'itm-1', barcode: '6281007320014', nameAr: 'باراسيتامول 500 مجم', nameEn: 'Paracetamol 500mg (20 tabs)', unit: 'Strip', category: 'Analgesics', basePrice: 4.5, vatRate: 0, requiresBatchTracking: true, reorderLevel: 30, dosageIds: ['dos-1', 'dos-2'], defaultDosageId: 'dos-1', nupcoCode: '6281007320014', wasfatyPrice: 4.25, wasfatyEligible: true }, // SFDA-registered medicine - zero-rated
  { id: 'itm-2', barcode: '6281007320021', nameAr: 'أموكسيسيلين شراب 125مجم', nameEn: 'Amoxicillin Syrup 125mg/5ml', unit: 'Bottle', category: 'Antibiotics', basePrice: 12.0, vatRate: 0, requiresBatchTracking: true, reorderLevel: 15, dosageIds: ['dos-3'], nupcoCode: '6281007320021', wasfatyPrice: 11.5, wasfatyEligible: true }, // medicine - zero-rated
  { id: 'itm-3', barcode: '6281007320038', nameAr: 'انسولين لانتوس', nameEn: 'Insulin Lantus 100IU/ml', unit: 'Vial', category: 'Diabetes', basePrice: 95.0, vatRate: 0, requiresBatchTracking: true, reorderLevel: 10, dosageIds: ['dos-4'], nupcoCode: '6281007320038', wasfatyPrice: 92.0, wasfatyEligible: true }, // medicine - zero-rated
  // On the approved list but deliberately NOT mapped yet: demonstrates the POS guard ("map this item
  // before dispensing") instead of silently charging a Wasfaty patient for it.
  { id: 'itm-4', barcode: '6281007320045', nameAr: 'فيتامين د3 1000 وحدة', nameEn: 'Vitamin D3 1000IU (30 caps)', unit: 'Box', category: 'Supplements', basePrice: 22.0, vatRate: 0.15, requiresBatchTracking: true, reorderLevel: 20, dosageIds: ['dos-5'], wasfatyEligible: true }, // OTC supplement, not an SFDA-registered drug - standard-rated
  { id: 'itm-5', barcode: '6281007320052', nameAr: 'حليب أطفال مدعم', nameEn: 'Infant Formula Milk 400g', unit: 'Tin', category: 'Baby Care', basePrice: 48.0, vatRate: 0, requiresBatchTracking: true, reorderLevel: 12 }, // separate zero-rating category, not a drug
  { id: 'itm-6', barcode: '6281007320069', nameAr: 'أوميبرازول 20 مجم', nameEn: 'Omeprazole 20mg (14 caps)', unit: 'Strip', category: 'Gastro', basePrice: 9.5, vatRate: 0, requiresBatchTracking: true, reorderLevel: 25, dosageIds: ['dos-6'], nupcoCode: '6281007320069', wasfatyPrice: 9.0, wasfatyEligible: true }, // medicine - zero-rated
  { id: 'itm-7', barcode: '6281007320076', nameAr: 'مطهر كحولي لليدين', nameEn: 'Hand Sanitizer Gel 500ml', unit: 'Bottle', category: 'Hygiene', basePrice: 15.0, vatRate: 0.15, requiresBatchTracking: false, reorderLevel: 40, dosageIds: ['dos-10'] }, // cosmetic/hygiene item, not a drug - standard-rated
  // Pre-flagged for testing the prescription/controlled-substance checkout gate (see
  // types/catalog.ts's ControlledStatus) - real SFDA schedule classes, not arbitrary demo values.
  { id: 'itm-8', barcode: '6281007320083', nameAr: 'ترامادول 50 مجم', nameEn: 'Tramadol 50mg (20 caps)', unit: 'Strip', category: 'Analgesics', basePrice: 18.0, vatRate: 0, requiresBatchTracking: true, reorderLevel: 10, controlledStatus: 'schedule_a', dosageIds: ['dos-7'], nupcoCode: '6281007320083', wasfatyPrice: 17.5, wasfatyEligible: true }, // narcotic analgesic
  { id: 'itm-9', barcode: '6281007320090', nameAr: 'ديازيبام 5 مجم', nameEn: 'Diazepam 5mg (20 tabs)', unit: 'Strip', category: 'Psychotropics', basePrice: 14.0, vatRate: 0, requiresBatchTracking: true, reorderLevel: 10, controlledStatus: 'schedule_c', dosageIds: ['dos-8'], nupcoCode: '6281007320090', wasfatyPrice: 13.5, wasfatyEligible: true }, // benzodiazepine, psychotropic
  { id: 'itm-10', barcode: '6281007320106', nameAr: 'أوجمنتين 1 جم', nameEn: 'Augmentin 1g (14 tabs)', unit: 'Box', category: 'Antibiotics', basePrice: 32.0, vatRate: 0, requiresBatchTracking: true, reorderLevel: 15, controlledStatus: 'prescription', dosageIds: ['dos-9'], nupcoCode: '6281007320106', wasfatyPrice: 30.5, wasfatyEligible: true }, // prescription-only antibiotic, not narcotic-scheduled
  // Deliberately low stock (2 units, see seedBatches below) so the "requested more than in stock"
  // warning (POSPage's updateQty handler) is trivially reproducible without a throwaway script.
  // Uses the real ERP item number (101682, confirmed live to have 4500 units at the real "Main
  // Store" branch - see server/src/erp/items.ts's getOtherBranchStock) as its id, namespaced the
  // same way catalogStore.ts's upsertErpItem would for a real scan - so "Check other branches"
  // queries the REAL backend for real data when it's reachable, exactly like a genuinely scanned
  // item would, rather than a fake demo-only button. If the ERP server isn't running, the dialog
  // degrades gracefully to its normal "can't check right now" state - see OtherBranchStockDialog.tsx.
  { id: 'erp-101682', barcode: '06285101000874', nameAr: 'سيفاكسون 1 جم وريد حقن', nameEn: 'CEFAXON 1000MG IV INJ VIAL', unit: 'BUTTL', category: 'XPH', basePrice: 48.05, vatRate: 0, requiresBatchTracking: true, reorderLevel: 0, dosageIds: ['dos-11'], nupcoCode: '6285101000874', wasfatyPrice: 46.0, wasfatyEligible: true },
];

// Starter dosage-instruction (DOS/SIG) library. One reusable row per real-world direction, shared by
// every product it suits - the same "1 tablet twice daily after food" is not retyped on each item.
// Codes are system-assigned (DOS-000001...) and stable, so they can be quoted on the printed sheet
// or used to check a direction without depending on its wording.
//
// The fields are structured (dose/route/frequency/timing/duration), and utils/dosages.ts builds the
// plain-language Arabic and English sentences from them at print time - no BID/TID/q.d. shorthand,
// which is the abbreviation class pharmacists and patient-safety bodies warn against.
//
// "Until finished" (no duration) is deliberate for chronic medicines; the duration is a course
// length, not a refill quantity.
export const seedDosages: DosageInstruction[] = [
  {
    id: 'dos-1', code: 'DOS-000001', doseAmount: '1', doseUnit: 'tablet', route: 'oral',
    frequency: 'twice_daily', timing: 'after_food', durationDays: 5,
    additionalInstructionsEn: 'Do not exceed 8 tablets in 24 hours.',
    additionalInstructionsAr: 'لا تتجاوز 8 حبات في 24 ساعة.',
    isActive: true,
  },
  {
    id: 'dos-2', code: 'DOS-000002', doseAmount: '1', doseUnit: 'tablet', route: 'oral',
    frequency: 'three_times_daily', timing: 'after_food', durationDays: 3,
    additionalInstructionsEn: 'Stop and see a doctor if the pain lasts more than 3 days.',
    additionalInstructionsAr: 'توقف وراجع الطبيب إذا استمر الألم أكثر من 3 أيام.',
    isActive: true,
  },
  {
    id: 'dos-3', code: 'DOS-000003', doseAmount: '5', doseUnit: 'ml', route: 'oral',
    frequency: 'three_times_daily', timing: 'none', durationDays: 7,
    additionalInstructionsEn: 'Shake the bottle well before each dose. Complete the full course.',
    additionalInstructionsAr: 'رجّ العبوة جيداً قبل كل جرعة. أكمل المدة كاملة.',
    isActive: true,
  },
  {
    id: 'dos-4', code: 'DOS-000004', doseAmount: '10', doseUnit: 'unit', route: 'injection',
    frequency: 'once_daily', timing: 'bedtime',
    additionalInstructionsEn: 'Rotate the injection site each time.',
    additionalInstructionsAr: 'غيّر موضع الحقن في كل مرة.',
    isActive: true,
  },
  {
    id: 'dos-5', code: 'DOS-000005', doseAmount: '1', doseUnit: 'capsule', route: 'oral',
    frequency: 'once_daily', timing: 'with_food',
    additionalInstructionsEn: 'Take with the largest meal of the day.',
    additionalInstructionsAr: 'تناولها مع الوجبة الرئيسية.',
    isActive: true,
  },
  {
    id: 'dos-6', code: 'DOS-000006', doseAmount: '1', doseUnit: 'capsule', route: 'oral',
    frequency: 'once_daily', timing: 'before_food', durationDays: 14,
    additionalInstructionsEn: 'Swallow whole with water; do not crush or chew.',
    additionalInstructionsAr: 'ابلعها كاملة مع الماء، ولا تسحقها أو تمضغها.',
    isActive: true,
  },
  {
    id: 'dos-7', code: 'DOS-000007', doseAmount: '1', doseUnit: 'capsule', route: 'oral',
    frequency: 'every_8_hours', timing: 'none',
    additionalInstructionsEn: 'Use only when needed for pain; do not exceed 3 capsules in 24 hours.',
    additionalInstructionsAr: 'استخدمها عند الحاجة للألم فقط، ولا تتجاوز 3 كبسولات في 24 ساعة.',
    isActive: true,
  },
  {
    id: 'dos-8', code: 'DOS-000008', doseAmount: '1', doseUnit: 'tablet', route: 'oral',
    frequency: 'once_daily', timing: 'bedtime', durationDays: 7,
    additionalInstructionsEn: 'Do not drive or operate machinery while taking this medicine.',
    additionalInstructionsAr: 'لا تقُد السيارة أو تشغّل الآلات أثناء تناول هذا الدواء.',
    isActive: true,
  },
  {
    id: 'dos-9', code: 'DOS-000009', doseAmount: '1', doseUnit: 'tablet', route: 'oral',
    frequency: 'twice_daily', timing: 'with_food', durationDays: 7,
    additionalInstructionsEn: 'Complete the full course even if you feel better.',
    additionalInstructionsAr: 'أكمل المدة كاملة حتى لو شعرت بالتحسن.',
    isActive: true,
  },
  {
    id: 'dos-10', code: 'DOS-000010', doseAmount: '1', doseUnit: 'application', route: 'topical',
    frequency: 'as_needed', timing: 'none',
    additionalInstructionsEn: 'Rub hands together until dry. For external use only.',
    additionalInstructionsAr: 'افرك اليدين حتى تجف. للاستخدام الخارجي فقط.',
    isActive: true,
  },
  {
    id: 'dos-11', code: 'DOS-000011', doseAmount: '1', doseUnit: 'vial', route: 'injection',
    frequency: 'once_daily', timing: 'none', durationDays: 5,
    additionalInstructionsEn: 'Give slowly into a vein as directed by the prescriber.',
    additionalInstructionsAr: 'يُعطى ببطء في الوريد حسب توجيه الطبيب.',
    isActive: true,
  },
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

// Demo vendor master for the Purchase Invoice page - fictional distributors in the shape of the
// real KSA pharma market (a national chain distributor, a regional one, a specialist importer),
// not any real company. Purchase invoices entered against these post stock through
// catalogStore's receiveStock exactly like the single-line Stock Receiving page does.
export const seedVendors: Vendor[] = [
  {
    id: 'ven-1', typeFlag: 1, vendorNo: 'VEN-000001', nameAr: 'شركة الحياة لتوزيع الأدوية', nameEn: 'Al-Hayat Drug Distribution Co.',
    phone: '0114445566', vatNumber: '310555123400003', category: 'National distributor',
    creditLimit: 50000, settlementDays: 30, vatType: 1, glnNo: '6281000010001',
    bonusDiscountSetNo: 2, limitationSetNo: 1, notes: 'Riyadh HQ · nationwide cold-chain delivery',
    isActive: true, updatedAt: '2026-10-01T09:00:00.000Z',
  },
  {
    id: 'ven-2', typeFlag: 1, vendorNo: 'VEN-000002', nameAr: 'مؤسسة جدة للامداد الطبي', nameEn: 'Jeddah Medical Supply Est.',
    phone: '0126667788', vatNumber: '312666987600003', category: 'Regional distributor',
    creditLimit: 25000, settlementDays: 45, vatType: 1, glnNo: '6281000020002',
    bonusDiscountSetNo: 1, limitationSetNo: 1, notes: 'Jeddah · western-region deliveries',
    isActive: true, updatedAt: '2026-10-05T10:30:00.000Z',
  },
  {
    id: 'ven-3', typeFlag: 1, vendorNo: 'VEN-000003', nameAr: 'مستوردات الرياض للسوبر فود', nameEn: 'Riyadh Superfood Imports',
    phone: '0117778899', vatNumber: '300777456700003', category: 'Importer',
    creditLimit: 15000, settlementDays: 30, vatType: 1, glnNo: '6281000030003',
    notes: 'Specialist food and consumer-goods importer',
    isActive: true, updatedAt: '2026-10-12T08:15:00.000Z',
  },
  // Customer accounts in the same FCODCSVN-style table (type_flag 2). These are vendor-like
  // business parties - clinics, hospitals and institutional buyers - NOT the POS retail patients
  // (those live in customerStore and never appear in a purchase invoice).
  {
    id: 'pcu-1', typeFlag: 2, vendorNo: 'CUS-000001', nameAr: 'مركز النور الطبي', nameEn: 'Al-Noor Medical Center',
    phone: '0114567890', vatNumber: '311234567800003', category: 'Medical center',
    creditLimit: 20000, settlementDays: 30, vatType: 1,
    notes: 'Outpatient clinic - monthly institutional purchases',
    isActive: true, updatedAt: '2026-10-18T09:30:00.000Z',
  },
  {
    id: 'pcu-2', typeFlag: 2, vendorNo: 'CUS-000002', nameAr: 'مستشفى رعاية الرياض', nameEn: 'Riyadh Care Hospital',
    phone: '0112345678', vatNumber: '312345678900003', category: 'Hospital',
    creditLimit: 100000, settlementDays: 45, vatType: 1,
    notes: 'Hospital pharmacy account - purchase orders and batch deliveries',
    isActive: true, updatedAt: '2026-10-20T11:00:00.000Z',
  },
  {
    id: 'pcu-3', typeFlag: 2, vendorNo: 'CUS-000003', nameAr: 'مجمع دار الشفاء الطبي', nameEn: 'Dar Al-Shifa Polyclinic',
    phone: '0126789012', vatNumber: '313456789000003', category: 'Polyclinic',
    creditLimit: 30000, settlementDays: 30, vatType: 1,
    notes: 'Jeddah polyclinic - recurring supply account',
    isActive: true, updatedAt: '2026-10-24T13:45:00.000Z',
  },
];

// Manufacturer / company master ("بيانات الشركات الصانعة"). Numbers run 1, 2, 3... in the same
// system-assigned, gap-free style as the legacy company screen: the number is the key
// Item.manufacturerNo stores, so the Arabic/English names can be corrected later without touching a
// single item. The details block is the legacy "بيانات تفصيلية" free-text area (plant, licence,
// contact).
export const seedManufacturers: Manufacturer[] = [
  { id: 'mfr-1', companyNo: 1, nameAr: 'شركة تبوك للصناعات الدوائية', nameEn: 'Tabuk Pharmaceuticals', details: 'Tabuk plant · SFDA licence 1024 · 011 000 0001' },
  { id: 'mfr-2', companyNo: 2, nameAr: 'شركة جمجوم فارما', nameEn: 'Jamjoom Pharma', details: 'Jeddah plant · SFDA licence 1188 · 012 000 0002' },
  { id: 'mfr-3', companyNo: 3, nameAr: 'الشركة السعودية للصناعات الدوائية (سبيماكو)', nameEn: 'SPIMACO', details: 'Qassim plant · SFDA licence 1007 · 016 000 0003' },
  { id: 'mfr-4', companyNo: 4, nameAr: 'شركة الرياض فارما', nameEn: 'Riyadh Pharma', details: 'Riyadh plant · SFDA licence 1212 · 011 000 0004' },
  { id: 'mfr-5', companyNo: 5, nameAr: 'شركة سجا للصناعات الدوائية', nameEn: 'SAJA Pharmaceuticals', details: 'Jeddah plant · SFDA licence 1305 · 012 000 0005' },
];

// Demo cost-center tree for the expense accounting module (Phase A, see costcenter.md §7.4) -
// a fictional chain in the shape of the real KSA pharmacy market, mirroring the BR001-OPS catalog
// style from the ERP design doc (§1.2): head-office overhead pools, three pharmacy branches, and
// activity/service desks riding under their parent. Branches are the revenue-earning centers the
// register's sales are attributed to (settings.costCenterId defaults to the first one); overhead
// centers carry shared/allocatable expenses that a later allocation run (Phase D) will push out.
//
// This is an explicit parentId tree (each center points at its parent, undefined = root) rather
// than the legacy GLCOSTCNTR's positional 10-digit code hierarchy [verified in XPH: rows like
// 111200001 with COSTLEVEL/COSTMAIN] - the short `code` carries the accountant-familiar label,
// the tree does the structural work. `IsPostingAllowed` shadows the legacy master's own flag.
export const seedCostCenters: CostCenter[] = [
  {
    id: 'cc-hq',
    code: 'HQ',
    nameAr: 'المقر الرئيسي',
    nameEn: 'Head Office',
    parentId: undefined, // tree root
    kind: 'overhead',
    isActive: true,
    IsPostingAllowed: true, // shared costs are booked here first, then allocated out (Phase D)
    effectiveFrom: '2026-01-01',
  },
  {
    id: 'cc-hq-fac',
    code: 'HO-FIN',
    nameAr: 'المالية والإدارية - المقر الرئيسي',
    nameEn: 'Head Office Finance & Admin',
    parentId: 'cc-hq',
    kind: 'overhead',
    isActive: true,
    IsPostingAllowed: true,
    effectiveFrom: '2026-01-01',
  },
  {
    id: 'cc-hq-it',
    code: 'HO-IT',
    nameAr: 'خدمات تقنية المعلومات',
    nameEn: 'IT Services (Shared)',
    parentId: 'cc-hq',
    kind: 'overhead',
    isActive: true,
    IsPostingAllowed: true,
    effectiveFrom: '2026-01-01',
  },
  {
    id: 'cc-br-001',
    code: 'BR001-OPS',
    nameAr: 'فرع الرياض - عمليات الصيدلية',
    nameEn: 'Riyadh Branch - Pharmacy Operations',
    parentId: 'cc-hq',
    kind: 'branch',
    isActive: true,
    IsPostingAllowed: true,
    effectiveFrom: '2026-01-01',
  },
  {
    id: 'cc-br-001-ins',
    code: 'BR001-INS',
    nameAr: 'مكتب التأمين - فرع الرياض',
    nameEn: 'Riyadh Branch - Insurance Desk',
    parentId: 'cc-br-001',
    kind: 'activity',
    isActive: true,
    IsPostingAllowed: true,
    effectiveFrom: '2026-01-01',
  },
  {
    id: 'cc-br-002',
    code: 'BR002-OPS',
    nameAr: 'فرع جدة - عمليات الصيدلية',
    nameEn: 'Jeddah Branch - Pharmacy Operations',
    parentId: 'cc-hq',
    kind: 'branch',
    isActive: true,
    IsPostingAllowed: true,
    effectiveFrom: '2026-01-01',
  },
  {
    id: 'cc-br-003',
    code: 'BR003-OPS',
    nameAr: 'فرع الدمام - عمليات الصيدلية',
    nameEn: 'Dammam Branch - Pharmacy Operations',
    parentId: 'cc-hq',
    kind: 'branch',
    isActive: true,
    IsPostingAllowed: true,
    effectiveFrom: '2026-01-01',
  },
  {
    id: 'cc-br-002-del',
    code: 'BR002-DEL',
    nameAr: 'خدمة التوصيل - فرع جدة',
    nameEn: 'Jeddah Branch - Delivery Service',
    parentId: 'cc-br-002',
    kind: 'activity',
    isActive: true,
    IsPostingAllowed: true,
    effectiveFrom: '2026-01-01',
  },
  // A DECOMMISSIONED kiosk: kept in the master (never delete a center that has history - design
  // doc validation matrix) but inactive and out of its effective window, so expense-entry
  // validation refuses it while old reports keep its rows readable - the acceptance criterion
  // "deactivating a cost center does not remove historical reporting".
  {
    id: 'cc-br-001-kiosk',
    code: 'BR001-KIOSK',
    nameAr: 'كشك المطار - قيد الإغلاق',
    nameEn: 'Airport Terminal Kiosk (Closed)',
    parentId: 'cc-br-001',
    kind: 'branch',
    isActive: false,
    IsPostingAllowed: false,
    effectiveFrom: '2025-01-01',
    effectiveTo: '2026-06-30',
    notes: 'Kiosk closed 2026-06-30. Kept for historical expense reporting only.',
  },
];
