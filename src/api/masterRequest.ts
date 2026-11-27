// Shared request helpers for the four master-management APIs. Every master uses the same write
// payload so the Item Masters screen can stay table-driven; the server owns code generation.
import { authHeaders } from './authHeaders';

export interface MasterWritePayload {
  // Optional on create (the server assigns the next code); ignored on update so codes stay stable.
  code?: string;
  nameAr: string;
  nameEn: string;
  isActive?: boolean;
  // Categories only: the parent row id, or null for a top-level category.
  parentCategoryId?: number | null;
}

async function request<T>(url: string, init: RequestInit, key: string): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Master write failed (${res.status})`);
  return body[key] as T;
}

export function getMaster<T>(body: unknown, key: string): T[] {
  const rows = (body as Record<string, unknown>)?.[key];
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export function postMaster<T>(base: string, payload: MasterWritePayload, key: string): Promise<T> {
  return request<T>(base, { method: 'POST', body: JSON.stringify(payload) }, key);
}

export function patchMaster<T>(base: string, id: number, payload: MasterWritePayload, key: string): Promise<T> {
  return request<T>(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }, key);
}
