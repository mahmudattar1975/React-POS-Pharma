// Reads real item master, batch/stock, and barcode data from XPH via the existing PharmaAxis .NET
// backend - see erp/README.md for the controller/route research this is built from, and for which
// FUNCTION_ID values are confirmed vs. guessed.
import { config } from '../config.js';
import { erpPost } from './erpClient.js';
import { getErpSession } from './erpAuth.js';
import { FUNCTION_ID_FCODCSVN } from './customers.js';

// Confirmed from the backend's own README_API.md changelog (FcodStockController entry, 2025-11-8):
// "Function_Id: 10210100 / Screen Name: Stock Data - بيانات المخزون". Confirmed LIVE against real
// XPH data (2026-09-29): returns real item and batch records with no 403, for both FcodStock and
// FqtyItem (see erp/README.md) - so despite the guess below, this value does work for both.
const FUNCTION_ID_FCODSTOCK = '10210100';
// NOT independently confirmed in the backend's changelog - FqtyItemController's own entries list
// "Function_Id: 000000000" (a not-yet-assigned placeholder) and FcodStockBarcode has no changelog
// entry at all. Reusing FcodStock's id worked live for FqtyItem (see above); FcodStockBarcode
// hasn't been exercised live yet - a 403 there specifically would mean this guess doesn't extend
// to it.
const FUNCTION_ID_FQTYITEM = '10210100';
const FUNCTION_ID_BARCODE = '10210100';

export interface ErpItem {
  itemNo: number;
  nameAr: string;
  nameEn: string;
  unit: string;
  vatRate: number; // fraction, e.g. 0.15 or 0 - VAT_PERCENT is stored this way already in XPH
  requiresBatchTracking: boolean;
  barcode: string; // GTIN_NO - confirmed (user-reported) as the real scannable barcode field
}

export interface ErpBatch {
  itemNo: number;
  batchNo: string;
  expiryDate: string; // ISO yyyy-mm-dd
  qtyOnHand: number;
  salePrice: number; // VAT-exclusive unit price, as stored
}

// Raw shapes as the ERP actually returns them - deliberately loose (fields beyond what's mapped
// below are ignored, not typed) since these records carry dozens of unrelated aggregate/audit
// fields (see erp/README.md) that this app has no use for and shouldn't pass through to the
// frontend.
interface RawItem {
  item_no: number;
  item_name_a?: string | null;
  item_name_e?: string | null;
  unit_type_name_e?: string | null;
  vat_percent?: number | null;
  tracking_flag?: number | null;
  gtin_no?: string | null;
}

interface RawBatch {
  item_no: number;
  factory_order_no?: string | null;
  expiray_date?: string | null; // sic - matches the actual DB/model spelling, not a typo to fix
  cur_total_qty?: number | null;
  sale_price?: number | null;
}

interface RawBarcodeRow {
  item_no: number;
}

function trimmed(s: string | null | undefined): string {
  return (s ?? '').trim();
}

function mapItem(r: RawItem): ErpItem {
  return {
    itemNo: r.item_no,
    nameAr: trimmed(r.item_name_a),
    nameEn: trimmed(r.item_name_e),
    unit: trimmed(r.unit_type_name_e),
    // Confirmed live (2026-09-29, item 101295 "BEPANTHEN..."): VAT_PERCENT is already stored as a
    // fraction (0.15), not a whole-number percentage (15) - dividing by 100 here silently turned
    // every taxable item's VAT into ~0.15% instead of 15%, which is indistinguishable from
    // zero-rated once rounded for display. No division needed; use the column as-is.
    vatRate: r.vat_percent ?? 0,
    requiresBatchTracking: r.tracking_flag === 1,
    barcode: trimmed(r.gtin_no),
  };
}

function mapBatch(r: RawBatch): ErpBatch {
  return {
    itemNo: r.item_no,
    batchNo: trimmed(r.factory_order_no),
    expiryDate: (r.expiray_date ?? '').slice(0, 10),
    qtyOnHand: r.cur_total_qty ?? 0,
    salePrice: r.sale_price ?? 0,
  };
}

// fappl_type/fappl_sub go in every request BODY's key (the backend filters on them there, not
// just off the headers) - taken from the live session, not hardcoded.
async function baseKey() {
  const session = await getErpSession();
  return { fappl_type: session.fapplType, fappl_sub: session.fapplSub };
}

