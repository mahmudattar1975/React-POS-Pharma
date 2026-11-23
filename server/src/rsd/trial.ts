// Credentialed RSD trial harness.
//
//   npm run rsd:trial                    # full offline suite against the built-in mock
//   npm run rsd:trial -- --probe         # WSDL/connectivity probe only (no movements)
//   npm run rsd:trial -- --unit 0628...:SN:BATCH:2027-05-31
//                                        # live sale + duplicate + cancel on ONE real unit
//   npm run rsd:trial -- --unit ... --yes
//                                        # required in addition when RSD_ENV=production
//   npm run rsd:trial -- --unit ... --yes --retry-rejected
//                                        # reopen a rejection caused by the account, then retry
//
// The live flow deliberately does NOT test unknown units or wrong batches: every such attempt is
// a real operation against SFDA. Those cases are covered by the mock suite and by the unit tests.
//
// Evidence is written to server/data/rsd-trial-<timestamp>.json (gitignored). Credentials are
// never written to it; the GLN is masked.
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getRsdConfig, hasRsdAuth, hasRsdCredentials } from './config.js';
import type { RsdEnvironment, RsdMode, RsdReportResult, RsdUnit } from './types.js';
import {
  acceptMockUnit,
  getStatus,
  reopenRejected,
  reportCancel,
  reportSale,
  resetMock,
} from './service.js';
import { probeWsdl, type WsdlProbeResult } from './soapClient.js';
import { isSuccessRc } from './wire.js';

interface StepResult {
  name: string;
  status: 'pass' | 'fail';
  detail: string;
  durationMs: number;
}

interface TrialEvidence {
  tool: 'rsd-trial';
  startedAt: string;
  finishedAt: string;
  mode: RsdMode;
  environment: RsdEnvironment;
  glnMasked: string | null;
  saleUrl: string;
  cancelUrl: string;
  unit?: { gtin: string; serialNo: string; batchNo: string; expiryDate: string };
  probes?: { sale?: ProbeEvidence; cancel?: ProbeEvidence };
  wsdlFiles?: string[];
  steps: StepResult[];
  ledger: Awaited<ReturnType<typeof getStatus>>['ledger'];
  result: 'pass' | 'fail';
}

interface ProbeEvidence {
  url: string;
  httpStatus: number | null;
  contentType?: string;
  bytes: number;
  operations: string[];
  networkError?: string;
  snippet?: string;
}

