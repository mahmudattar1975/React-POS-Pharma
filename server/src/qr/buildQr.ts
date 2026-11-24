// ZATCA Phase 2 QR payload: same 5 TLV fields as Phase 1 (seller name, VAT number, timestamp,
// total, VAT total) PLUS four more required once cryptographic stamping is in play: the invoice
// hash, the ECDSA signature over it, the CSID's public key, and the certificate signature (the
// CA/ZATCA's own signature over the CSID certificate). All nine are concatenated TLV, base64'd.
function tlv(tag: number, value: Buffer | string): Buffer {
  const valueBuf = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  const header = Buffer.from([tag, valueBuf.length]);
  return Buffer.concat([header, valueBuf]);
}

export interface Phase2QrInput {
  sellerName: string;
  vatRegistrationNo: string;
  isoTimestamp: string;
  totalInclVat: number;
  totalVatAmount: number;
  invoiceHash: Buffer; // sha256 of the canonicalized invoice XML
  signature: Buffer; // ECDSA signature over the invoice hash
  publicKeyDer: Buffer; // CSID public key, SPKI DER
  certificateSignature: Buffer; // ZATCA/CA's signature over the CSID certificate
}

export function buildPhase2Qr(input: Phase2QrInput): string {
  const chunks = [
    tlv(1, input.sellerName),
    tlv(2, input.vatRegistrationNo),
    tlv(3, input.isoTimestamp),
    tlv(4, input.totalInclVat.toFixed(2)),
    tlv(5, input.totalVatAmount.toFixed(2)),
    tlv(6, input.invoiceHash),
    tlv(7, input.signature),
    tlv(8, input.publicKeyDer),
    tlv(9, input.certificateSignature),
  ];
  return Buffer.concat(chunks).toString('base64');
}
