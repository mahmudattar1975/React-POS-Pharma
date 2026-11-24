import { createHash } from 'node:crypto';

export function sha256Buffer(data: string | Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

export function sha256Base64(data: string | Buffer): string {
  return sha256Buffer(data).toString('base64');
}

export function sha256Hex(data: string | Buffer): string {
  return sha256Buffer(data).toString('hex');
}
