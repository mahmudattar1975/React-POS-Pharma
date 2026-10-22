// Run via `npx prisma db seed` (configured in package.json's "prisma.seed"). Builds a TEST catalog
// in PharmaDB - see prisma/schema.prisma's comment on Item/Batch/Offer for why this exists: so the
// app can be exercised against real-shaped data without needing a live ERP connection every time.
// Idempotent (every write is an upsert keyed by a deterministic id) - safe to re-run.
import { prisma } from '../src/db/prisma.js';
import { searchItems, getSellableBatches, type ErpItem } from '../src/erp/items.js';
import { seedItems, seedBatches, seedOffers } from '../../src/utils/seedData.js';

// A test batch, not "everything" - the real catalog is large (a generic search term alone matched
// 3000+ rows live, per erp/README.md), and this is for exercising the app realistically, not
// mirroring the full production catalog.
const REAL_ITEM_TARGET = 200;

async function seedFictionalCatalog() {
  for (const item of seedItems) {
    const data = {
      barcode: item.barcode,
      nameAr: item.nameAr,
      nameEn: item.nameEn,
      unit: item.unit,
      category: item.category,
      basePrice: item.basePrice,
      controlledStatus: item.controlledStatus,
      vatRate: item.vatRate,
      requiresBatchTracking: item.requiresBatchTracking,
      reorderLevel: item.reorderLevel,
    };
    await prisma.item.upsert({ where: { id: item.id }, create: { id: item.id, ...data }, update: data });
  }
  console.log(`Upserted ${seedItems.length} fictional items.`);

  for (const batch of seedBatches) {
    const data = {
      itemId: batch.itemId,
      batchNo: batch.batchNo,
      expiryDate: new Date(batch.expiryDate),
      receivedDate: new Date(batch.receivedDate),
      qtyOnHand: batch.qtyOnHand,
      purchasePrice: batch.purchasePrice,
      purchaseDiscountPercent: batch.purchaseDiscountPercent,
      costPrice: batch.costPrice,
      gtin: batch.gtin,
      salePriceOverride: batch.salePriceOverride,
    };
    await prisma.batch.upsert({ where: { id: batch.id }, create: { id: batch.id, ...data }, update: data });
  }
  console.log(`Upserted ${seedBatches.length} fictional batches.`);

  for (const offer of seedOffers) {
    const data = {
      itemId: offer.itemId,
      type: offer.type,
      percent: offer.percent,
      value: offer.value,
      buyQty: offer.buyQty,
      freeQty: offer.freeQty,
      activeFrom: new Date(offer.activeFrom),
      activeTo: new Date(offer.activeTo),
      label: offer.label,
    };
    await prisma.offer.upsert({ where: { id: offer.id }, create: { id: offer.id, ...data }, update: data });
  }
  console.log(`Upserted ${seedOffers.length} fictional offers (no real source for these in XPH).`);
}

async function importRealItemsFromXph(targetCount: number) {
  const byItemNo = new Map<number, ErpItem>();
  let page = 1;
  // searchItems('') browses by item_no ascending (see erp/items.ts) - paginated here since it
  // normally returns one page per call. Stops as soon as we have enough, or XPH runs out of rows.
  while (byItemNo.size < targetCount) {
    const { items, truncated } = await searchItems('', page);
    if (items.length === 0) break;
    for (const item of items) byItemNo.set(item.itemNo, item);
    if (!truncated) break;
    page += 1;
  }

  const items = Array.from(byItemNo.values()).slice(0, targetCount);
  console.log(`Fetched ${items.length} real items from XPH across ${page} page(s). Importing...`);

  let itemCount = 0;
  let batchCount = 0;
  for (const item of items) {
    // An item with no barcode (unpopulated GTIN_NO - see erp/README.md, ~45% of a sampled 300) can
    // never be scanned by the POS anyway, and `barcode` is @unique here - skip rather than risk a
    // collision from multiple blank barcodes.
    if (!item.barcode) continue;

    const id = `erp-${item.itemNo}`;
    try {
      await prisma.item.upsert({
        where: { id },
        create: {
          id,
          barcode: item.barcode,
          nameAr: item.nameAr,
          nameEn: item.nameEn,
          unit: item.unit,
          category: 'XPH',
          basePrice: 0, // real pricing is per-batch (salePriceOverride below), not per-item - see catalog.ts's Batch comment
          vatRate: item.vatRate,
          requiresBatchTracking: item.requiresBatchTracking,
          reorderLevel: 0,
        },
        update: {
          barcode: item.barcode,
          nameAr: item.nameAr,
          nameEn: item.nameEn,
          unit: item.unit,
          vatRate: item.vatRate,
          requiresBatchTracking: item.requiresBatchTracking,
        },
      });
      itemCount += 1;

      const batches = await getSellableBatches(item.itemNo);
      for (const batch of batches) {
        const batchId = `erp-batch-${item.itemNo}-${batch.batchNo}`;
        await prisma.batch.upsert({
          where: { id: batchId },
          create: {
            id: batchId,
            itemId: id,
            batchNo: batch.batchNo,
            expiryDate: new Date(batch.expiryDate),
            receivedDate: new Date(), // FqtyItem doesn't expose a received date - see erp/items.ts's ErpBatch
            qtyOnHand: batch.qtyOnHand,
            purchasePrice: 0, // not exposed read-only either - see Receiving's own purchasePrice/discount entry for real batches
            purchaseDiscountPercent: 0,
            costPrice: 0,
            salePriceOverride: batch.salePrice,
          },
          update: { qtyOnHand: batch.qtyOnHand, salePriceOverride: batch.salePrice },
        });
        batchCount += 1;
      }
    } catch (err) {
      // One bad row (e.g. a genuine duplicate barcode in real data) shouldn't abort importing the
      // other ~199 items - same "don't let one failure block everything else" principle used
      // throughout this app's ERP fallbacks.
      console.warn(`Skipped item ${item.itemNo} (${item.nameEn}):`, err instanceof Error ? err.message : err);
    }
    if (itemCount % 20 === 0) console.log(`  ...${itemCount}/${items.length} real items imported so far`);
  }
  console.log(`Upserted ${itemCount} real items and ${batchCount} real batches from XPH.`);
}

async function main() {
  await seedFictionalCatalog();
  await importRealItemsFromXph(REAL_ITEM_TARGET);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
