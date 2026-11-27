// Read-only shared shelf/store location master. The server owns dbo.Locations; the browser keeps a
// persisted copy so the Item Master dropdown still works offline.
import type { Location } from '../types/location';
import { getMaster, patchMaster, postMaster, type MasterWritePayload } from './masterRequest';

const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';

export async function getLocations(signal?: AbortSignal): Promise<Location[]> {
  const res = await fetch(`${BASE_URL}/api/locations`, { cache: 'no-store', signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Location master sync failed (${res.status})`);
  return getMaster<Location>(body, 'locations');
}

export function createLocation(payload: MasterWritePayload): Promise<Location> {
  return postMaster<Location>(`${BASE_URL}/api/locations`, payload, 'location');
}

export function updateLocation(id: number, payload: MasterWritePayload): Promise<Location> {
  return patchMaster<Location>(`${BASE_URL}/api/locations`, id, payload, 'location');
}
