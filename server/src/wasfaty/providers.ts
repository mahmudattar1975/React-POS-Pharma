// Provider adapters. One interface, four implementations:
//
//   manual  Phase 0. The pharmacist reads the prescription from the patient's Wasfaty message and
//           records the dispense. We do not pretend to look anything up or authorize anything; the
//           dispense is real and claimable, with provider=`manual` marking how it was obtained.
//   mock    A deterministic NUPCO simulator. It exists so the POS -> API -> claim loop can be
//           exercised end-to-end (authorization, dispense id, claim ledger) with no NUPCO access.
//           It is never used silently: health reports provider=`mock`.
//   direct  Contract-file driven NUPCO connection. Fails closed until every required operation,
//           base URL and auth scheme is supplied by onboarding.
//   hub     Same as direct, for an approved integration hub in front of NUPCO.
//
// Nothing in this file hardcodes a NUPCO hostname, path or payload. The contract file is the only
// source of those, which is what keeps the app honest about an unknown external contract.
import { configuredProvider, isLiveContractUsable, loadContract } from './contract.js';
import { unavailable, WasfatyApiError } from './errors.js';
import type {
  WasfatyAuthorizationResult,
  WasfatyClaim,
  WasfatyContractFile,
  WasfatyDispenseRecord,
  WasfatyDispenseStatus,
  WasfatyOperationMapping,
  WasfatyOperationName,
  WasfatyPrescription,
  WasfatyPrescriptionLine,
  WasfatyProvider,
  WasfatyProviderAdapter,
  WasfatySession,
} from './types.js';

function last4(value: string | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(-4);
}

function isoNow(): string {
  return new Date().toISOString();
}

// -------------------------------------------------------------------------------------------------
// manual (Phase 0)
// -------------------------------------------------------------------------------------------------
const manualProvider: WasfatyProviderAdapter = {
  id: 'manual',
  capabilities: {
    lookupPrescription: false,
    requestAuthorization: false,
    submitDispense: true,
    submitClaim: false,
  },
  async lookupPrescription() {
    throw unavailable(
      'Manual Wasfaty mode: read the prescription from the patient’s Wasfaty message. Nothing is sent to NUPCO.',
    );
  },
  async requestAuthorization() {
    throw unavailable(
      'Manual Wasfaty mode: enter the authorization number shown by the Wasfaty portal, if any. Nothing is sent to NUPCO.',
    );
  },
  async submitDispense() {
    // A manual dispense is final locally and claimable; it simply carries no NUPCO-issued id.
    return { status: 'manual_recorded' as WasfatyDispenseStatus };
  },
  async cancelDispense() {
    return { status: 'cancelled' as WasfatyDispenseStatus };
  },
  async submitClaim() {
    throw unavailable('Manual Wasfaty mode does not submit claims to NUPCO.');
  },
  async reconcileClaim() {
    throw unavailable('Manual Wasfaty mode does not reconcile claims with NUPCO.');
  },
};

// -------------------------------------------------------------------------------------------------
// mock (deterministic NUPCO simulator)
// -------------------------------------------------------------------------------------------------
const MOCK_LINES: Omit<WasfatyPrescriptionLine, 'lineId'>[] = [
  {
    nupcoCode: '6281007320014',
    nameEn: 'Paracetamol 500mg (20 tabs)',
    nameAr: 'باراسيتامول 500 مجم',
    qty: 1,
    unit: 'Strip',
    dose: 'حبة مرتين يومياً بعد الأكل',
    substitutionAllowed: false,
  },
  {
    nupcoCode: '6281007320069',
    nameEn: 'Omeprazole 20mg (14 caps)',
    nameAr: 'أوميبرازول 20 مجم',
    qty: 1,
    unit: 'Strip',
    dose: 'حبة واحدة يومياً قبل الأكل',
    substitutionAllowed: true,
  },
];

function mockRef(prefix: string, seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return `${prefix}-${hash.toString(36).toUpperCase().padStart(6, '0')}`;
}