// GTIN_NO on FcodStock itself IS the real scannable barcode (confirmed live - 166 of a 300-item
// sample had one populated; the earlier claim that it was "not the barcode" was drawn from an
// unlucky small sample that happened to all be blank). FcodStock/SearchData's `search` param
// doesn't match gtin_no (confirmed empty result live), but the generic `fieldname`/`fieldvalue`
// exact-match filter does - one call, returns the full item directly, no second round-trip.
export async function findItemByGtin(barcode: string): Promise<ErpItem | null> {
  const res = await erpPost<RawItem>('/api/user/FcodStock/SearchData', FUNCTION_ID_FCODSTOCK, {
    key: { ...(await baseKey()), fstore_no: config.erp.storeNo, item_no: 0, guserid: 0 },
    filter: { fieldname: 'gtin_no', fieldvalue: barcode, page: 1, limit: 1 },
  });
  const raw = res.datac?.[0];
  return raw ? mapItem(raw) : null;
}

// Fallback barcode path via the separate FcodStockBarcode table (a one-item-to-many-barcodes
// table distinct from FcodStock.GTIN_NO) - kept in case an item's scannable code lives there
// instead of/in addition to GTIN_NO. FUNCTION_ID for this one specifically is still unconfirmed
// (see erp/README.md).
export async function findItemNoByBarcode(barcode: string): Promise<number | null> {
  const res = await erpPost<RawBarcodeRow>('/api/user/FcodStockBarcode/SearchData', FUNCTION_ID_BARCODE, {
    key: { ...(await baseKey()), fstore_no: config.erp.storeNo, item_no: 0, barcode_seq: 0, item_barcode: barcode },
    filter: { page: 1, limit: 1 },
  });
  return res.datac?.[0]?.item_no ?? null;
}

export async function getItemMaster(itemNo: number): Promise<ErpItem | null> {
  const res = await erpPost<RawItem>('/api/user/FcodStock/GetRecordByID', FUNCTION_ID_FCODSTOCK, {
    ...(await baseKey()),
    fstore_no: config.erp.storeNo,
    item_no: itemNo,
    guserid: 0,
  });
  const raw = res.datac?.[0];
  return raw ? mapItem(raw) : null;
}

export interface ItemSearchResult {
  items: ErpItem[];
  // True only when the raw page came back completely full (== SEARCH_LIMIT), meaning there could
  // be more matches beyond what was fetched. NOT derived from XPH's own `totalSize` field - that
  // count is taken pre-dedup (see below), so on a search with duplicate rows it's routinely larger
  // than `items.length` even when every real match was already returned in one page. Comparing
  // totalSize to the deduped count directly (an earlier version of this function did) produces
  // exactly that false positive - confirmed live: "PANADOL" reports totalSize 30 but dedupes to 14
  // real items, all of which were already fully fetched in the one page.
  truncated: boolean;
}

// FcodStock/SearchData's own `search` param LIKE-matches item_no, item_name_a, and item_name_e
// (confirmed via erp/README.md's research) - so number/English/Arabic search all already work
// through the one call below. Barcode goes through GTIN_NO first (one call, see
// findItemByGtin above); if that misses, FcodStockBarcode is tried as a fallback.
//
// The point of this search is to let a cashier browse every product line matching a word and pick
// the right one themselves (e.g. "PANADOL" -> all 10+ real Panadol variants), not to show a
// truncated top-N - a limit of 20 was silently hiding real results (confirmed live: "PANADOL" has
// 30 matches in XPH). Raised well above realistic single-product-line result counts, but still
// capped - a generic word like "قرص" ("tablet") matches 3000+ rows, and no cashier is browsing
// that as a flat list; `totalMatches` tells the caller when results were actually truncated so it
// can say so, rather than silently showing a partial list as if it were complete.
const SEARCH_LIMIT = 100;

// GTIN_NO first (one call, most items), FcodStockBarcode as a fallback (a second round-trip, for
// whatever fraction of items don't have GTIN_NO set) - shared by searchItems() (the browse UI) and
// getItemAndBatchesByBarcode() (the actual POS scan field), so both resolve a scanned code the
// same way instead of the POS scan silently using a narrower/staler path.
export async function resolveItemByBarcode(barcode: string): Promise<ErpItem | null> {
  const gtinMatch = await findItemByGtin(barcode);
  if (gtinMatch) return gtinMatch;

  const barcodeItemNo = await findItemNoByBarcode(barcode);
  if (barcodeItemNo !== null) return getItemMaster(barcodeItemNo);

  return null;
}

