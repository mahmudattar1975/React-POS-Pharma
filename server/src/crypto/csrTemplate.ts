// Builds the OpenSSL config used to generate ZATCA's required CSR.
//
// CHECKED (2026-09-30) against ZATCA's OWN "Developer Portal User Manual" (section 5.3.1, the
// literal config-file screenshot on its page 81 - downloaded and read directly, not taken from a
// third party's summary). Two real findings from that pass:
//
// 1. CONFIRMED CORRECT, no change needed: this file's DN field set (C/OU/O/CN), alt_names field
//    set (SN/UID/title/registeredAddress/businessCategory), and the ASN.1 string type + template
//    name per environment all match ZATCA's own example exactly:
//      sandbox:    ASN1:UTF8String:TSTZATCA-Code-Signing
//      simulation: ASN1:PRINTABLESTRING:PREZATCA-Code-Signing
//      production: ASN1:PRINTABLESTRING:ZATCA-Code-Signing
//    (also independently confirmed by ZATCA's separate "Fatoora Portal User Manual", page 30.)
//
// 2. A tempting but WRONG change, caught by the local smoke test before it shipped: ZATCA's own
//    example declares certificateTemplateName as a SYMBOLIC name resolved through an `[OIDs]`
//    section (`oid_section = OIDs`, then `certificateTemplateName = 1.3.6.1.4.1.311.20.2` inside
//    it), rather than this file's raw-numeric-OID-as-key form. Switching to match ZATCA's literal
//    example was tried - it makes `openssl req -new` fail immediately on this machine's real
//    OpenSSL 3.5.7 with `OBJ_txt2obj:unknown object name ... name=certificateTemplateName` (i.e.
//    `oid_section` doesn't make OpenSSL 3.x's generic-extension parser accept the custom name
//    after all). ZATCA's own example also has other loose ends suggesting it's an illustrative
//    screenshot rather than a literally-tested config (a duplicated `req_extensions=` key, and an
//    `x509_extensions = v3_ca` pointing at a `[v3_ca]` section that doesn't exist anywhere in the
//    same example). Kept the raw-OID-as-key form below - confirmed by local smoke test to
//    generate a real, well-formed CSR for all three environments - since it's the one actually
//    proven to work, both locally just now and in the earlier live ZATCA simulation attempt that
//    got past this file's config entirely and reached ZATCA's own CSR content validator (see
//    server/README.md).
//
// STILL NOT LIVE-VALIDATED end-to-end: no real OTP was available to re-attempt onboarding after
// this pass (see server/README.md) - what's confirmed here is that CSR generation itself is
// correct and matches ZATCA's documented field set, not that the whole onboarding flow succeeds.
import { config } from '../config.js';

const CERT_TEMPLATE_OID = '1.3.6.1.4.1.311.20.2';

const CERT_TEMPLATE_BY_ENV: Record<'sandbox' | 'simulation' | 'production', string> = {
  sandbox: 'ASN1:UTF8String:TSTZATCA-Code-Signing',
  simulation: 'ASN1:PRINTABLESTRING:PREZATCA-Code-Signing',
  production: 'ASN1:PRINTABLESTRING:ZATCA-Code-Signing',
};

export interface CsrFields {
  commonName: string; // EGS/device identifier
  organizationUnit: string; // branch name
  organizationName: string; // taxpayer legal name
  country: string; // fixed 'SA'
  serialNumber: string; // "1-<solution>|2-<model>|3-<serial>"
  vatNumber: string; // UID
  invoiceType: string; // 4-digit flag string, e.g. "1100"
  location: string; // registeredAddress - branch city/address
  industry: string; // businessCategory
}

export function csrFieldsFromConfig(): CsrFields {
  return {
    commonName: config.csr.commonName,
    organizationUnit: config.csr.organizationUnit,
    organizationName: config.csr.organizationName,
    country: config.seller.country,
    serialNumber: config.csr.serialNumber,
    vatNumber: config.seller.vatNumber,
    invoiceType: config.csr.invoiceType,
    location: `${config.seller.city}, ${config.seller.district}`,
    industry: 'Pharmacy Retail',
  };
}

export function buildOpenSslConfig(f: CsrFields, envForZatca: 'sandbox' | 'simulation' | 'production'): string {
  const certTemplate = CERT_TEMPLATE_BY_ENV[envForZatca];

  return `[ req ]
default_bits = 256
distinguished_name = req_distinguished_name
req_extensions = req_ext
prompt = no
utf8 = no

[ req_distinguished_name ]
C = ${f.country}
OU = ${f.organizationUnit}
O = ${f.organizationName}
CN = ${f.commonName}

[ req_ext ]
subjectAltName = dirName:alt_names
${CERT_TEMPLATE_OID} = ${certTemplate}

[ alt_names ]
# registeredAddress is X.500-typed as PostalAddress, not a plain string - OpenSSL's built-in
# attribute-type inference for it rejected a plain string value here (confirmed via a local
# smoke test: "ASN1_mbstring_ncopy: string too short"), so it's forced to UTF8String explicitly.
# The other fields below use OpenSSL's default inference for their OIDs and haven't shown the
# same problem in that smoke test, but they were only exercised with the specific sample values in
# server/.env.example - re-verify if real onboarding data produces different string lengths/content.
SN = ${f.serialNumber}
UID = ${f.vatNumber}
title = ${f.invoiceType}
registeredAddress = UTF8:${f.location}
businessCategory = ${f.industry}
`;
}
