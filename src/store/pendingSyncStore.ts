import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { backupSale, backupReturn, type ReturnBackupPayload } from '../api/salesApi';
import { backupReceiving, type ReceivingBackupPayload } from '../api/receivingApi';
import { createWasfatyDispense } from '../api/wasfatyApi';
import type { SaleHeader } from '../types/sales';
import type { WasfatyManualDispenseInput } from '../types/wasfaty';

// Every backup to this app's own database (sale, return, receiving) is best-effort by design - a
// POS action must never fail because that server/DB is unreachable. Without this queue, though,
// a failure there was final: the sale/return/receiving still happened locally, but the SQL mirror
// (batches.qtyOnHand especially) would silently and permanently drift from reality, exactly what
// happened to invoice SIM-000004's batch row before this existed. This queue is what turns "best
// effort, might get lost forever" into "best effort, but eventually consistent": a failed backup
// is queued here and retried on the next app load and periodically thereafter (see App.tsx), so a
// server that was simply down for a while catches back up on its own, with no manual SQL fix.
type PendingSyncItem =
  | { id: string; kind: 'sale'; payload: SaleHeader; createdAt: string; attempts: number }
  | { id: string; kind: 'return'; payload: ReturnBackupPayload; createdAt: string; attempts: number }
  | { id: string; kind: 'receiving'; payload: ReceivingBackupPayload; createdAt: string; attempts: number }
  // A Wasfaty dispense whose server mirror failed. The sale itself is already recorded locally;
  // this only re-sends the operational record so the claim/reporting side catches up.
  | {
      id: string;
      kind: 'wasfatyDispense';
      payload: { invoiceId: string; input: WasfatyManualDispenseInput };
      createdAt: string;
      attempts: number;
    };

type NewPendingSyncItem =
  | { kind: 'sale'; payload: SaleHeader }
  | { kind: 'return'; payload: ReturnBackupPayload }
  | { kind: 'receiving'; payload: ReceivingBackupPayload }
  | { kind: 'wasfatyDispense'; payload: { invoiceId: string; input: WasfatyManualDispenseInput } };

interface PendingSyncState {
  queue: PendingSyncItem[];
  isFlushing: boolean;
  enqueue: (item: NewPendingSyncItem) => void;
  flush: () => Promise<void>;
}

async function runOne(item: PendingSyncItem): Promise<void> {
  if (item.kind === 'sale') return backupSale(item.payload);
  if (item.kind === 'return') return backupReturn(item.payload);
  if (item.kind === 'receiving') return backupReceiving(item.payload);

  const result = await createWasfatyDispense(item.payload.input);
  // Dynamic import on purpose: salesStore imports this module to queue failures, so a static
  // import back would be a cycle. By the time a retry succeeds both modules are fully initialised.
  const { useSalesStore } = await import('./salesStore');
  useSalesStore.getState().patchInvoiceWasfaty(item.payload.invoiceId, {
    dispenseId: result.dispense.id,
    nupcoDispenseId: result.dispense.nupcoDispenseId,
    nupcoPrescriptionId: result.dispense.nupcoPrescriptionId,
    status: result.dispense.status,
    claimStatus: result.claim?.status,
    claimMonth: result.claim?.month,
    syncState: 'synced',
  });
}

export const usePendingSyncStore = create<PendingSyncState>()(
  persist(
    (set, get) => ({
      queue: [],
      isFlushing: false,

      enqueue: (item) =>
        set((s) => ({
          queue: [...s.queue, { ...item, id: crypto.randomUUID(), createdAt: new Date().toISOString(), attempts: 0 }],
        })),

      // Tries every queued item in order (oldest first, so a receiving backup retries before the
      // sale that depends on its batch existing). Each failure is left in the queue for the next
      // flush rather than retried in a tight loop here - a server that's down stays down for more
      // than one flush pass, so hammering it immediately buys nothing.
      flush: async () => {
        if (get().isFlushing || get().queue.length === 0) return;
        set({ isFlushing: true });
        try {
          for (const item of get().queue) {
            try {
              await runOne(item);
              set((s) => ({ queue: s.queue.filter((q) => q.id !== item.id) }));
            } catch {
              set((s) => ({
                queue: s.queue.map((q) => (q.id === item.id ? { ...q, attempts: q.attempts + 1 } : q)),
              }));
            }
          }
        } finally {
          set({ isFlushing: false });
        }
      },
    }),
    { name: 'pharmacy-pending-sync' }
  )
);
