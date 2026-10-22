import { buildUnsignedInvoiceXml, embedSigningExtension } from '../ubl/buildInvoiceXml.js';
import type { UblInvoiceInput } from '../ubl/types.js';
import { canonicalizeXml } from '../xml/canonicalize.js';
import { sha256Buffer } from '../crypto/hash.js';
import { signHash } from '../crypto/sign.js';
import { publicKeyDerFromCert, certificateSignature } from '../crypto/x509.js';
import { buildPhase2Qr } from '../qr/buildQr.js';
import type { StoredCsid } from '../store/secureStore.js';

export interface SignedInvoice {
  signedXml: string;
  invoiceHashBase64: string;
  qrBase64: string;
}

export async function signInvoice(input: UblInvoiceInput, csid: StoredCsid): Promise<SignedInvoice> {
  const unsignedXml = buildUnsignedInvoiceXml(input);
  const canonical = canonicalizeXml(unsignedXml);
  const canonicalBytes = Buffer.from(canonical, 'utf8');
  // The 32-byte SHA256 digest - this is what goes in the QR (tag 6) and in the `invoiceHash`
  // field sent to ZATCA, NOT the raw XML bytes. An earlier version of this file passed the raw
  // canonical XML buffer directly into buildPhase2Qr()'s `invoiceHash` field, which meant the QR
  // ended up carrying the entire ~10KB invoice document instead of a 32-byte digest - caught via
  // a local smoke test producing a suspiciously large QR payload (see server/README.md).
  const invoiceDigest = sha256Buffer(canonicalBytes);
  const invoiceHashBase64 = invoiceDigest.toString('base64');

  // signHash() takes the ORIGINAL message, not the digest - createSign('SHA256') hashes it once
  // internally before signing. Passing invoiceDigest here instead would double-hash and produce a
  // signature ZATCA's verification (against SHA256(document)) would reject.
  const signature = signHash(csid.privateKeyPem, canonicalBytes);
  const publicKeyDer = publicKeyDerFromCert(csid.certificatePem);
  const certSig = certificateSignature(csid.certificatePem);

  const qrBase64 = buildPhase2Qr({
    sellerName: input.supplier.nameEn,
    vatRegistrationNo: input.supplier.vatNumber,
    isoTimestamp: input.issueDateTime.toISOString(),
    totalInclVat: totalInclVatOf(input),
    totalVatAmount: totalVatOf(input),
    invoiceHash: invoiceDigest,
    signature,
    publicKeyDer,
    certificateSignature: certSig,
  });

  const signedXml = embedSigningExtension(unsignedXml, {
    invoiceHashBase64,
    signatureBase64: signature.toString('base64'),
    certificatePem: csid.certificatePem,
    qrBase64,
  });

  return { signedXml, invoiceHashBase64, qrBase64 };
}

function totalVatOf(input: UblInvoiceInput): number {
  return round2(input.lines.reduce((s, l) => s + round2((l.qty * l.unitPrice - l.lineDiscountAmount) * l.vatRate), 0));
}

function totalInclVatOf(input: UblInvoiceInput): number {
  const net = round2(input.lines.reduce((s, l) => s + (l.qty * l.unitPrice - l.lineDiscountAmount), 0));
  return round2(net + totalVatOf(input));
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
