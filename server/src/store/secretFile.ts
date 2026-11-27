// Encrypted-at-rest JSON helper for the small server-side state files that contain CSID private key
// material and RSD credentials (SEC-09).
//
// Threat model: someone reads/copies `server/data/*.json` from disk or a backup. With a configured
// key they get only an AES-256-GCM ciphertext with a random IV per write and an authentication tag.
// This does NOT protect against a compromised running process, a keylogger, or an attacker who can
// read both the file and SECURE_STORE_KEY; a real HSM/KMS would be needed for that.
//
// Key source: `SECURE_STORE_KEY`, either base64 of exactly 32 random bytes (recommended) or 64 hex
// characters. Missing key fails closed when NODE_ENV=production; outside production the legacy
// plaintext JSON workflow is preserved so local development keeps working unchanged. A plaintext
// file is accepted and atomically rewritten as an envelope the first time it is read with a key.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
// Binds the ciphertext to this file format so a blob from another use cannot be replayed here.
const AAD = Buffer.from('pharmacy-app:secret-file:v1', 'utf8');

export interface SecretFileEnvelope {
  v: 1;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
}

export type SecretStoreErrorCode =
  | 'missing_secret_store_key'
  | 'invalid_secret_store_key'
  | 'invalid_secret_file'
  | 'unsupported_secret_file'
  | 'secret_file_decryption_failed';

export class SecretStoreError extends Error {
  constructor(
    public readonly code: SecretStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SecretStoreError';
  }
}

function currentKey(): Buffer | null {
  const raw = process.env.SECURE_STORE_KEY?.trim();
  if (raw) {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
      const key = Buffer.from(raw, 'base64');
      if (key.length === 32 && key.toString('base64') === raw) return key;
    }
    // Never include the supplied value in the message: it may be a near-miss real key.
    throw new SecretStoreError(
      'invalid_secret_store_key',
      'SECURE_STORE_KEY must be a base64-encoded 32-byte key or 64 hex characters.',
    );
  }
  if (process.env.NODE_ENV === 'production') {
    throw new SecretStoreError(
      'missing_secret_store_key',
      'SECURE_STORE_KEY is required in production.',
    );
  }
  return null;
}

// Startup validation: a production process must not accept HTTP traffic before this passes.
export function assertSecretStoreConfigured(): void {
  currentKey();
}

function decodeBase64(value: unknown, field: string, expectedBytes?: number): Buffer {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new SecretStoreError('invalid_secret_file', `Secret file has an invalid ${field}.`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value ||
      (expectedBytes !== undefined && decoded.length !== expectedBytes)) {
    throw new SecretStoreError('invalid_secret_file', `Secret file has an invalid ${field}.`);
  }
  return decoded;
}

function isEnvelope(value: unknown): value is SecretFileEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.v === VERSION &&
    candidate.alg === ALGORITHM &&
    typeof candidate.iv === 'string' &&
    typeof candidate.tag === 'string' &&
    typeof candidate.data === 'string';
}

// A partially written or newer envelope must fail closed rather than being treated as state JSON.
function looksLikeEnvelope(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return ['v', 'alg', 'iv', 'tag', 'data'].some((key) => key in candidate);
}

function encrypt(value: unknown, key: Buffer): SecretFileEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(AAD);
  const plaintext = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    v: VERSION,
    alg: ALGORITHM,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decrypt(envelope: SecretFileEnvelope, key: Buffer): unknown {
  if (envelope.v !== VERSION || envelope.alg !== ALGORITHM) {
    throw new SecretStoreError(
      'unsupported_secret_file',
      'Secret file uses an unsupported encrypted format.',
    );
  }
  const iv = decodeBase64(envelope.iv, 'iv', 12);
  const tag = decodeBase64(envelope.tag, 'tag', 16);
  const data = decodeBase64(envelope.data, 'data');
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    // Do not echo the raw crypto/JSON error: it can expose format details but not help an operator.
    throw new SecretStoreError(
      'secret_file_decryption_failed',
      'Unable to decrypt the secret file. Check SECURE_STORE_KEY and the file integrity.',
    );
  }
}

function isMissingFile(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export async function readSecretJson<T>(file: string): Promise<T | null> {
  const key = currentKey();
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (isMissingFile(err)) return null;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SecretStoreError('invalid_secret_file', 'Secret file is not valid JSON.');
  }

  if (isEnvelope(parsed)) {
    if (!key) {
      throw new SecretStoreError(
        'missing_secret_store_key',
        'SECURE_STORE_KEY is required to read an encrypted secret file.',
      );
    }
    return decrypt(parsed, key) as T;
  }
  if (looksLikeEnvelope(parsed)) {
    throw new SecretStoreError(
      'unsupported_secret_file',
      'Secret file uses an unsupported encrypted format.',
    );
  }
  if (key) await writeSecretJson(file, parsed); // one-time legacy plaintext migration
  return parsed as T;
}

// Write via a same-directory temp file and rename: a crash cannot leave a half-written JSON/state
// file that would lose the invoice chain or an RSD credential. Mode 0600 is explicit for POSIX;
// Windows ACLs still depend on the account running the service.
export async function writeSecretJson<T>(file: string, value: T): Promise<void> {
  const key = currentKey();
  const directory = dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const body = key
    ? JSON.stringify(encrypt(value, key), null, 2)
    : JSON.stringify(value, null, 2);
  const temporary = join(directory, `.${basename(file)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${body}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } catch (err) {
    await rm(temporary, { force: true });
    throw err;
  }
}