const mockProvider: WasfatyProviderAdapter = {
  id: 'mock',
  capabilities: {
    lookupPrescription: true,
    requestAuthorization: true,
    submitDispense: true,
    submitClaim: true,
  },
  async lookupPrescription(input) {
    return {
      prescriptionId: mockRef('MOCK-RX', input.prescriptionNo),
      prescriptionNo: input.prescriptionNo,
      patientIdLast4: last4(input.patientNationalId),
      prescriber: { name: 'Dr. Simulated Prescriber', id: 'MOCK-PR-1' },
      issuedAt: isoNow(),
      status: 'active',
      lines: MOCK_LINES.map((line, index) => ({
        ...line,
        lineId: `mock-line-${index + 1}`,
      })),
      source: 'mock',
    };
  },
  async requestAuthorization(input) {
    return {
      authorizationNo: mockRef('MOCK-AUTH', input.prescriptionNo),
      status: 'authorized',
      authorizationId: mockRef('MOCK-AUTHID', input.prescriptionNo),
      approvedLines: input.lines.map((line) => ({
        lineId: line.lineId,
        nupcoCode: line.nupcoCode,
        approvedQty: line.qty,
      })),
      message: 'Simulated NUPCO authorization: every requested line approved in full.',
    };
  },
  async submitDispense(record) {
    return {
      status: 'dispensed' as WasfatyDispenseStatus,
      nupcoPrescriptionId: mockRef('MOCK-NRX', record.prescriptionNo),
      nupcoDispenseId: mockRef('MOCK-NDSP', record.saleId ?? record.id),
      authorizationNo: record.authorizationNo ?? mockRef('MOCK-AUTH', record.prescriptionNo),
    };
  },
  async cancelDispense() {
    return { status: 'cancelled' as WasfatyDispenseStatus };
  },
  async submitClaim(claim) {
    return {
      status: 'reported' as const,
      reportedAmount: claim.expectedAmount,
    };
  },
  async reconcileClaim(claim, input) {
    const paid = input.paidAmount ?? claim.expectedAmount;
    const variance = Math.abs(paid - claim.expectedAmount) > 0.01;
    return {
      status: variance ? ('variance' as const) : ('reconciled' as const),
      reportedAmount: input.reportedAmount ?? claim.reportedAmount ?? claim.expectedAmount,
      paidAmount: paid,
      varianceReason: input.varianceReason ?? (variance ? 'Simulated NUPCO paid a different amount.' : undefined),
    };
  },
};

// -------------------------------------------------------------------------------------------------
// direct / hub (contract-file driven)
// -------------------------------------------------------------------------------------------------

