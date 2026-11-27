import type { Response } from 'express';

// Shared validation for the four Item Masters write endpoints. Codes are assigned by the server on
// create and never changed on update, so a row keeps the stable key other terminals already have.
export class MasterInputError extends Error {}

export interface MasterWriteInput {
  code?: string;
  nameAr: string;
  nameEn: string;
  isActive?: boolean;
  parentCategoryId?: number | null;
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new MasterInputError(`${label} is required.`);
  const text = value.trim();
  if (text.length > max) throw new MasterInputError(`${label} must be ${max} characters or fewer.`);
  return text;
}

export function parseMasterWrite(body: unknown): MasterWriteInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new MasterInputError('Expected a JSON object.');
  }
  const b = body as Record<string, unknown>;
  const input: MasterWriteInput = {
    nameEn: requiredText(b.nameEn, 'English name', 150),
    nameAr: requiredText(b.nameAr, 'Arabic name', 150),
  };
  if (b.code !== undefined && b.code !== null && String(b.code).trim() !== '') {
    input.code = requiredText(b.code, 'Code', 50);
  }
  if (b.isActive !== undefined) {
    if (typeof b.isActive !== 'boolean') throw new MasterInputError('Active must be true or false.');
    input.isActive = b.isActive;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'parentCategoryId')) {
    const raw = b.parentCategoryId;
    if (raw === null || raw === '') input.parentCategoryId = null;
    else if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) input.parentCategoryId = raw;
    else throw new MasterInputError('Parent category must be a positive whole number or null.');
  }
  return input;
}

export function parseMasterId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new MasterInputError('Invalid master id.');
  return id;
}

// Deterministic next code from the highest numeric suffix already in use. Prefixes differ per
// master, so a newly created row can never collide with a seeded one.
export function nextMasterCode(codes: string[], prefix: string, width: number): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const code of codes) {
    const match = pattern.exec(code.trim());
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

function isUniqueConflict(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === 'P2002';
}

export function masterErrorResponse(res: Response, err: unknown): void {
  if (err instanceof MasterInputError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (isUniqueConflict(err)) {
    res.status(409).json({ error: 'That code is already used by another row.' });
    return;
  }
  if (err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === 'P2025') {
    res.status(404).json({ error: 'That master row no longer exists. Refresh and try again.' });
    return;
  }
  res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
}
