import { createSign, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

// ECDSA-SHA256 signature over the invoice hash, using the CSID's secp256k1 private key - this IS
// the "cryptographic stamp" ZATCA Phase 2 requires embedded in the invoice XML and QR (tag 7).
export function signHash(privateKeyPem: string, dataToSign: Buffer): Buffer {
  const key: KeyObject = createPrivateKey(privateKeyPem);
  const signer = createSign('SHA256');
  signer.update(dataToSign);
  signer.end();
  return signer.sign(key); // DER-encoded ECDSA signature, as ZATCA expects
}

// Raw public key bytes (uncompressed point, DER SubjectPublicKeyInfo) for QR tag 8. ZATCA issues
// the certificate back from the CSID request, but the public key can also be re-derived from the
// private key we generated - kept as a fallback / cross-check.
export function publicKeyDerFromPrivate(privateKeyPem: string): Buffer {
  const priv = createPrivateKey(privateKeyPem);
  const pub = createPublicKey(priv);
  return pub.export({ type: 'spki', format: 'der' });
}
