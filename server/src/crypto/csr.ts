import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildOpenSslConfig, type CsrFields } from './csrTemplate.js';

const execFileAsync = promisify(execFile);

export interface GeneratedCsr {
  privateKeyPem: string;
  csrPem: string;
}

// ZATCA requires the CSR's key to be on the secp256k1 curve. Shells out to the system's openssl
// (present on this dev machine via Git for Windows / mingw64) rather than hand-rolling ASN.1 for a
// PKCS#10 request in Node - CSR generation is exactly the kind of thing worth using a
// battle-tested tool for rather than reimplementing.
export async function generateCsr(fields: CsrFields, envForZatca: 'sandbox' | 'simulation' | 'production'): Promise<GeneratedCsr> {
  const dir = await mkdtemp(path.join(tmpdir(), 'zatca-csr-'));
  const keyPath = path.join(dir, 'private.pem');
  const csrPath = path.join(dir, 'request.csr');
  const cnfPath = path.join(dir, 'csr.cnf');

  try {
    await writeFile(cnfPath, buildOpenSslConfig(fields, envForZatca), 'utf8');

    await execFileAsync('openssl', ['ecparam', '-name', 'secp256k1', '-genkey', '-noout', '-out', keyPath]);
    await execFileAsync('openssl', [
      'req', '-new',
      '-key', keyPath,
      '-config', cnfPath,
      '-out', csrPath,
      '-sha256',
    ]);

    const [privateKeyPem, csrPem] = await Promise.all([readFile(keyPath, 'utf8'), readFile(csrPath, 'utf8')]);
    return { privateKeyPem, csrPem };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function csrPemToBase64(csrPem: string): string {
  const body = csrPem
    .replace('-----BEGIN CERTIFICATE REQUEST-----', '')
    .replace('-----END CERTIFICATE REQUEST-----', '')
    .replace(/\s+/g, '');
  return body;
}