interface Options {
  probe: boolean;
  yes: boolean;
  retryRejected: boolean;
  unit?: RsdUnit;
  out?: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { probe: false, yes: false, retryRejected: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--probe') options.probe = true;
    else if (arg === '--yes') options.yes = true;
    else if (arg === '--retry-rejected') options.retryRejected = true;
    else if (arg === '--unit') {
      const raw = argv[++i] ?? '';
      const [gtin, serialNo, batchNo, expiryDate] = raw.split(':');
      if (!gtin || !serialNo || !batchNo || !expiryDate) {
        throw new Error('--unit must be gtin:serialNo:batchNo:YYYY-MM-DD');
      }
      options.unit = { gtin, serialNo, batchNo, expiryDate: expandGs1Expiry(expiryDate) };
    } else if (arg === '--out') {
      options.out = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log('See the header of src/rsd/trial.ts for usage.');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

// A DataMatrix stores expiry as YYMMDD; operators copy that straight from the label. Convert it to
// the xs:date the service needs, so "271231" means 2027-12-31 rather than a rejected request.
function expandGs1Expiry(value: string): string {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(value.trim());
  return match ? `20${match[1]}-${match[2]}-${match[3]}` : value.trim();
}

function maskGln(gln: string): string | null {
  if (!gln) return null;
  return gln.length <= 4 ? '****' : `${'*'.repeat(Math.max(0, gln.length - 4))}${gln.slice(-4)}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runId(): string {
  return Date.now().toString(36).toUpperCase().slice(-6);
}

async function step(
  steps: StepResult[],
  name: string,
  fn: () => Promise<string>,
): Promise<void> {
  const started = Date.now();
  try {
    const detail = await fn();
    steps.push({ name, status: 'pass', detail, durationMs: Date.now() - started });
  } catch (err) {
    steps.push({
      name,
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    });
  }
}

function saleSummary(result: RsdReportResult): string {
  const { record } = result;
  return `${result.outcome} (${record.id}, RC ${record.rc ?? 'n/a'}, attempts ${record.attempts.length})`;
}

function probeEvidence(probe: WsdlProbeResult): ProbeEvidence {
  return {
    url: probe.url,
    httpStatus: probe.httpStatus,
    contentType: probe.contentType,
    bytes: probe.bytes,
    operations: probe.operations,
    networkError: probe.networkError,
    // Only surface a snippet when the probe failed; a healthy WSDL is large and not useful here.
    snippet: probe.httpStatus && probe.httpStatus >= 200 && probe.httpStatus < 300 ? undefined : probe.snippet,
  };
}

// Keep the real WSDL on disk (gitignored) so the cancel request schema can be checked against the
// envelope we build before any sale/cancel movement is sent.
async function saveWsdl(kind: 'sale' | 'cancel', body: string | undefined): Promise<string | undefined> {
  if (!body) return undefined;
  const file = path.resolve(
    process.cwd(),
    'data',
    `rsd-wsdl-${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}.xml`,
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body, 'utf8');
  return file;
}

// Offline suite: every rule the live flow cannot safely test (unknown unit, wrong batch, retryable
// infrastructure failure, cancel ordering) is exercised here against the mock state machine.
async function runMock(steps: StepResult[]): Promise<void> {
  const run = runId();
  const gtin = '06281007320021';
  const good: RsdUnit = {
    gtin,
    serialNo: `T${run}A`,
    batchNo: 'AX24C09',
    expiryDate: '2027-05-31',
  };
  const batchUnit: RsdUnit = {
    gtin,
    serialNo: `T${run}B`,
    batchNo: 'BATCH-B',
    expiryDate: '2027-06-30',
  };
  const unknown: RsdUnit = {
    gtin,
    serialNo: `T${run}C`,
    batchNo: 'BATCH-C',
    expiryDate: '2027-07-31',
  };
  const neverSold: RsdUnit = {
    gtin,
    serialNo: `T${run}E`,
    batchNo: 'BATCH-E',
    expiryDate: '2027-09-30',
  };
  const flaky: RsdUnit = {
    gtin,
    serialNo: `HTTP500-${run}D`,
    batchNo: 'BATCH-D',
    expiryDate: '2027-08-31',
  };

  await step(steps, 'mock reset', async () => {
    await resetMock();
    return 'mock inventory and sales cleared';
  });

  await step(steps, 'mock accept sellable units', async () => {
    for (const unit of [good, batchUnit, flaky]) {
      const result = await acceptMockUnit(unit);
      assert(result.accepted, `unit ${unit.serialNo} was not accepted`);
    }
    return `accepted ${good.serialNo}, ${batchUnit.serialNo}, ${flaky.serialNo}`;
  });

  let saleAttempts = 0;
  await step(steps, 'sale accepted', async () => {
    const result = await reportSale(good);
    saleAttempts = result.record.attempts.length;
    assert(result.outcome === 'sent', `expected sent, got ${result.outcome}`);
    assert(isSuccessRc(result.record.rc), `expected RC 00000, got ${result.record.rc}`);
    return saleSummary(result);
  });

  await step(steps, 'duplicate sale is not sent twice', async () => {
    const result = await reportSale(good);
    assert(result.outcome === 'already_reported', `expected already_reported, got ${result.outcome}`);
    assert(
      result.record.attempts.length === saleAttempts,
      `a duplicate added an attempt (${saleAttempts} -> ${result.record.attempts.length})`,
    );
    return `${saleSummary(result)}; no new network attempt`;
  });

  await step(steps, 'wrong batch is rejected (11036)', async () => {
    const result = await reportSale({ ...batchUnit, batchNo: 'WRONG-BATCH' });
    assert(result.outcome === 'rejected', `expected rejected, got ${result.outcome}`);
    assert(result.record.retryable === false, 'a business rejection must not be retryable');
    assert(result.record.rc === '11036', `expected RC 11036, got ${result.record.rc}`);
    return saleSummary(result);
  });

  await step(steps, 'unit outside RSD inventory is rejected (11043)', async () => {
    const result = await reportSale(unknown);
    assert(result.outcome === 'rejected', `expected rejected, got ${result.outcome}`);
    assert(result.record.rc === '11043', `expected RC 11043, got ${result.record.rc}`);
    return saleSummary(result);
  });

  await step(steps, 'cancel accepted', async () => {
    const result = await reportCancel(good);
    assert(result.outcome === 'sent', `expected sent, got ${result.outcome}`);
    assert(isSuccessRc(result.record.rc), `expected RC 00000, got ${result.record.rc}`);
    return saleSummary(result);
  });

  await step(steps, 'duplicate cancel is not sent twice', async () => {
    const before = await getStatus();
    const result = await reportCancel(good);
    assert(result.outcome === 'already_cancelled', `expected already_cancelled, got ${result.outcome}`);
    const after = await getStatus();
    assert(
      after.ledger.cancelsSent === before.ledger.cancelsSent,
      'a duplicate cancel created another accepted cancel',
    );
    return `${saleSummary(result)}; no new accepted cancel`;
  });

  await step(steps, 'cancel without a sale is refused locally', async () => {
    try {
      await reportCancel(neverSold);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assert(/no sale record/i.test(message), `unexpected error: ${message}`);
      return `refused before any network call: ${message}`;
    }
    throw new Error('cancel of an unsold unit was not refused');
  });

  await step(steps, 'HTTP 500 is retryable and retries append attempts', async () => {
    const first = await reportSale(flaky);
    assert(first.outcome === 'failed', `expected failed, got ${first.outcome}`);
    assert(first.record.retryable, 'an HTTP 500 must be retryable');
    const second = await reportSale(flaky);
    assert(second.record.id === first.record.id, 'a retry created a second sale record');
    assert(
      second.record.attempts.length === first.record.attempts.length + 1,
      `expected one extra attempt, got ${first.record.attempts.length} -> ${second.record.attempts.length}`,
    );
    return `${saleSummary(second)}; same record, attempts appended`;
  });
}

async function runLive(
  steps: StepResult[],
  unit: RsdUnit | undefined,
  probes: { sale?: ProbeEvidence; cancel?: ProbeEvidence },
  wsdlFiles: string[],
  probeOnly: boolean,
): Promise<void> {
  const config = getRsdConfig();
  const creds = { gln: config.gln, username: config.username, password: config.password };

  await step(steps, 'probe sale WSDL', async () => {
    const probe = await probeWsdl(config.saleUrl, creds, config.timeoutMs);
    probes.sale = probeEvidence(probe);
    assert(
      probe.httpStatus === 200 && probe.bytes > 0,
      `sale WSDL probe failed: HTTP ${probe.httpStatus ?? 'n/a'} ${probe.networkError ?? ''}`.trim(),
    );
    const file = await saveWsdl('sale', probe.body);
    if (file) wsdlFiles.push(file);
    return `HTTP ${probe.httpStatus}, ${probe.bytes} bytes, operations: ${probe.operations.join(', ') || 'none detected'}${file ? `, saved ${path.basename(file)}` : ''}`;
  });

  await step(steps, 'probe cancel WSDL', async () => {
    const probe = await probeWsdl(config.cancelUrl, creds, config.timeoutMs);
    probes.cancel = probeEvidence(probe);
    assert(
      probe.httpStatus === 200 && probe.bytes > 0,
      `cancel WSDL probe failed: HTTP ${probe.httpStatus ?? 'n/a'} ${probe.networkError ?? ''}`.trim(),
    );
    const file = await saveWsdl('cancel', probe.body);
    if (file) wsdlFiles.push(file);
    return `HTTP ${probe.httpStatus}, ${probe.bytes} bytes, operations: ${probe.operations.join(', ') || 'none detected'}${file ? `, saved ${path.basename(file)}` : ''}`;
  });

  if (probeOnly) return;

  const liveUnit = unit as RsdUnit;
  let saleAttempts = 0;
  let saleSent = false;
  await step(steps, 'live sale', async () => {
    const result = await reportSale(liveUnit);
    saleAttempts = result.record.attempts.length;
    if (result.outcome !== 'sent') {
      throw new Error(
        `expected sent, got ${result.outcome} (RC ${result.record.rc ?? 'n/a'}): ${result.message ?? ''}`,
      );
    }
    saleSent = true;
    return saleSummary(result);
  });

  // A rejected sale means the unit is not in this GLN's RSD inventory (or the data is wrong).
  // Nothing was moved, so there is nothing to duplicate or cancel - stop instead of turning one
  // clear rejection into a cascade of failures.
  if (!saleSent) return;

  await step(steps, 'duplicate live sale is not re-sent', async () => {
    const result = await reportSale(liveUnit);
    assert(result.outcome === 'already_reported', `expected already_reported, got ${result.outcome}`);
    assert(
      result.record.attempts.length === saleAttempts,
      `a duplicate added an attempt (${saleAttempts} -> ${result.record.attempts.length})`,
    );
    return `${saleSummary(result)}; no new network attempt`;
  });

  let cancelSent = false;
  await step(steps, 'live cancel', async () => {
    const result = await reportCancel(liveUnit);
    if (result.outcome !== 'sent') {
      throw new Error(
        `expected sent, got ${result.outcome} (RC ${result.record.rc ?? 'n/a'}): ${result.message ?? ''}`,
      );
    }
    cancelSent = true;
    return saleSummary(result);
  });

  // Never re-send a cancel just to prove idempotency: if the reversal failed, the operator must
  // stop and open an SFDA ticket, not fire another production movement.
  if (!cancelSent) return;

  await step(steps, 'duplicate live cancel is not re-sent', async () => {
    const result = await reportCancel(liveUnit);
    assert(result.outcome === 'already_cancelled', `expected already_cancelled, got ${result.outcome}`);
    return `${saleSummary(result)}; no new accepted cancel`;
  });
}

async function writeEvidence(evidence: TrialEvidence, out?: string): Promise<string> {
  const file =
    out ??
    path.resolve(
      process.cwd(),
      'data',
      `rsd-trial-${evidence.startedAt.replace(/[:.]/g, '-')}.json`,
    );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(evidence, null, 2), 'utf8');
  return file;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = getRsdConfig();
  const startedAt = new Date().toISOString();

  if (config.mode === 'live') {
    // A WSDL probe only needs HTTP Basic credentials. A sale/cancel additionally needs the GLN
    // that owns the inventory being reported against.
    const credentialsReady = options.probe
      ? hasRsdAuth(config.environment)
      : hasRsdCredentials(config.environment);
    if (!credentialsReady) {
      throw new Error(
        `RSD_MODE=live but ${config.environment} credentials are missing from server/.env.`,
      );
    }
    if (!config.saleUrl || !config.cancelUrl) {
      throw new Error(
        `RSD_MODE=live but the ${config.environment} service URLs are missing. ` +
          'Set RSD_TEST_SALE_URL / RSD_TEST_CANCEL_URL (or the PROD equivalents).',
      );
    }
    if (
      config.environment === 'production' &&
      (!config.saleUrl.startsWith('https://') || !config.cancelUrl.startsWith('https://'))
    ) {
      throw new Error('Production RSD endpoints must use https://; refusing plain HTTP.');
    }
    if (config.environment === 'production' && !options.yes) {
      throw new Error(
        'Refusing to touch production without --yes. Every sale/cancel here is a real national movement.',
      );
    }
    if (!options.probe && !options.unit) {
      throw new Error('Live trial needs --unit gtin:serialNo:batchNo:YYYY-MM-DD (or --probe).');
    }
  }

  const steps: StepResult[] = [];
  const probes: { sale?: ProbeEvidence; cancel?: ProbeEvidence } = {};
  const wsdlFiles: string[] = [];
  if (config.mode === 'mock') {
    await runMock(steps);
  } else {
    // An explicit operator decision: the rejection was an account/configuration problem, not bad
    // unit data, so the same payload may be sent again after the fix. Attempts stay in the ledger.
    if (options.retryRejected && options.unit) {
      const sale = await reopenRejected('sale', options.unit.gtin, options.unit.serialNo);
      const cancel = await reopenRejected('cancel', options.unit.gtin, options.unit.serialNo);
      console.log(
        `reopened rejected records: sale=${sale?.status ?? 'none'}, cancel=${cancel?.status ?? 'none'}`,
      );
    }
    await runLive(steps, options.unit, probes, wsdlFiles, options.probe || !options.unit);
  }

  const status = await getStatus();
  const evidence: TrialEvidence = {
    tool: 'rsd-trial',
    startedAt,
    finishedAt: new Date().toISOString(),
    mode: config.mode,
    environment: config.environment,
    glnMasked: maskGln(config.gln),
    saleUrl: config.saleUrl,
    cancelUrl: config.cancelUrl,
    unit: options.unit,
    probes: probes.sale || probes.cancel ? probes : undefined,
    wsdlFiles: wsdlFiles.length > 0 ? wsdlFiles : undefined,
    steps,
    ledger: status.ledger,
    result: steps.every((s) => s.status === 'pass') ? 'pass' : 'fail',
  };

  const file = await writeEvidence(evidence, options.out);
  for (const s of steps) {
    console.log(`${s.status === 'pass' ? 'PASS' : 'FAIL'}  ${s.name} - ${s.detail}`);
  }
  console.log(`\n${evidence.result.toUpperCase()}  evidence: ${file}`);
  if (evidence.result === 'fail') process.exitCode = 1;
}

main().catch((err) => {
  console.error(`RSD trial failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
