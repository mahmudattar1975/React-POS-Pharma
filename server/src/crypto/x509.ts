import { X509Certificate } from 'node:crypto';

interface DerTlv {
  tag: number;
  content: Buffer;
  end: number;
}

// Minimal DER TLV reader - just enough to walk a top-level X.509 `Certificate ::= SEQUENCE {
// tbsCertificate, signatureAlgorithm, signatureValue BIT STRING }` and pull out the raw signature
// bytes, which Node's X509Certificate class doesn't expose directly. Not a general ASN.1 parser.
function readTlv(buf: Buffer, offset: number): DerTlv {
  const tag = buf[offset];
  let lenByte = buf[offset + 1];
  let lenOfLen = 0;
  let length: number;
  if (lenByte & 0x80) {
    lenOfLen = lenByte & 0x7f;
    length = 0;
    for (let i = 0; i < lenOfLen; i++) length = (length << 8) | buf[offset + 2 + i];
  } else {
    length = lenByte;
  }
  const contentStart = offset + 2 + lenOfLen;
  const content = buf.subarray(contentStart, contentStart + length);
  return { tag, content, end: contentStart + length };
}

export function publicKeyDerFromCert(certPem: string): Buffer {
  const cert = new X509Certificate(certPem);
  return cert.publicKey.export({ type: 'spki', format: 'der' });
}

// QR tag 9 ("certificate signature") is the raw ECDSA signature bytes the Certificate Authority
// (ZATCA) put over the CSID certificate itself - i.e. the outer `signatureValue` field of the
// X.509 cert ZATCA returns from the CSID request, not anything we compute ourselves.
export function certificateSignature(certPem: string): Buffer {
  const cert = new X509Certificate(certPem);
  const der = cert.raw; // full DER-encoded certificate
  const outer = readTlv(der, 0); // Certificate SEQUENCE
  // Walk the three children of the outer SEQUENCE: tbsCertificate, signatureAlgorithm, signatureValue.
  let pos = 0;
  const tbs = readTlv(outer.content, pos);
  pos = tbs.end;
  const alg = readTlv(outer.content, pos);
  pos = alg.end;
  const sig = readTlv(outer.content, pos); // BIT STRING
  // BIT STRING content's first byte is the "unused bits" count (0 for DER-encoded signatures).
  return Buffer.from(sig.content.subarray(1));
}