export interface ItemAndBatches {
  item: ErpItem;
  batches: ErpBatch[];
}

// What the POS's own scan field calls directly - one round-trip (well, two-ish) from "barcode
// string" to "item + sellable batches", ready to add to a cart line.
export async function getItemAndBatchesByBarcode(barcode: string): Promise<ItemAndBatches | null> {
  const item = await resolveItemByBarcode(barcode);
  if (!item) return null;
  const batches = await getSellableBatches(item.itemNo);
  return { item, batches };
}

// A barcode is unique by definition - scanning one should resolve to exactly one item, not drop
// it into a browse-and-pick list alongside unrelated name matches. So barcode lookup is checked
// FIRST and, on a hit, short-circuits with just that single item - the name/number search below
// (which is for browsing - multiple real products can share a word like "PANADOL") never even
// runs in that case. This matches how a cashier actually uses each input: a scanner gun fires a
// barcode and expects one exact product; typing a word is for finding one among several variants.
// `page` defaults to 1 (every existing caller's behavior, unchanged) - exposed as a parameter only
// so prisma/seed.ts can page through the real catalog (an empty query + increasing page) to copy a
// test batch of real items into PharmaDB, without needing a second, duplicate paging code path.
export async function searchItems(query: string, page = 1): Promise<ItemSearchResult> {
  const trimmedQuery = query.trim();

  if (trimmedQuery && page === 1) {
    const barcodeMatch = await resolveItemByBarcode(trimmedQuery);
    if (barcodeMatch) return { items: [barcodeMatch], truncated: false };
  }

  // No exact barcode match (or an empty query) - fall back to the browse-by-name/number search.
  const nameSearch = await erpPost<RawItem>('/api/user/FcodStock/SearchData', FUNCTION_ID_FCODSTOCK, {
    key: { ...(await baseKey()), fstore_no: config.erp.storeNo, item_no: 0, guserid: 0 },
    filter: { search: query, page, limit: SEARCH_LIMIT, orderby: 'item_no', ordertype: 'asc' },
  });

  // Confirmed live (2026-09-29): FcodStock/SearchData returns the same item_no multiple times in
  // a row (3x observed) - looks like a join fanning out server-side (unit/corp/store lookups?)
  // rather than genuinely distinct records, since every field on the duplicates was identical.
  // Deduped here rather than chasing the server-side cause, which is outside this app.
  const rawRows = nameSearch.datac ?? [];
  const seen = new Set<number>();
  const items = rawRows.map(mapItem).filter((it) => (seen.has(it.itemNo) ? false : (seen.add(it.itemNo), true)));

  // Truncation is about whether the raw page was completely full, NOT about comparing XPH's
  // totalSize to the deduped count - that comparison is unreliable because of the duplication
  // above (totalSize is pre-dedup, so it's routinely larger than items.length even when every
  // real match was already returned in this one page - confirmed live: "PANADOL" reports
  // totalSize 30 but dedupes to 14 real items, none of them actually cut off).
  const truncated = rawRows.length >= SEARCH_LIMIT;

  return { items, truncated };
}

// Batches with stock, soonest-expiry first (FEFO) - the backend has no built-in "qty > 0 and not
// expired" filter (confirmed via erp/README.md's research), so that's applied here client-side.
export async function getSellableBatches(itemNo: number): Promise<ErpBatch[]> {
  const res = await erpPost<RawBatch>('/api/user/FqtyItem/SearchData', FUNCTION_ID_FQTYITEM, {
    key: { ...(await baseKey()), fstore_no: config.erp.storeNo, cust_type: 0, cust_no: 0, trans_type: 0, invoice_no: 0, invoice_seq: 0, item_no: itemNo },
    filter: { page: 1, limit: 200 },
  });
  return (res.datac ?? [])
    .filter((b) => (b.cur_total_qty ?? 0) > 0)
    .map(mapBatch)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
}

