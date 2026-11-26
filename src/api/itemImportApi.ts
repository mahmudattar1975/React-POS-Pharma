// Writes the reviewed item-import plan to this app's server. Unlike the best-effort sale/receiving
// backups, this is a deliberate admin action: the dialog treats a failure as fatal and leaves the
// local catalogue untouched, so the owner can retry after fixing the server/database problem.
import type { ItemImportPayloadRow } from '../utils/itemImport';

const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';

export interface ImportedItemRecord extends ItemImportPayloadRow {
  id: string;
}

export interface ItemImportResult {
  created: number;
  updated: number;
  app: { created: number; updated: number };
  legacy: { created: number; updated: number };
  items: ImportedItemRecord[];
}

export async function importItems(items: ItemImportPayloadRow[]): Promise<ItemImportResult> {
  const res = await fetch(`${BASE_URL}/api/items/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(body.rollbackErrors) && body.rollbackErrors.length > 0
      ? ` Rollback: ${body.rollbackErrors.join('; ')}`
      : '';
    throw new Error(body.error ?? `Item import failed (${res.status}).${detail}`);
  }
  return body as ItemImportResult;
}