// Dot path reader with `[n]` indexes: `data.items[0].code`.
function readPath(value: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((acc, key) => {
      if (acc === null || acc === undefined || typeof acc !== 'object') return undefined;
      return (acc as Record<string, unknown>)[key];
    }, value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function num(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mappedLines(raw: unknown, mapping: WasfatyOperationMapping | undefined): WasfatyPrescriptionLine[] {
  const list = readPath(raw, mapping?.lines);
  if (!Array.isArray(list)) return [];
  return list.map((entry, index) => ({
    lineId: text(readPath(entry, mapping?.lineId)) ?? `line-${index + 1}`,
    nupcoCode: text(readPath(entry, mapping?.nupcoCode)) ?? '',
    nameEn: text(readPath(entry, 'nameEn')) ?? '',
    nameAr: text(readPath(entry, 'nameAr')),
    qty: num(readPath(entry, mapping?.qty ?? 'qty')) ?? 0,
    unit: text(readPath(entry, 'unit')),
    dose: text(readPath(entry, 'dose')),
    substitutionAllowed: readPath(entry, 'substitutionAllowed') === true,
  }));
}

function authHeaders(file: WasfatyContractFile): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const auth = file.auth;
  if (!auth || auth.type === 'none') return headers;
  const token = auth.token ?? (auth.tokenEnv ? process.env[auth.tokenEnv] : undefined);
  if (!token) {
    throw unavailable(
      `Wasfaty contract auth is "${auth.type}" but no token is available (set ${auth.tokenEnv ?? 'auth.token'}).`,
    );
  }
  if (auth.type === 'bearer') headers.Authorization = `Bearer ${token}`;
  else headers[auth.header ?? 'X-API-Key'] = token;
  return headers;
}

function liveProvider(id: 'direct' | 'hub', file: WasfatyContractFile): WasfatyProviderAdapter {
  async function call(operation: WasfatyOperationName, payload: unknown): Promise<unknown> {
    const contract = file.operations?.[operation];
    if (!contract || !file.baseUrl) {
      throw unavailable(`The Wasfaty contract does not define the "${operation}" operation.`);
    }
    const url = `${file.baseUrl.replace(/\/$/, '')}${contract.path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: contract.method,
        headers: authHeaders(file),
        body: contract.method === 'GET' ? undefined : JSON.stringify(payload ?? {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new WasfatyApiError(
        502,
        `NUPCO ${operation} could not be reached: ${err instanceof Error ? err.message : String(err)}`,
        'nupco_unreachable',
      );
    }
    const bodyText = await response.text();
    let body: unknown = undefined;
    try {
      body = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      body = bodyText;
    }
    if (!response.ok) {
      throw new WasfatyApiError(
        502,
        `NUPCO ${operation} answered ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
        'nupco_error',
      );
    }
    return body;
  }

  const mappingFor = (operation: WasfatyOperationName) => file.mappings?.[operation];

  return {
    id,
    capabilities: {
      lookupPrescription: true,
      requestAuthorization: true,
      submitDispense: true,
      submitClaim: true,
    },
    async lookupPrescription(input) {
      const raw = await call('lookupPrescription', input);
      const m = mappingFor('lookupPrescription');
      // With no mapping the supplier is expected to answer directly in the neutral shape. That is a
      // deliberate contract choice, not an assumption about NUPCO.
      if (!m) return raw as WasfatyPrescription;
      const lines = mappedLines(raw, m);
      return {
        prescriptionId: text(readPath(raw, m.prescriptionId)) ?? input.prescriptionNo,
        prescriptionNo: input.prescriptionNo,
        patientIdLast4: text(readPath(raw, m.patientIdLast4)) ?? last4(input.patientNationalId),
        prescriber: {
          name: text(readPath(raw, m.prescriberName)) ?? '',
          id: text(readPath(raw, m.prescriberId)),
        },
        issuedAt: text(readPath(raw, m.issuedAt)) ?? isoNow(),
        status: (text(readPath(raw, m.status)) as WasfatyPrescription['status']) ?? 'active',
        lines,
        source: id,
      };
    },
    async requestAuthorization(input) {
      const raw = await call('requestAuthorization', input);
      const m = mappingFor('requestAuthorization');
      if (!m) return raw as WasfatyAuthorizationResult;
      const lines = mappedLines(raw, m);
      return {
        authorizationNo: text(readPath(raw, m.authorizationNo)) ?? '',
        status: (text(readPath(raw, m.status)) as WasfatyAuthorizationResult['status']) ?? 'authorization_pending',
        approvedLines: lines.map((line) => ({
          lineId: line.lineId,
          nupcoCode: line.nupcoCode,
          approvedQty: line.qty,
        })),
        authorizationId: text(readPath(raw, m.id)),
      };
    },
    async submitDispense(record: WasfatyDispenseRecord) {
      const raw = await call('submitDispense', record);
      const m = mappingFor('submitDispense');
      if (!m) return raw as Awaited<ReturnType<WasfatyProviderAdapter['submitDispense']>>;
      return {
        status: (text(readPath(raw, m.status)) as WasfatyDispenseStatus) ?? 'dispensed',
        nupcoDispenseId: text(readPath(raw, m.nupcoDispenseId)),
        nupcoPrescriptionId: text(readPath(raw, m.nupcoPrescriptionId)),
        authorizationNo: text(readPath(raw, m.authorizationNo)),
        rejectionReason: text(readPath(raw, m.rejectionReason)),
      };
    },
    async cancelDispense(record, reason) {
      const raw = await call('cancelDispense', { dispenseId: record.id, nupcoDispenseId: record.nupcoDispenseId, reason });
      const m = mappingFor('cancelDispense');
      if (!m) return raw as { status: WasfatyDispenseStatus };
      return { status: (text(readPath(raw, m.status)) as WasfatyDispenseStatus) ?? 'cancelled' };
    },
    async submitClaim(claim) {
      const raw = await call('submitClaim', claim);
      const m = mappingFor('submitClaim');
      if (!m) return raw as Awaited<ReturnType<WasfatyProviderAdapter['submitClaim']>>;
      return {
        status: (text(readPath(raw, m.status)) as WasfatyClaim['status']) ?? 'submitted',
        reportedAmount: num(readPath(raw, m.reportedAmount)),
        varianceReason: text(readPath(raw, m.varianceReason)),
      };
    },
    async reconcileClaim(claim, input) {
      const raw = await call('reconcileClaim', { claim, ...input });
      const m = mappingFor('reconcileClaim');
      if (!m) return raw as Awaited<ReturnType<WasfatyProviderAdapter['reconcileClaim']>>;
      return {
        status: (text(readPath(raw, m.status)) as WasfatyClaim['status']) ?? 'reconciled',
        reportedAmount: num(readPath(raw, m.reportedAmount)),
        paidAmount: num(readPath(raw, m.paidAmount)),
        varianceReason: text(readPath(raw, m.varianceReason)),
      };
    },
  };
}

