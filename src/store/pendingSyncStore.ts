import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { backupSale, backupReturn, type ReturnBackupPayload } from '../api/salesApi';
import { backupReceiving, type ReceivingBackupPayload } from '../api/receivingApi';
import type { SaleHeader } from '../types/sales';

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
  | { id: string; kind: 'receiving'; payload: ReceivingBackupPayload; createdAt: string; attempts: number };

type NewPendingSyncItem =
  | { kind: 'sale'; payload: SaleHeader }
  | { kind: 'return'; payload: ReturnBackupPayload }
  | { kind: 'receiving'; payload: ReceivingBackupPayload };

interface PendingSyncState {
  queue: PendingSyncItem[];
  isFlushing: boolean;
  enqueue: (item: NewPendingSyncItem) => void;
  flush: () => Promise<void>;
}

async function runOne(item: PendingSyncItem): Promise<void> {
  if (item.kind === 'sale') return backupSale(item.payload);
  if (item.kind === 'return') return backupReturn(item.payload);
  return backupReceiving(item.payload);
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
