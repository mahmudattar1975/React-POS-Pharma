// The RSD outbox must never lose a national movement, never resend a terminal rejection by itself,
// and never block a sale on SFDA. These tests drive the real store against a stubbed fetch: a
// success, a business rejection (FC 21017), a network failure that later recovers, a blocked
// cancellation, and the operator's explicit Retry (which reopens the rejection first).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaleHeader, SaleLine } from '../types/sales';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
});

type StoreModule = typeof import('./rsdOutboxStore');
let store: StoreModule['useRsdOutboxStore'];

const fetchMock = vi.fn();

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  store = (await import('./rsdOutboxStore')).useRsdOutboxStore;
});

beforeEach(() => {
  fetchMock.mockReset();
  store.setState({ queue: [], isFlushing: false, lastFlushAt: undefined });
});

function jsonResponse(body: unknown): { ok: true; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: async () => body };
}

function sent(notificationId = 'N-1') {
  return jsonResponse({
    outcome: 'sent',
    record: { status: 'sent', rc: '00000', retryable: false, notificationId },
  });
}

function rejected(rc = '21017') {
  return jsonResponse({
    outcome: 'rejected',
    record: {
      status: 'rejected',
      rc,
      retryable: false,
      message: 'Stakeholder is not authorised for this operation.',
    },
  });
}

function line(overrides: Partial<SaleLine> = {}): SaleLine {
  return {
    id: 'line-1',
    itemId: 'itm-1',
    itemNameAr: 'دواء',
    itemNameEn: 'Drug',
    batchId: 'bat-1',
    batchNo: 'TTXJ6',
    expiryDate: '2029-03-24',
    qty: 1,
    unitPrice: 10,
    vatRate: 0,
    discountAmount: 0,
    netExclVat: 10,
    vatAmount: 0,
    totalInclVat: 10,
    returnedQty: 0,
    requiresBatchTracking: true,
    serials: [
      { gtin: '07612791388842', serialNo: '1323424679', batchNo: 'TTXJ6', expiryDate: '2029-03-24' },
    ],
    ...overrides,
  };
}

function invoice(lines: SaleLine[]): SaleHeader {
  return {
    id: 'sale-1',
    invoiceNo: 'SIM-000001',
    invoiceType: 'simplified',
    date: '2026-11-23T10:00:00.000Z',
    lines,
    subtotalExclVat: 10,
    totalDiscount: 0,
    totalVatAmount: 0,
    totalInclVat: 10,
    payments: [{ method: 'cash', amount: 10 }],
    zatcaQrBase64: '',
    zatcaStatus: 'phase2_reported',
    status: 'completed',
    cashierName: 'admin',
  };
}

async function waitIdle(): Promise<void> {
  await vi.waitFor(() => expect(store.getState().isFlushing).toBe(false));
}

describe('RSD outbox store', () => {
  it('reports each serialised drug pack and marks it sent', async () => {
    fetchMock.mockResolvedValue(sent());
    store.getState().enqueueSale(
      invoice([
        line({ id: 'drug', serials: [
          { gtin: '07612791388842', serialNo: 'A1', batchNo: 'TTXJ6', expiryDate: '2029-03-24' },
          { gtin: '07612791388842', serialNo: 'A2', batchNo: 'TTXJ6', expiryDate: '2029-03-24' },
        ] }),
        line({ id: 'supply', requiresBatchTracking: false }),
      ]),
    );

    await vi.waitFor(() => expect(store.getState().queue.every((item) => item.status === 'sent')).toBe(true));
    expect(store.getState().queue).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/rsd/sales');
  });

  it('never resends a terminal rejection on its own', async () => {
    fetchMock.mockResolvedValue(rejected());
    store.getState().enqueueSale(invoice([line()]));
    await vi.waitFor(() => expect(store.getState().queue[0]?.status).toBe('rejected'));
    await waitIdle();

    await store.getState().flush();

    expect(store.getState().queue[0].rc).toBe('21017');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a network failure queued and sends it once the server is back', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    store.getState().enqueueSale(invoice([line()]));
    await vi.waitFor(() => expect(store.getState().queue[0]?.attempts).toBe(1));
    await waitIdle();

    expect(store.getState().queue[0].status).toBe('pending');

    fetchMock.mockResolvedValue(sent());
    await store.getState().flush();

    expect(store.getState().queue[0].status).toBe('sent');
    expect(store.getState().queue[0].notificationId).toBe('N-1');
  });

  it('blocks a cancellation whose sale RSD rejected', async () => {
    fetchMock.mockResolvedValue(rejected());
    store.getState().enqueueSale(invoice([line()]));
    store.getState().enqueueReturn(invoice([line({ returnedQty: 1 })]), ['line-1'], 'returned');

    await vi.waitFor(() => expect(store.getState().queue.find((item) => item.kind === 'sale')?.status).toBe('rejected'));
    await waitIdle();
    await store.getState().flush();

    const cancel = store.getState().queue.find((item) => item.kind === 'cancel');
    expect(cancel?.status).toBe('blocked');
    expect(cancel?.rc).toBe('sale_not_sent');
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the sale was ever sent
  });

  it('reopens a rejection on the server before resending it', async () => {
    fetchMock
      .mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(jsonResponse({ record: null }))
      .mockResolvedValueOnce(sent());

    store.getState().enqueueSale(invoice([line()]));
    await vi.waitFor(() => expect(store.getState().queue[0]?.status).toBe('rejected'));
    await waitIdle();

    const id = store.getState().queue[0].id;
    await store.getState().retry(id);

    expect(store.getState().queue[0].status).toBe('sent');
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining('/api/rsd/sales'),
      expect.stringContaining('/api/rsd/reopen'),
      expect.stringContaining('/api/rsd/sales'),
    ]);
  });

  it('sends a blocked cancellation as soon as its sale is retried successfully', async () => {
    fetchMock.mockResolvedValue(rejected());
    store.getState().enqueueSale(invoice([line()]));
    store.getState().enqueueReturn(invoice([line({ returnedQty: 1 })]), ['line-1'], 'returned');
    await vi.waitFor(() => expect(store.getState().queue.find((item) => item.kind === 'sale')?.status).toBe('rejected'));
    await waitIdle();
    await store.getState().flush();

    expect(store.getState().queue.find((item) => item.kind === 'cancel')?.status).toBe('blocked');

    const saleId = store.getState().queue.find((item) => item.kind === 'sale')?.id ?? '';
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ record: null })) // reopen the sale
      .mockResolvedValueOnce(sent('SALE-OK')) // sale accepted
      .mockResolvedValueOnce(sent('CANCEL-OK')); // its cancellation follows in the same flush

    await store.getState().retry(saleId);

    expect(store.getState().queue.find((item) => item.kind === 'sale')?.status).toBe('sent');
    expect(store.getState().queue.find((item) => item.kind === 'cancel')?.status).toBe('sent');
  });

  it('lets the server decide a cancellation when the local sale row is gone', async () => {
    fetchMock.mockResolvedValue(sent('C-1'));
    store.getState().enqueueReturn(invoice([line({ returnedQty: 1 })]), ['line-1'], 'returned');

    await vi.waitFor(() => expect(store.getState().queue[0]?.status).toBe('sent'));
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/rsd/sales/cancel');
  });

  it('queues a pack once, even if the same invoice is recorded again', async () => {
    fetchMock.mockResolvedValue(sent());
    const sale = invoice([line()]);
    store.getState().enqueueSale(sale);
    await vi.waitFor(() => expect(store.getState().queue[0]?.status).toBe('sent'));

    store.getState().enqueueSale(sale);

    expect(store.getState().queue).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