export interface ResolvedProvider {
  provider: WasfatyProviderAdapter;
  configured: boolean;
  contract: Awaited<ReturnType<typeof loadContract>>['info'];
}

// Resolves the active adapter on every request so a contract file dropped in later is picked up and
// a misconfigured live provider reports as unavailable instead of silently falling back to mock.
export async function resolveProvider(): Promise<ResolvedProvider> {
  const id = configuredProvider();
  const { file, info } = await loadContract();

  if (id === 'manual') return { provider: manualProvider, configured: true, contract: info };
  if (id === 'mock') return { provider: mockProvider, configured: true, contract: info };

  if (!isLiveContractUsable(file)) {
    throw unavailable(
      `Wasfaty provider "${id}" is selected but the contract is incomplete: ${
        info.missingOperations?.join(', ') || 'no contract file'
      }. Create server/data/wasfaty-contract.json (see Wasfaty-API.md) or set WASFATY_PROVIDER=manual.`,
    );
  }
  return { provider: liveProvider(id, file), configured: true, contract: info };
}

// Used by /health, which must answer even when the live adapter is unusable so Settings can explain
// exactly what is missing. Never throws.
export async function describeProvider(): Promise<{
  id: WasfatyProvider;
  configured: boolean;
  capabilities: WasfatyProviderAdapter['capabilities'];
  contract: Awaited<ReturnType<typeof loadContract>>['info'];
}> {
  const id = configuredProvider();
  const { file, info } = await loadContract();
  if (id === 'manual') {
    return { id, configured: true, capabilities: manualProvider.capabilities, contract: info };
  }
  if (id === 'mock') {
    return { id, configured: true, capabilities: mockProvider.capabilities, contract: info };
  }
  if (!isLiveContractUsable(file)) {
    return {
      id,
      configured: false,
      capabilities: {
        lookupPrescription: false,
        requestAuthorization: false,
        submitDispense: false,
        submitClaim: false,
      },
      contract: info,
    };
  }
  return { id, configured: true, capabilities: liveProvider(id, file).capabilities, contract: info };
}

// Exported for tests: construct a live adapter from an in-memory contract without touching env.
export function buildLiveProviderForTest(
  id: 'direct' | 'hub',
  file: WasfatyContractFile,
): WasfatyProviderAdapter {
  return liveProvider(id, file);
}

export type { WasfatySession };
