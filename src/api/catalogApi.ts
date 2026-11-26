// Read-only shared catalogue from this app's SQL mirror. Every branch terminal keeps its own
// offline-first localStorage copy, so a master row imported on one terminal would otherwise never
// appear on another. Only item-master fields are returned - batches/stock remain branch-owned and
// are never part of this sync.
import type { ItemImportPayloadRow } from '../utils/itemImport';

const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';

// isActive is deliberately absent: it is branch-local (a terminal may discontinue an item without
// changing the shared master), so syncing a SQL row must never overwrite that flag.
export type SharedCatalogItem = Omit<ItemImportPayloadRow, 'isActive'> & { id: string };

export async function getSharedCatalog(signal?: AbortSignal): Promise<SharedCatalogItem[]> {
  const res = await fetch(`${BASE_URL}/api/items`, { cache: 'no-store', signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Catalog sync failed (${res.status})`);
  if (!Array.isArray(body.items)) return [];
  // Alias codes are part of the shared master. Normalise the wire shape here so an older server (or
  // a malformed row) cannot push a non-array into the offline catalogue and break barcode lookup.
  return (body.items as Array<SharedCatalogItem & { barcodes?: unknown }>).map((row) => ({
    ...row,
    barcodes: Array.isArray(row.barcodes)
      ? row.barcodes.filter((code): code is string => typeof code === 'string')
      : [],
  }));
}