// --- Cross-store stock lookup ("this store is out, does another store or the main warehouse
// have it?") ---
//
// CONFIRMED LIVE (2026-09-30) against the real backend, including one wrong assumption caught and
// fixed by actually testing rather than trusting the source-reading research this was first built
// from:
//   1. Stores are Fcodcsvn rows with cust_type=35 - cust_no is the store number (matches
//      FqtyItem.fstore_no elsewhere), cust_name_a/e is the store's display name. Confirmed live:
//      this deployment has exactly two, cust_no=1 "Main Store" (المستودع الرئيسي, cust_main=1 -
//      the main warehouse/head office store) and cust_no=2 "EXP STORE" (مستودع الاكسبير, an
//      expired-goods store, not a sales branch).
//   2. FqtyItem/SearchData with fstore_no=0 DOES return batch rows for every store under the
//      *same* fappl_sub, each row carrying its own fstore_no - confirmed live for a real item
//      (101682): one row came back with fstore_no=1 and cur_total_qty=4500, matching what
//      getSellableBatches already shows for the current store.
//   3. WRONG ASSUMPTION, corrected by live testing: overriding fappl_sub to 0 in the request body
//      does NOT mean "every branch" - it returned zero rows for both Fcodcsvn and FqtyItem, live,
//      even for data confirmed to exist under fappl_sub=1. Sending the session's own fappl_sub
//      (never 0) is what actually works - this integration has no working way to reach a
//      genuinely different branch/company, only other STORES within this one. In practice that's
//      exactly what "check the main warehouse or another store" means for a single-branch
//      pharmacy deployment like this one, which is what real "other branch" questions turn out to
//      mean here.
const CUST_TYPE_STORE = 35;

interface RawStore {
  cust_no: number;
  cust_name_a?: string | null;
  cust_name_e?: string | null;
}

interface RawBranchQty {
  item_no: number;
  fstore_no?: number | null;
  cur_total_qty?: number | null;
}

export interface BranchStock {
  storeNo: number;
  storeNameAr: string;
  storeNameEn: string;
  qtyOnHand: number;
}

async function listStores(): Promise<Map<number, { nameAr: string; nameEn: string }>> {
  const res = await erpPost<RawStore>('/api/user/Fcodcsvn/SearchData', FUNCTION_ID_FCODCSVN, {
    key: { ...(await baseKey()), cust_type: CUST_TYPE_STORE, cust_no: 0, cust_main: 0 },
    filter: { page: 1, limit: 200, orderby: 'cust_no', ordertype: 'asc' },
  });
  const map = new Map<number, { nameAr: string; nameEn: string }>();
  for (const r of res.datac ?? []) {
    map.set(r.cust_no, { nameAr: trimmed(r.cust_name_a), nameEn: trimmed(r.cust_name_e) });
  }
  return map;
}

// Stock at every OTHER store for this item, highest quantity first. Excludes this app's own store
// (config.erp.storeNo) - the POS already knows that store's live stock via getSellableBatches,
// and the whole point of this lookup is "where else". Requires ERP_STORE_NO to actually be set to
// this device's real store number for that exclusion to do anything - confirmed on this dev
// machine it's left at the placeholder 0, which never matches a real store, so nothing gets
// excluded here today. Not this feature's bug to fix; flagged so it isn't mistaken for one.
export async function getOtherBranchStock(itemNo: number): Promise<BranchStock[]> {
  const [stockRes, stores] = await Promise.all([
    erpPost<RawBranchQty>('/api/user/FqtyItem/SearchData', FUNCTION_ID_FQTYITEM, {
      key: {
        ...(await baseKey()),
        fstore_no: 0, // every store under this branch - confirmed live, see comment above
        cust_type: 0,
        cust_no: 0,
        trans_type: 0,
        invoice_no: 0,
        invoice_seq: 0,
        item_no: itemNo,
      },
      filter: { page: 1, limit: 500 },
    }),
    listStores(),
  ]);

  const totalsByStore = new Map<number, number>();
  for (const row of stockRes.datac ?? []) {
    const storeNo = row.fstore_no ?? 0;
    const qty = row.cur_total_qty ?? 0;
    if (storeNo <= 0 || storeNo === config.erp.storeNo || qty <= 0) continue;
    totalsByStore.set(storeNo, (totalsByStore.get(storeNo) ?? 0) + qty);
  }

  return Array.from(totalsByStore.entries())
    .map(([storeNo, qtyOnHand]) => {
      const store = stores.get(storeNo);
      return {
        storeNo,
        storeNameAr: store?.nameAr ?? '',
        storeNameEn: store?.nameEn || `Store ${storeNo}`,
        qtyOnHand,
      };
    })
    .sort((a, b) => b.qtyOnHand - a.qtyOnHand);
}
