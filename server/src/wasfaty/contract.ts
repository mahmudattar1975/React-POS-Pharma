// Contract loading for the live NUPCO adapters.
//
// The ONLY honest way to build a "direct"/"hub" connector before NUPCO onboarding supplies the real
// specification is to make the unknown explicit: the connector is driven by a contract file, and it
// refuses to act (rather than guessing a path) until every operation is present. The same file
// carries the field mapping needed if NUPCO's response envelope differs from our neutral shape.
//
// File location: WASFATY_CONTRACT_FILE, else server/data/wasfaty-contract.json. The file is optional
// for `manual`/`mock`. Tokens should be referenced through `auth.tokenEnv`; a literal `token` exists
// only for a local harness and is called out in the docs.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  WasfatyContractFile,
  WasfatyContractInfo,
  WasfatyOperationName,
  WasfatyProvider,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONTRACT_PATH = path.join(__dirname, '..', '..', 'data', 'wasfaty-contract.json');

export function configuredProvider(): WasfatyProvider {
  const raw = (process.env.WASFATY_PROVIDER ?? 'manual').trim().toLowerCase();
  return raw === 'mock' || raw === 'direct' || raw === 'hub' ? raw : 'manual';
}

export function configuredEnvironment(): string {
  return (process.env.WASFATY_ENV ?? 'sandbox').trim();
}

// Everything a live connector needs before it can be called at all. A missing operation is not a
// warning we can work around: calling a guessed path would be worse than refusing.
export const REQUIRED_LIVE_OPERATIONS: WasfatyOperationName[] = [
  'lookupPrescription',
  'requestAuthorization',
  'submitDispense',
  'cancelDispense',
  'submitClaim',
  'reconcileClaim',
];

let cached: { file: WasfatyContractFile; info: WasfatyContractInfo; mtimeMs: number } | null = null;

function contractPath(): string {
  return (process.env.WASFATY_CONTRACT_FILE ?? '').trim() || DEFAULT_CONTRACT_PATH;
}

export async function loadContract(): Promise<{
  file?: WasfatyContractFile;
  info: WasfatyContractInfo;
}> {
  const filePath = contractPath();
  try {
    const info = await stat(filePath);
    if (cached && cached.mtimeMs === info.mtimeMs) {
      return { file: cached.file, info: cached.info };
    }
    const text = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(text) as WasfatyContractFile;
    if (!parsed || typeof parsed !== 'object') throw new Error('Contract file must be a JSON object.');
    const missingOperations = missingOperationsOf(parsed);
    const contractInfo: WasfatyContractInfo = {
      source: 'file',
      path: filePath,
      version: parsed.version,
      baseUrl: parsed.baseUrl,
      environment: parsed.environment ?? configuredEnvironment(),
      missingOperations,
    };
    cached = { file: parsed, info: contractInfo, mtimeMs: info.mtimeMs };
    return { file: parsed, info: contractInfo };
  } catch {
    // Missing file is normal for Phase 0. Do not cache the miss, so dropping the contract in later
    // takes effect without a server restart.
    return {
      info: {
        source: 'none',
        path: filePath,
        environment: configuredEnvironment(),
        missingOperations: REQUIRED_LIVE_OPERATIONS.slice(),
      },
    };
  }
}

export function missingOperationsOf(file: WasfatyContractFile): string[] {
  const supplied = file.operations ?? {};
  const missing: string[] = REQUIRED_LIVE_OPERATIONS.filter((name) => !supplied[name]);
  if (!file.baseUrl) missing.unshift('baseUrl');
  return missing;
}

// A live adapter is usable only when the file exists AND every required operation is defined.
export function isLiveContractUsable(file: WasfatyContractFile | undefined): file is WasfatyContractFile {
  return !!file && !!file.baseUrl && missingOperationsOf(file).length === 0;
}
