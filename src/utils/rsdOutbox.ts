// The local RSD outbox: which physical units still have to be reported to SFDA, and how that went.
//
// The POS is local-first, so a sale is finished the moment it is saved. RSD is a second, remote
// system that can be down, slow, or reject the account (FC 21017). This module is the pure part of
// the queue - building the work items, de-duplicating them, and summarising an invoice - while
// store/rsdOutboxStore.ts owns the persisted state and the sending.
//
// Two rules shape everything here:
//   * RSD reports DRUGS only: a line is reportable only when Item Master had "Batch / expiry
//     tracking" on at sale time (SaleLine.requiresBatchTracking), and it must carry captured
//     serials. utils/rsdUnits.ts is the single gate for that.
//   * A unit is identified by GTIN + serial, never by invoice line, so the same pack can never be
//     queued twice - not by a double click, not by a retry, not by a re-import.
import type { RsdUnit } from '../types/rsd';
import type { SaleHeader } from '../types/sales';
import { rsdUnitsForLine } from './rsdUnits';

export type RsdOutboxKind = 'sale' | 'cancel';

// 'pending'  - waiting to be sent (or waiting for a retryable failure to clear)
// 'sent'     - SFDA accepted it (RC 00000, or the ledger already had it)
// 'rejected' - SFDA answered with a business rejection; never retried automatically
// 'blocked'  - a cancel whose sale was never accepted, so it cannot be sent at all
export type RsdOutboxStatus = 'pending' | 'sent' | 'rejected' | 'blocked';

export interface NewRsdOutboxItem {
  kind: RsdOutboxKind;
  unit: RsdUnit;
  invoiceId: string;
  invoiceNo: string;
  saleLineId: string;
  reason?: string;
}

export interface RsdOutboxItem extends NewRsdOutboxItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: RsdOutboxStatus;
  attempts: number;
  rc?: string;
  message?: string;
  notificationId?: string;
}

// The identity SFDA itself uses: one sale and one cancel per physical unit, ever.
export function rsdOutboxKey(item: Pick<NewRsdOutboxItem, 'kind' | 'unit'>): string {
  return `${item.kind}:${item.unit.gtin}:${item.unit.serialNo}`;
}

// One sold invoice -> one report per serialised drug pack. Lines that are not drugs, or that have
// no captured serial/expiry, produce nothing (see utils/rsdUnits.ts for why).
export function buildSaleOutboxItems(invoice: SaleHeader): NewRsdOutboxItem[] {
  return invoice.lines.flatMap((line) =>
    rsdUnitsForLine(line).map((unit) => ({
      kind: 'sale' as const,
      unit,
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      saleLineId: line.id,
    })),
  );
}

// A full return of a line is the cancellation (decided in .mdfile/rsd.md): RSD has no partial-pack
// concept, and the return screen counts quantities, not serials, so a partial return cannot name
// the physical pack to cancel. `returnedLineIds` is what THIS return touched; the line must now be
// fully returned before its units are cancelled.
export function buildCancelOutboxItems(
  invoice: SaleHeader,
  returnedLineIds: Iterable<string>,
  reason?: string,
): NewRsdOutboxItem[] {
  const touched = new Set(returnedLineIds);
  return invoice.lines
    .filter((line) => touched.has(line.id) && line.qty > 0 && line.returnedQty >= line.qty)
    .flatMap((line) =>
      rsdUnitsForLine(line).map((unit) => ({
        kind: 'cancel' as const,
        unit,
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        saleLineId: line.id,
        reason,
      })),
    );
}

export type RsdInvoiceState = 'none' | 'sent' | 'queued' | 'rejected';

export interface RsdInvoiceSummary {
  total: number;
  sent: number;
  pending: number;
  rejected: number; // rejected + blocked: both need a human
  state: RsdInvoiceState;
}

export function rsdInvoiceSummary(items: RsdOutboxItem[]): RsdInvoiceSummary {
  let sent = 0;
  let pending = 0;
  let rejected = 0;
  for (const item of items) {
    if (item.status === 'sent') sent += 1;
    else if (item.status === 'pending') pending += 1;
    else rejected += 1;
  }
  const total = items.length;
  const state: RsdInvoiceState =
    total === 0 ? 'none' : rejected > 0 ? 'rejected' : pending > 0 ? 'queued' : 'sent';
  return { total, sent, pending, rejected, state };
}

export interface RsdQueueSummary {
  total: number;
  pending: number;
  sent: number;
  rejected: number;
  blocked: number;
}

export function rsdQueueSummary(items: RsdOutboxItem[]): RsdQueueSummary {
  const summary: RsdQueueSummary = { total: items.length, pending: 0, sent: 0, rejected: 0, blocked: 0 };
  for (const item of items) {
    if (item.status === 'pending') summary.pending += 1;
    else if (item.status === 'sent') summary.sent += 1;
    else if (item.status === 'blocked') summary.blocked += 1;
    else summary.rejected += 1;
  }
  return summary;
}
