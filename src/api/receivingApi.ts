// Best-effort backup of a receiving event (vendor or head-office) to this app's own database -
// mirrors backupSale/backupReturn's pattern in salesApi.ts. The browser's local catalogStore is
// always the primary record; a failure here is handled by the caller (queued for retry, see
// store/pendingSyncStore.ts), never blocking the receiving action itself.
const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';

export interface ReceivingBackupPayload {
  batchId: string;
  itemId: string;
  itemNameAr: string;
  itemNameEn: string;
  barcode?: string;
  unit?: string;
  category?: string;
  basePrice?: number;
  vatRate?: number;
  requiresBatchTracking?: boolean;
  reorderLevel?: number;
  batchNo: string;
  expiryDate: string;
  receivedDate: string;
  qty: number;
  purchasePrice: number;
  purchaseDiscountPercent: number;
  costPrice: number;
}

export async function backupReceiving(payload: ReceivingBackupPayload): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/receiving`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Receiving backup failed (${res.status})`);
  }
}
