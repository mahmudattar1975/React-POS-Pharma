// Reads the CSID certificate ZATCA issued and reports when it expires.
//
// The PowerBuilder CSID generator kept an explicit `expiry date` + `status (active/expired)` per
// terminal because ZATCA certificates are time-limited; without that, a working install silently
// turns into a failing one on the expiry date with no explanation. The dates are already inside the
// certificate, so they are read from there rather than re-typed by the user and allowed to drift.
import { X509Certificate } from 'node:crypto';
import type { StoredCsid } from '../store/secureStore.js';

export type CsidLifecycle = 'active' | 'expiring' | 'expired' | 'unknown';

export interface CsidSummary {
  issuedAt: string;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  status: CsidLifecycle;
}

const EXPIRING_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export function describeCsid(csid: StoredCsid | undefined): CsidSummary | undefined {
  if (!csid) return undefined;

  let expiresAt: string | null = null;
  try {
    const parsed = new Date(new X509Certificate(csid.certificatePem).validTo);
    if (!Number.isNaN(parsed.getTime())) expiresAt = parsed.toISOString();
  } catch {
    // A stored certificate that no longer parses is worth surfacing as "unknown" rather than
    // pretending the CSID is valid - the invoice submission would fail with a much less clear error.
  }

  if (!expiresAt) {
    return { issuedAt: csid.issuedAt, expiresAt: null, daysUntilExpiry: null, status: 'unknown' };
  }

  const daysUntilExpiry = Math.floor((new Date(expiresAt).getTime() - Date.now()) / DAY_MS);
  const status: CsidLifecycle =
    daysUntilExpiry < 0 ? 'expired' : daysUntilExpiry <= EXPIRING_WINDOW_DAYS ? 'expiring' : 'active';

  return { issuedAt: csid.issuedAt, expiresAt, daysUntilExpiry, status };
}
