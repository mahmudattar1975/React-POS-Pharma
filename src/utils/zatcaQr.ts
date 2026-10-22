// ZATCA (Fatoora) simplified-invoice QR payload: 5 TLV (tag-length-value) fields, concatenated as
// raw bytes and base64-encoded - this exact base64 string is what gets rendered into the QR code.
// This covers the Phase 1 minimum (seller name, VAT number, timestamp, totals), which is what a
// simplified (B2C) invoice must always carry. Phase 2 additionally requires the invoice to be
// cryptographically stamped by ZATCA-issued keys (CSID) and reported to ZATCA's API in real time -
// that needs a backend holding the private key material, which this frontend-only app doesn't have.
// generateInvoiceQr() is written so a future backend call can slot in and extend/replace this payload
// (e.g. tags 6-9 for the cryptographic stamp, hash and signature) without changing call sites.

function tlv(tag: number, value: string): Uint8Array {
  const valueBytes = new TextEncoder().encode(value);
  const out = new Uint8Array(2 + valueBytes.length);
  out[0] = tag;
  out[1] = valueBytes.length;
  out.set(valueBytes, 2);
  return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface ZatcaQrInput {
  sellerName: string;
  vatRegistrationNo: string;
  isoTimestamp: string; // e.g. new Date().toISOString()
  totalInclVat: number;
  totalVatAmount: number;
}

export function generateInvoiceQr(input: ZatcaQrInput): string {
  const chunks = [
    tlv(1, input.sellerName),
    tlv(2, input.vatRegistrationNo),
    tlv(3, input.isoTimestamp),
    tlv(4, input.totalInclVat.toFixed(2)),
    tlv(5, input.totalVatAmount.toFixed(2)),
  ];
  return bytesToBase64(concatBytes(chunks));
}
