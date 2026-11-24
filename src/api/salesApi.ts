// Best-effort backup of sales/returns to this app's own database (server/src/routes/sales.ts,
// server/prisma/schema.prisma) - see src/store/salesStore.ts for how this is called. The browser's
// local copy (zustand persist) is always the primary record; a failure here is swallowed by the
// caller, same "never block a sale" philosophy as ZATCA submission.
import type { SaleHeader, ReturnHeader } from '../types/sales';

const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';

export async function backupSale(invoice: SaleHeader): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(invoice),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Sale backup failed (${res.status})`);
  }
}

export interface ReturnBackupPayload {
  ret: ReturnHeader;
  updatedInvoiceStatus: SaleHeader['status'];
  updatedInvoicePointsEarnedClawedBack?: number;
  updatedInvoicePointsRedeemedRefunded?: number;
  updatedLineReturnedQtys: { lineId: string; returnedQty: number }[];
}

export async function backupReturn(payload: ReturnBackupPayload): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/sales/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: payload.ret.id,
      returnNo: payload.ret.returnNo,
      date: payload.ret.date,
      originalInvoiceId: payload.ret.originalInvoiceId,
      originalInvoiceNo: payload.ret.originalInvoiceNo,
      lines: payload.ret.lines.map((l) => ({
        saleLineId: l.saleLineId,
        itemNameEn: l.itemNameEn,
        qty: l.qty,
        refundAmount: l.refundAmount,
      })),
      totalRefund: payload.ret.totalRefund,
      reason: payload.ret.reason,
      updatedInvoiceStatus: payload.updatedInvoiceStatus,
      updatedInvoicePointsEarnedClawedBack: payload.updatedInvoicePointsEarnedClawedBack,
      updatedInvoicePointsRedeemedRefunded: payload.updatedInvoicePointsRedeemedRefunded,
      updatedLineReturnedQtys: payload.updatedLineReturnedQtys,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Return backup failed (${res.status})`);
  }
}
