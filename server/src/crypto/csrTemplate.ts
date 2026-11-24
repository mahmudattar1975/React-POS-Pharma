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
// LIVE FINDING (2026-11-23): the earlier `registeredAddress = UTF8:...` workaround was wrong.
// Decoding the generated CSR with `openssl asn1parse` showed the literal characters "UTF8:" inside
// the UTF8String value (0C 06 55 54 46 38 3A ...), i.e. ZATCA was being sent "UTF8:الدمام..." as
// the registered address. A plain value is encoded as a UTF8String correctly even with Arabic text,
// so it is used now. The full registered address (street/district/city/postal code) is sent too,
// not just city + district. Live acceptance is still unverified: a corrected CSR and a CSR built
// from a published library's known-good sample values both returned Invalid-CSR when retried with
// the same one-time OTP (which may have been consumed by the first attempt).
import { deriveIdentity, type ZatcaIdentity } from '../store/identity.js';

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

// Built from the SAME stored seller/device identity that the signed UBL document uses (see
// store/identity.ts), so the certificate ZATCA issues and the invoices signed under it describe one
// business, one device - not two independently-edited copies of the truth.
export function csrFieldsFromIdentity(identity: ZatcaIdentity): CsrFields {
  const derived = deriveIdentity(identity.device);
  const { seller, device } = identity;
  return {
    commonName: derived.commonName,
    organizationUnit: seller.organizationUnit,
    organizationName: seller.nameEn,
    country: seller.country,
    serialNumber: derived.egsSerialNumber,
    vatNumber: seller.vatNumber,
    invoiceType: device.invoiceType,
    // ZATCA's registeredAddress is the business's full registered address, not just its city.
    // Include every address component the Settings form collects so the CSR describes the same
    // legal entity as the commercial registration.
    location: [seller.street, seller.district, seller.city, seller.postalCode, seller.country]
      .filter(Boolean)
      .join(', '),
    industry: seller.industry,
  };
}

// OpenSSL config treats `#` as a comment and `=` as a key/value separator; a legal entity name or
// address containing either would silently truncate the CSR field (or the whole config line).
// Escaping backslashes first also prevents an injected `\n` from escaping into a new section.
function configValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, ' ')
    .replace(/#/g, '\\#')
    .replace(/=/g, '\\=');
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
C = ${configValue(f.country)}
OU = ${configValue(f.organizationUnit)}
O = ${configValue(f.organizationName)}
CN = ${configValue(f.commonName)}

[ req_ext ]
subjectAltName = dirName:alt_names
${CERT_TEMPLATE_OID} = ${certTemplate}

[ alt_names ]
# A plain value here is encoded as a UTF8String by OpenSSL (verified with openssl asn1parse).
# Prefixing it with UTF8: does NOT select a string type - it literally puts "UTF8:" in the
# registered address sent to ZATCA. A later attempt with this corrected value still returned
# Invalid-CSR while reusing the same one-time OTP, so live acceptance remains unverified.
SN = ${configValue(f.serialNumber)}
UID = ${configValue(f.vatNumber)}
title = ${configValue(f.invoiceType)}
registeredAddress = ${configValue(f.location)}
businessCategory = ${configValue(f.industry)}
`;
}
