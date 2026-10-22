// Talks to this app's own server (server/src/routes/erp.ts), which reads real item/batch/customer
// data from XPH via the existing PharmaAxis .NET backend. Read-only - see server/src/erp/README.md.
const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';

export interface ErpStatus {
  connected: boolean;
  userId?: number;
  error?: string;
}

export interface ErpItem {
  itemNo: number;
  nameAr: string;
  nameEn: string;
  unit: string;
  vatRate: number;
  requiresBatchTracking: boolean;
  barcode: string;
}

export interface ErpBatch {
  itemNo: number;
  batchNo: string;
  expiryDate: string;
  qtyOnHand: number;
  salePrice: number;
}

export interface ErpCustomer {
  custNo: number;
  nameAr: string;
  nameEn: string;
  vatFileNo: string;
  isLocked: boolean;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `ERP request ${path} failed (${res.status})`);
  return body as T;
}

export function getErpStatus(): Promise<ErpStatus> {
  return get('/api/erp/status');
}

// This pharmacy's own real XPH store number, or 0 if not yet configured (see .env.example's
// ERP_STORE_NO) - used to validate a multi-branch Head Office transfer file before import, see
// HeadOfficeReceivingPage.tsx.
export function getErpStoreNo(): Promise<{ storeNo: number }> {
  return get('/api/erp/store-no');
}

export interface ItemSearchResult {
  items: ErpItem[];
  truncated: boolean; // true only if there may be more matches beyond what's in `items`
}

export function searchErpItems(query: string): Promise<ItemSearchResult> {
  return get(`/api/erp/items/search?q=${encodeURIComponent(query)}`);
}

export function getErpItemBatches(itemNo: number): Promise<ErpBatch[]> {
  return get(`/api/erp/items/${itemNo}/batches`);
}

export interface ItemAndBatches {
  item: ErpItem;
  batches: ErpBatch[];
}

// A 404 here just means "not an ERP item" (e.g. it's in the local seed catalog instead, or isn't
// a real barcode at all) - a normal, expected outcome for a scan attempt, not a failure - so this
// returns null rather than throwing the way `get()` does for every other non-OK response. Anything
// else not-OK (the server unreachable, a real backend error) still throws, same as everywhere else.
export async function getErpItemByBarcode(barcode: string): Promise<ItemAndBatches | null> {
  const res = await fetch(`${BASE_URL}/api/erp/items/by-barcode/${encodeURIComponent(barcode)}`);
  if (res.status === 404) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `ERP barcode lookup failed (${res.status})`);
  return body as ItemAndBatches;
}

export function searchErpCustomers(query: string): Promise<ErpCustomer[]> {
  return get(`/api/erp/customers/search?q=${encodeURIComponent(query)}`);
}

export interface BranchStock {
  storeNo: number;
  storeNameAr: string;
  storeNameEn: string;
  qtyOnHand: number;
}

// Not confirmed working against the real ERP backend yet (built from reading its source, not
// live-tested - see server/src/erp/items.ts's getOtherBranchStock comment). A failure here means
// "can't answer that right now", not a sale-blocking error - callers should treat it as optional
// info, same as every other ERP fallback in this app.
export function getOtherBranchStock(itemNo: number): Promise<BranchStock[]> {
  return get(`/api/erp/items/${itemNo}/other-branches`);
}
