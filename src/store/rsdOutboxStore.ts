// The persisted RSD outbox: one row per physical unit that still has to be reported to SFDA.
//
// Why a queue at all: a POS cannot block a sale on a national reporting service. The sale is saved
// locally first (store/salesStore.ts), then this queue reports each serialised drug pack in the
// background. A network/5xx failure stays queued and is retried (App.tsx flushes every 60s); a
// business rejection (bad GTIN, unit not in RSD inventory, FC 21017 not authorised) is terminal and
// waits for a human instead of being resent forever.
//
// The server ledger is the authority on whether SFDA accepted a unit. This queue is the browser's
// view of the same facts, so a duplicate send is harmless: reportSale/reportCancel answer
// already_reported/already_cancelled and the row is marked sent.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { reopenRsdRecord, reportRsdCancel, reportRsdSale, RsdReportError } from '../api/rsdApi';
import type { SaleHeader } from '../types/sales';
import {
  buildCancelOutboxItems,
  buildSaleOutboxItems,
  rsdOutboxKey,
  type NewRsdOutboxItem,
  type RsdOutboxItem,
} from '../utils/rsdOutbox';

interface RsdOutboxState {
  queue: RsdOutboxItem[];
  isFlushing: boolean;
  lastFlushAt?: string;
  // Called once per saved sale, after the local record exists. Enqueues every reportable pack and
  // starts a background flush; it never throws and never delays checkout.
  enqueueSale: (invoice: SaleHeader) => void;
  // Called once per saved return. Only lines that are now FULLY returned are cancelled; a partial
  // return cannot identify which physical pack came back.
  enqueueReturn: (invoice: SaleHeader, returnedLineIds: string[], reason?: string) => void;
  flush: () => Promise<void>;
  // Operator action for a terminal rejection: reopen it on the server (the equivalent of the
  // trial's --retry-rejected) and send it again. Refuses nothing locally - the server will not
  // reopen a sale SFDA already accepted.
  retry: (id: string) => Promise<void>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function patchItem(
  set: (fn: (state: RsdOutboxState) => Partial<RsdOutboxState>) => void,
  id: string,
  patch: Partial<RsdOutboxItem>,
): void {
  set((state) => ({
    queue: state.queue.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  }));
}

// Adds only units that are not already queued for the same movement. Returns the original array
// when there is nothing new so the caller can skip a pointless state write.
function withNewItems(existing: RsdOutboxItem[], additions: NewRsdOutboxItem[]): RsdOutboxItem[] {
  const seen = new Set(existing.map(rsdOutboxKey));
  const at = nowIso();
  const fresh: RsdOutboxItem[] = [];
  for (const addition of additions) {
    const key = rsdOutboxKey(addition);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push({
      ...addition,
      id: crypto.randomUUID(),
      createdAt: at,
      updatedAt: at,
      status: 'pending',
      attempts: 0,
    });
  }
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}

function sameUnit(item: RsdOutboxItem, other: RsdOutboxItem): boolean {
  return item.unit.gtin === other.unit.gtin && item.unit.serialNo === other.unit.serialNo;
}

// A cancel is only valid after its sale was accepted by SFDA. That ordering is enforced by the
// server too; doing it here as well keeps the queue from spending round-trips on a cancel that
// cannot succeed yet, and gives the UI an honest "blocked" state when the sale itself failed.
function saleFor(queue: RsdOutboxItem[], cancel: RsdOutboxItem): RsdOutboxItem | undefined {
  return queue.find((item) => item.kind === 'sale' && sameUnit(item, cancel));
}

function isSaleBlockedCancel(item: RsdOutboxItem): boolean {
  return item.rc === 'sale_not_sent' || item.rc === 'sale_not_reported';
}

async function sendItem(
  item: RsdOutboxItem,
  patch: (id: string, patch: Partial<RsdOutboxItem>) => void,
): Promise<void> {
  const attempts = item.attempts + 1;
  try {
    // Prescription fields are deliberately not copied from the invoice: the verified production
    // envelope uses the server's Direct Sale defaults (TOGLN 0000000000000 / DIRECT-SALE) until
    // SFDA confirms how a prescription sale differs. The API already accepts them when it does.
    const result =
      item.kind === 'sale'
        ? await reportRsdSale({
            ...item.unit,
            invoiceId: item.invoiceId,
            invoiceNo: item.invoiceNo,
            saleLineId: item.saleLineId,
          })
        : await reportRsdCancel({
            ...item.unit,
            invoiceId: item.invoiceId,
            invoiceNo: item.invoiceNo,
            saleLineId: item.saleLineId,
            reason: item.reason,
          });

    if (
      result.outcome === 'sent' ||
      result.outcome === 'already_reported' ||
      result.outcome === 'already_cancelled'
    ) {
      patch(item.id, {
        status: 'sent',
        attempts,
        rc: result.record.rc,
        message: result.record.message,
        notificationId: result.record.notificationId,
        updatedAt: nowIso(),
      });
      return;
    }

    // HTTP 200 with a business answer. A retryable failure stays queued; a rejection is terminal
    // until an operator fixes the account/data and presses Retry.
    if (result.record.retryable) {
      patch(item.id, {
        attempts,
        rc: result.record.rc,
        message: result.message ?? result.record.message,
        updatedAt: nowIso(),
      });
      return;
    }
    patch(item.id, {
      status: 'rejected',
      attempts,
      rc: result.record.rc,
      message: result.message ?? result.record.message,
      updatedAt: nowIso(),
    });
  } catch (err) {
    if (err instanceof RsdReportError) {
      if (err.retryable) {
        patch(item.id, { attempts, message: err.message, updatedAt: nowIso() });
        return;
      }
      if (err.code === 'sale_not_sent' || err.code === 'sale_not_reported') {
        patch(item.id, {
          status: 'blocked',
          attempts,
          rc: err.code,
          message: err.message,
          updatedAt: nowIso(),
        });
        return;
      }
      patch(item.id, {
        status: 'rejected',
        attempts,
        rc: err.code,
        message: err.message,
        updatedAt: nowIso(),
      });
      return;
    }
    // Not an RSD answer at all (a bug, a browser fetch failure outside our wrapper). Keep the
    // report queued rather than silently losing a national movement.
    patch(item.id, {
      attempts,
      message: err instanceof Error ? err.message : String(err),
      updatedAt: nowIso(),
    });
  }
}

export const useRsdOutboxStore = create<RsdOutboxState>()(
  persist(
    (set, get) => ({
      queue: [],
      isFlushing: false,

      enqueueSale: (invoice) => {
        const next = withNewItems(get().queue, buildSaleOutboxItems(invoice));
        if (next === get().queue) return;
        set({ queue: next });
        void get().flush();
      },

      enqueueReturn: (invoice, returnedLineIds, reason) => {
        const next = withNewItems(
          get().queue,
          buildCancelOutboxItems(invoice, returnedLineIds, reason),
        );
        if (next === get().queue) return;
        set({ queue: next });
        void get().flush();
      },

      flush: async () => {
        if (get().isFlushing) return;
        if (!get().queue.some((item) => item.status === 'pending')) return;

        set({ isFlushing: true });
        try {
          // A cancel that was blocked because its sale had not been accepted becomes sendable
          // again once the operator retries the sale and SFDA accepts it.
          for (const item of get().queue) {
            if (item.kind !== 'cancel' || item.status !== 'blocked' || !isSaleBlockedCancel(item)) {
              continue;
            }
            const sale = saleFor(get().queue, item);
            if (sale?.status === 'sent') {
              patchItem(set, item.id, {
                status: 'pending',
                rc: undefined,
                message: undefined,
                updatedAt: nowIso(),
              });
            }
          }

          // Oldest first: a sale is enqueued before any cancel for the same unit, so this also
          // naturally sends the sale before its cancellation.
          for (const queued of [...get().queue]) {
            const item = get().queue.find((candidate) => candidate.id === queued.id);
            if (!item || item.status !== 'pending') continue;

            if (item.kind === 'cancel') {
              const sale = saleFor(get().queue, item);
              // Only wait when we actually know the sale is not accepted yet. With no sale row
              // (for example the browser queue was cleared, or this till did not record the sale)
              // the server ledger is the authority and will refuse a cancel with no accepted sale.
              if (sale && sale.status !== 'sent') {
                if (sale.status === 'rejected' || sale.status === 'blocked') {
                  patchItem(set, item.id, {
                    status: 'blocked',
                    rc: 'sale_not_sent',
                    message: 'The sale was not accepted by RSD, so its cancellation cannot be sent.',
                    updatedAt: nowIso(),
                  });
                }
                // Sale still queued: leave the cancel pending and try again on the next pass.
                continue;
              }
            }

            await sendItem(item, (id, patch) => patchItem(set, id, patch));
          }

          // A cancel can only go out after its sale is accepted. If that happened in THIS pass (a
          // retry of a rejected sale, or a return queued while the sale was still in flight), send
          // the cancel now instead of leaving it for the next 60-second tick. Cancels that the main
          // loop already handled are no longer pending, so this cannot double-send.
          for (const queued of [...get().queue]) {
            if (queued.kind !== 'cancel') continue;
            if (queued.status !== 'pending' && queued.status !== 'blocked') continue;
            if (queued.status === 'blocked' && !isSaleBlockedCancel(queued)) continue;
            const sale = saleFor(get().queue, queued);
            if (sale?.status !== 'sent') continue;

            if (queued.status === 'blocked') {
              patchItem(set, queued.id, {
                status: 'pending',
                rc: undefined,
                message: undefined,
                updatedAt: nowIso(),
              });
            }
            const current = get().queue.find((candidate) => candidate.id === queued.id);
            if (current?.status === 'pending') {
              await sendItem(current, (id, patch) => patchItem(set, id, patch));
            }
          }
        } finally {
          set({ isFlushing: false, lastFlushAt: nowIso() });
        }
      },

      retry: async (id) => {
        const item = get().queue.find((candidate) => candidate.id === id);
        if (!item) return;

        if (item.status === 'rejected') {
          try {
            await reopenRsdRecord(item.kind, item.unit.gtin, item.unit.serialNo);
          } catch (err) {
            patchItem(set, id, {
              message: err instanceof Error ? err.message : String(err),
              updatedAt: nowIso(),
            });
            return;
          }
        }

        patchItem(set, id, {
          status: 'pending',
          rc: undefined,
          message: undefined,
          updatedAt: nowIso(),
        });
        await get().flush();
      },
    }),
    {
      name: 'pharmacy-rsd-outbox',
      // Never persist the in-flight flag: a crash mid-flush must not leave the queue permanently
      // "busy" after the next reload.
      partialize: (state) => ({ queue: state.queue }),
    },
  ),
);
