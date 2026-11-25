// Branch master + terminal context + cross-branch stock. All read calls are advisory: the POS
// works from localStorage first, so a failed request here must never stop a sale.
import type { Branch, BranchContext, BranchStock } from '../types/branch';

const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request ${path} failed (${res.status})`);
  return body as T;
}

export function getBranchContext(): Promise<BranchContext> {
  return request('/api/context');
}

export interface BranchesResponse {
  branches: Branch[];
  source: 'database' | 'fallback';
  error?: string;
}

export function getBranches(): Promise<BranchesResponse> {
  return request('/api/branches');
}

export type BranchInput = Omit<Branch, 'id' | 'createdAt'>;

export function createBranch(input: BranchInput): Promise<Branch> {
  return request('/api/branches', { method: 'POST', body: JSON.stringify(input) });
}

export function updateBranch(id: string, input: BranchInput): Promise<Branch> {
  return request(`/api/branches/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

// Stock from the shared PharmaDB, NOT the ERP - so it works for local catalogue items too.
export function getOtherBranchStock(itemId: string): Promise<BranchStock[]> {
  return request(`/api/stock/other-branches?itemId=${encodeURIComponent(itemId)}`);
}
