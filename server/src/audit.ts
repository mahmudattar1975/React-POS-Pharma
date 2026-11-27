// Append-only audit trail for actions with legal/financial consequences (SEC-10). It records WHO
// from the verified JWT, WHAT action and WHEN - never secrets, OTPs or patient data. The file is
// metadata-only and is opened in append mode so a crash cannot rewrite earlier evidence.
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request } from 'express';

export type AuditOutcome = 'attempt' | 'success' | 'failure' | 'denied';
export type AuditDetail = Record<string, string | number | boolean | null | undefined>;

const DEFAULT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'security-audit.jsonl');

function file(): string {
  // Tests point this at a temporary file; production uses the gitignored server/data directory.
  return process.env.SECURITY_AUDIT_FILE?.trim() || DEFAULT_FILE;
}

// Deny by key name so a future caller cannot accidentally log a confirmation phrase, OTP, key or
// patient identifier just by adding it to the detail object.
const SENSITIVE_KEY = /password|secret|token|otp|private|certificate|credential|confirmation|patient|prescription|serial|gtin/i;

function safeDetail(detail: AuditDetail): AuditDetail {
  const safe: AuditDetail = {};
  for (const [key, value] of Object.entries(detail)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (typeof value === 'string') safe[key] = value.slice(0, 200);
    else if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value;
    }
  }
  return safe;
}

export async function securityAudit(
  req: Request,
  action: string,
  outcome: AuditOutcome,
  detail: AuditDetail = {},
): Promise<void> {
  const principal = req.auth;
  const record = {
    at: new Date().toISOString(),
    action,
    outcome,
    actor: {
      cashierId: principal?.cashierId ?? 0,
      username: principal?.username ?? 'anonymous',
      fullName: principal?.fullName ?? '',
    },
    detail: safeDetail(detail),
  };
  const target = file();
  await mkdir(dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(record)}\n`, 'utf8');
}

// Record the attempt BEFORE the live action: if the append fails, the caller aborts and no fiscal
// movement is sent. Success/failure is recorded after; a failure there keeps the attempt evidence.
export async function audited<T>(
  req: Request,
  action: string,
  detail: AuditDetail,
  run: () => Promise<T>,
): Promise<T> {
  await securityAudit(req, action, 'attempt', detail);
  try {
    const result = await run();
    try {
      await securityAudit(req, action, 'success', detail);
    } catch (err) {
      // The action already happened; keep serving the result but surface the audit failure so it
      // can be alerted on. The attempt record still proves who initiated it.
      console.error('[audit] failed to record success:', err);
    }
    return result;
  } catch (err) {
    try {
      await securityAudit(req, action, 'failure', detail);
    } catch (auditErr) {
      console.error('[audit] failed to record failure:', auditErr);
    }
    throw err;
  }
}
