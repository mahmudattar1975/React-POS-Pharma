// Read/write model for Settings > ZATCA > Company & Device. Kept separate from the routes so the
// shape the frontend consumes is one explicit interface, and from store/identity.ts so the stored
// fields and the derived/read-only presentation can evolve independently.
import { loadState, type ZatcaEnv } from '../store/secureStore.js';
import {
  deriveIdentity,
  loadIdentity,
  missingConfiguredFields,
  normalizeIdentityInput,
  saveIdentity,
  type DerivedIdentity,
  type DeviceIdentity,
  type SellerIdentity,
} from '../store/identity.js';
import { describeCsid, type CsidSummary } from './csidStatus.js';

export interface ZatcaSettings {
  seller: SellerIdentity;
  device: DeviceIdentity;
  // Read-only values the server will actually put in the CSR / EGS serial, so the UI never has to
  // re-implement the format and drift from it.
  derived: DerivedIdentity;
  // 'env' = first run, values seeded from .env and not yet reviewed/saved by the user.
  source: 'stored' | 'env';
  configured: boolean;
  missing: string[];
  environment: ZatcaEnv;
  csid: {
    compliance?: CsidSummary;
    production?: CsidSummary;
  };
}

export interface ZatcaSettingsUpdate extends ZatcaSettings {
  // True when the CSR-relevant identity changed while a CSID existed, so the old certificate and
  // invoice chain were cleared and onboarding has to be repeated.
  csidsCleared: boolean;
}

export async function getZatcaSettings(): Promise<ZatcaSettings> {
  // Sequential, not Promise.all: `loadIdentity` may CREATE the stored identity (first run), and the
  // state file is written non-atomically - a concurrent read could catch a half-written file.
  const { identity, source } = await loadIdentity();
  const state = await loadState();
  const missing = missingConfiguredFields(identity);
  return {
    seller: identity.seller,
    device: identity.device,
    derived: deriveIdentity(identity.device),
    source,
    configured: missing.length === 0,
    missing,
    environment: state.environment,
    csid: {
      compliance: describeCsid(state.compliance),
      production: describeCsid(state.production),
    },
  };
}

export async function updateZatcaSettings(body: unknown): Promise<ZatcaSettingsUpdate> {
  const current = await loadIdentity();
  const next = normalizeIdentityInput(body, current.identity);
  const saved = await saveIdentity(next);
  return { ...(await getZatcaSettings()), csidsCleared: saved.csidsCleared };
}
