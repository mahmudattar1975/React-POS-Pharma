// Read-only shared category master. The server owns dbo.ItemCategories; the browser keeps a
// persisted copy so the Item Master dropdown and Excel importer still work offline.
import type { ItemCategory } from '../types/catalog';

const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';

export async function getItemCategories(signal?: AbortSignal): Promise<ItemCategory[]> {
  const res = await fetch(`${BASE_URL}/api/item-categories`, { cache: 'no-store', signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Category master sync failed (${res.status})`);
  return Array.isArray(body.categories) ? (body.categories as ItemCategory[]) : [];
}
