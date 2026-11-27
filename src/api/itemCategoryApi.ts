// Read-only shared category master. The server owns dbo.Categories; the browser keeps a
// persisted copy so the Item Master dropdown and Excel importer still work offline.
import type { ItemCategory } from '../types/catalog';
import { getMaster, patchMaster, postMaster, type MasterWritePayload } from './masterRequest';

const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';

export async function getItemCategories(signal?: AbortSignal): Promise<ItemCategory[]> {
  const res = await fetch(`${BASE_URL}/api/item-categories`, { cache: 'no-store', signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Category master sync failed (${res.status})`);
  return getMaster<ItemCategory>(body, 'categories');
}

export function createCategory(payload: MasterWritePayload): Promise<ItemCategory> {
  return postMaster<ItemCategory>(`${BASE_URL}/api/item-categories`, payload, 'category');
}

export function updateCategory(id: number, payload: MasterWritePayload): Promise<ItemCategory> {
  return patchMaster<ItemCategory>(`${BASE_URL}/api/item-categories`, id, payload, 'category');
}
