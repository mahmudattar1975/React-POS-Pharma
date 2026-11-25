import type { IncentiveItem, IncentiveRecord, IncentiveSummary } from '../types/incentive';

const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Incentive request ${path} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function listIncentiveItems(active?: boolean): Promise<IncentiveItem[]> {
  const qs = active === undefined ? '' : `?active=${active}`;
  const rows = await request<any[]>(`/api/incentives/items${qs}`);
  return rows.map((r) => ({
    id: r.id,
    itemId: r.itemId,
    itemNameEn: r.itemNameEn ?? undefined,
    itemNameAr: r.itemNameAr ?? undefined,
    incentiveType: r.incentiveType,
    rate: r.rate,
    activeFrom: r.activeFrom,
    activeTo: r.activeTo,
    branchNo: r.branchNo ?? undefined,
    active: r.active,
  }));
}

export async function getActiveIncentives(date?: string): Promise<IncentiveItem[]> {
  const qs = date ? `?date=${date}` : '';
  const rows = await request<any[]>(`/api/incentives/active${qs}`);
  return rows.map((r) => ({
    id: r.id,
    itemId: r.itemId,
    itemNameEn: r.itemNameEn ?? undefined,
    itemNameAr: r.itemNameAr ?? undefined,
    incentiveType: r.incentiveType,
    rate: r.rate,
    activeFrom: r.activeFrom,
    activeTo: r.activeTo,
    branchNo: r.branchNo ?? undefined,
    active: r.active,
  }));
}

export async function createIncentiveItem(
  input: Omit<IncentiveItem, 'id' | 'itemNameEn' | 'itemNameAr'>,
): Promise<IncentiveItem> {
  const r = await request<any>('/api/incentives/items', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return {
    id: r.id,
    itemId: r.itemId,
    itemNameEn: r.itemNameEn ?? undefined,
    itemNameAr: r.itemNameAr ?? undefined,
    incentiveType: r.incentiveType,
    rate: r.rate,
    activeFrom: r.activeFrom,
    activeTo: r.activeTo,
    branchNo: r.branchNo ?? undefined,
    active: r.active,
  };
}

export async function updateIncentiveItem(
  id: string,
  patch: Partial<Omit<IncentiveItem, 'id' | 'itemNameEn' | 'itemNameAr'>>,
): Promise<IncentiveItem> {
  const r = await request<any>(`/api/incentives/items/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  return {
    id: r.id,
    itemId: r.itemId,
    itemNameEn: r.itemNameEn ?? undefined,
    itemNameAr: r.itemNameAr ?? undefined,
    incentiveType: r.incentiveType,
    rate: r.rate,
    activeFrom: r.activeFrom,
    activeTo: r.activeTo,
    branchNo: r.branchNo ?? undefined,
    active: r.active,
  };
}

export async function deleteIncentiveItem(id: string): Promise<void> {
  await request(`/api/incentives/items/${id}`, { method: 'DELETE' });
}

export interface IncentiveRecordPayload {
  saleId: string;
  // dotnet_pos.pos.Id of the original sale. Returns reuse it so the negative clawback updates the
  // original pos_item.CommissionAmount instead of posting a separate negative ledger row.
  posSaleId?: number;
  invoiceNo: string;
  invoiceDate: string;
  cashierName: string;
  branchNo?: number;
  lines: Array<{
    itemId: string;
    // dotnet_pos keys items by barcode (item.Code). Sent alongside the local catalog id so the
    // server can write commission onto the right pos_item row.
    barcode?: string;
    posItemId?: number;
    itemNameEn: string;
    qty: number;
    saleAmount: number;
    incentiveType: 'percent' | 'amount';
    rate: number;
    incentiveAmount: number;
    incentiveItemId?: string;
  }>;
}

export async function recordIncentive(payload: IncentiveRecordPayload): Promise<{ ok: boolean; count: number }> {
  return request('/api/incentives/records', { method: 'POST', body: JSON.stringify(payload) });
}

export async function fetchIncentiveReport(params: {
  from?: string;
  to?: string;
  cashier?: string;
  itemId?: string;
}): Promise<IncentiveRecord[]> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.cashier) qs.set('cashier', params.cashier);
  if (params.itemId) qs.set('itemId', params.itemId);
  const q = qs.toString();
  const rows = await request<any[]>(`/api/incentives/report${q ? '?' + q : ''}`);
  return rows.map((r) => ({
    id: r.id,
    saleId: r.saleId,
    invoiceNo: r.invoiceNo,
    invoiceDate: r.invoiceDate,
    itemId: r.itemId,
    itemNameEn: r.itemNameEn,
    qty: r.qty,
    saleAmount: r.saleAmount,
    incentiveType: r.incentiveType,
    rate: r.rate,
    incentiveAmount: r.incentiveAmount,
    cashierName: r.cashierName,
    createdAt: r.createdAt,
  }));
}

export async function fetchIncentiveSummary(params: { from?: string; to?: string }): Promise<{
  days: IncentiveSummary[];
  totals: { invoiceCount: number; totalSaleAmount: number; totalIncentive: number };
}> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const q = qs.toString();
  const r = await request<any>(`/api/incentives/report/summary${q ? '?' + q : ''}`);
  return {
    days: (r.days ?? []).map((d: any) => ({
      date: d.date,
      invoiceCount: d.invoiceCount,
      totalSaleAmount: d.totalSaleAmount,
      totalIncentive: d.totalIncentive,
    })),
    totals: r.totals,
  };
}
