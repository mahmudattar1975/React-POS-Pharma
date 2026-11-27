// Shared brand master. SQL is authoritative; the browser keeps a persisted copy so the Item Master
// dropdown and the masters screen remain usable offline.
import type { Brand } from '../types/brand';
import { getMaster, patchMaster, postMaster, type MasterWritePayload } from './masterRequest';

const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';

export async function getBrands(signal?: AbortSignal): Promise<Brand[]> {
  const res = await fetch(`${BASE_URL}/api/brands`, { cache: 'no-store', signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Brand master sync failed (${res.status})`);
  return getMaster<Brand>(body, 'brands');
}

export function createBrand(payload: MasterWritePayload): Promise<Brand> {
  return postMaster<Brand>(`${BASE_URL}/api/brands`, payload, 'brand');
}

export function updateBrand(id: number, payload: MasterWritePayload): Promise<Brand> {
  return patchMaster<Brand>(`${BASE_URL}/api/brands`, id, payload, 'brand');
}
