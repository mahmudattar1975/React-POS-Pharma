// Read-only shared unit-of-measure master. The server owns dbo.Units; the browser keeps a
// persisted copy so the Item Master dropdown still works offline.
import type { Unit } from '../types/unit';
import { getMaster, patchMaster, postMaster, type MasterWritePayload } from './masterRequest';

const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';

export async function getUnits(signal?: AbortSignal): Promise<Unit[]> {
  const res = await fetch(`${BASE_URL}/api/units`, { cache: 'no-store', signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Unit master sync failed (${res.status})`);
  return getMaster<Unit>(body, 'units');
}

export function createUnit(payload: MasterWritePayload): Promise<Unit> {
  return postMaster<Unit>(`${BASE_URL}/api/units`, payload, 'unit');
}

export function updateUnit(id: number, payload: MasterWritePayload): Promise<Unit> {
  return patchMaster<Unit>(`${BASE_URL}/api/units`, id, payload, 'unit');
}
