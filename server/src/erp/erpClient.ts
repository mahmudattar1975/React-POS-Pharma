import { config } from '../config.js';
import { getErpSession, invalidateErpSession } from './erpAuth.js';

// Every write-capable endpoint on the ERP backend is guarded by this same FUNCTION_ID scheme, but
// this integration only ever calls SearchData/GetRecordByID (read) routes - see erp/README.md for
// why this stays read-only. FUNCTION_ID is still required on every request (the backend's
// EnforceFunctionAuth checks it), so each read call passes the id for the specific screen/action
// it corresponds to, matching how the existing React ERP frontend does it.
export interface ErpResponseDTO<T> {
  isSuccess: boolean;
  message?: string;
  datac?: T[];
  totalSize?: number;
  totalPages?: number;
}

async function postOnce<T>(path: string, functionId: string, body: unknown): Promise<ErpResponseDTO<T>> {
  const session = await getErpSession();
  const res = await fetch(`${config.erp.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
      FUNCTION_ID: functionId,
      USER_ID: String(session.userId),
      FAPPL_TYPE: String(session.fapplType),
      FAPPL_SUB: String(session.fapplSub),
      PROFILE_ID: String(session.profileId),
      FUNIT_ID: String(session.funitId),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw { status: 401 }; // eslint-disable-line no-throw-literal -- signal for the retry below
  const parsed = (await res.json().catch(() => ({}))) as ErpResponseDTO<T>;
  if (!res.ok) throw new Error(`ERP ${path} -> ${res.status}: ${parsed.message ?? JSON.stringify(parsed)}`);
  return parsed;
}

// The ERP backend's token lifetime isn't something this integration controls - a 401 here just
// means the cached session expired, so re-login once and retry rather than surfacing a spurious
// failure to the POS for something that self-heals.
export async function erpPost<T>(path: string, functionId: string, body: unknown): Promise<ErpResponseDTO<T>> {
  try {
    return await postOnce<T>(path, functionId, body);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && err.status === 401) {
      invalidateErpSession();
      return postOnce<T>(path, functionId, body);
    }
    throw err;
  }
}
