// Builds a ZATCA-profile UBL 2.1 Invoice XML.
//
// VERIFICATION NOTE (see server/README.md): this structure is built from ZATCA's published
// e-invoicing UBL 2.1 implementation guidelines and the invoice-type coding recovered from the
// legacy PowerBuilder system's own ZATCA integration (confirmed live values: InvoiceTypeCode id
// 388=invoice/381=credit note, name "0100000"=standard/"0200000"=simplified). It has NOT been
// validated against a live ZATCA endpoint in this project - do that before trusting it for real
// onboarding. The two highest-risk areas to double-check first: the `ext:UBLExtensions` signing
// block (ZATCA's XAdES-like structure for embedding the digital signature/certificate) and exact
// canonicalization rules (see ../xml/canonicalize.ts).
import { create } from 'xmlbuilder2';
import type { UblInvoiceInput, UblInvoiceLine } from './types.js';
import { round2 } from '../util/money.js';

const NS = {
  inv: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  sig: 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2',
  sac: 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2',
  sbc: 'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2',
};

function invoiceTypeCode(input: UblInvoiceInput): { id: string; name: string } {
  const id = input.documentType === 'invoice' ? '388' : input.documentType === 'credit_note' ? '381' : '383';
  const subtype = input.kind === 'standard' ? '01' : '02';
  return { id, name: `${subtype}00000` };
}

function lineTotals(line: UblInvoiceLine) {
  const gross = round2(line.qty * line.unitPrice);
  const net = round2(gross - line.lineDiscountAmount);
  const vat = round2(net * line.vatRate);
  return { gross, net, vat, total: round2(net + vat) };
}

export function buildUnsignedInvoiceXml(input: UblInvoiceInput): string {
  const typeCode = invoiceTypeCode(input);
  const lineCalcs = input.lines.map((l) => ({ line: l, calc: lineTotals(l) }));
  const lineExtensionAmount = round2(lineCalcs.reduce((s, l) => s + l.calc.net, 0));
  const taxAmount = round2(lineCalcs.reduce((s, l) => s + l.calc.vat, 0));
  const taxExclusiveAmount = lineExtensionAmount;
  const taxInclusiveAmount = round2(taxExclusiveAmount + taxAmount);

  // VAT category subtotals, grouped by rate - ZATCA requires one cac:TaxSubtotal per distinct rate.
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const { calc, line } of lineCalcs) {
    const bucket = byRate.get(line.vatRate) ?? { taxable: 0, tax: 0 };
    bucket.taxable = round2(bucket.taxable + calc.net);
    bucket.tax = round2(bucket.tax + calc.vat);
    byRate.set(line.vatRate, bucket);
  }

  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele(NS.inv, 'Invoice')
    .att('xmlns:cac', NS.cac)
    .att('xmlns:cbc', NS.cbc)
    .att('xmlns:ext', NS.ext);

  // Placeholder for the signing extension - filled in by embedSigningExtension() once the hash
  // and signature are known. Present here (empty) so the canonicalized/hashed document has the
  // same element in the same position as the final signed document, per ZATCA's documented flow.
  doc
    .ele(NS.ext, 'UBLExtensions')
    .ele(NS.ext, 'UBLExtension')
    .ele(NS.ext, 'ExtensionURI')
    .txt('urn:oasis:names:specification:ubl:dsig:enveloped:xades')
    .up()
    .ele(NS.ext, 'ExtensionContent')
    .up()
    .up()
    .up();

  doc.ele(NS.cbc, 'ProfileID').txt(input.kind === 'standard' ? 'clearance:1.0' : 'reporting:1.0').up();
  doc.ele(NS.cbc, 'ID').txt(input.id).up();
  doc.ele(NS.cbc, 'UUID').txt(input.uuid).up();
  doc.ele(NS.cbc, 'IssueDate').txt(input.issueDateTime.toISOString().slice(0, 10)).up();
  doc.ele(NS.cbc, 'IssueTime').txt(input.issueDateTime.toISOString().slice(11, 19)).up();
  doc.ele(NS.cbc, 'InvoiceTypeCode').att('name', typeCode.name).txt(typeCode.id).up();
  doc.ele(NS.cbc, 'DocumentCurrencyCode').txt(input.currency).up();
  doc.ele(NS.cbc, 'TaxCurrencyCode').txt(input.currency).up();

  // Invoice Counter Value - strictly incrementing per device, never reused across the device's lifetime.
  doc
    .ele(NS.cac, 'AdditionalDocumentReference')
    .ele(NS.cbc, 'ID').txt('ICV').up()
    .ele(NS.cbc, 'UUID').txt(String(input.icv)).up()
    .up();

  // Previous Invoice Hash - chains every invoice to the one before it (the chain root uses a
  // base64-of-zero-byte placeholder ZATCA documents as the very first invoice's PIH).
  doc
    .ele(NS.cac, 'AdditionalDocumentReference')
    .ele(NS.cbc, 'ID').txt('PIH').up()
    .ele(NS.cac, 'Attachment')
    .ele(NS.cbc, 'EmbeddedDocumentBinaryObject').att('mimeCode', 'text/plain').txt(input.previousInvoiceHash).up()
    .up()
    .up();

  // QR placeholder - filled in by embedSigningExtension() alongside the signature, since the QR
  // itself depends on the hash/signature computed from this same document.
  doc
    .ele(NS.cac, 'AdditionalDocumentReference')
    .ele(NS.cbc, 'ID').txt('QR').up()
    .ele(NS.cac, 'Attachment')
    .ele(NS.cbc, 'EmbeddedDocumentBinaryObject').att('mimeCode', 'text/plain').txt('').up()
    .up()
    .up();

  const supplierAddr = input.supplier.address;
  doc
    .ele(NS.cac, 'AccountingSupplierParty')
    .ele(NS.cac, 'Party')
    .ele(NS.cac, 'PostalAddress')
    .ele(NS.cbc, 'StreetName').txt(supplierAddr.street).up()
    .ele(NS.cbc, 'CityName').txt(supplierAddr.city).up()
    .ele(NS.cbc, 'PostalZone').txt(supplierAddr.postalCode).up()
    .ele(NS.cbc, 'CountrySubentity').txt(supplierAddr.district).up()
    .ele(NS.cac, 'Country').ele(NS.cbc, 'IdentificationCode').txt(supplierAddr.country).up().up()
    .up()
    .ele(NS.cac, 'PartyTaxScheme')
    .ele(NS.cbc, 'CompanyID').txt(input.supplier.vatNumber).up()
    .ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT').up().up()
    .up()
    .ele(NS.cac, 'PartyLegalEntity')
    .ele(NS.cbc, 'RegistrationName').txt(input.supplier.nameEn).up()
    .ele(NS.cbc, 'CompanyID').txt(input.supplier.crNumber).up()
    .up()
    .up()
    .up();

  const custParty = doc.ele(NS.cac, 'AccountingCustomerParty').ele(NS.cac, 'Party');
  if (input.customer.address) {
    const a = input.customer.address;
    custParty
      .ele(NS.cac, 'PostalAddress')
      .ele(NS.cbc, 'StreetName').txt(a.street).up()
      .ele(NS.cbc, 'CityName').txt(a.city).up()
      .ele(NS.cbc, 'PostalZone').txt(a.postalCode).up()
      .ele(NS.cbc, 'CountrySubentity').txt(a.district).up()
      .ele(NS.cac, 'Country').ele(NS.cbc, 'IdentificationCode').txt(a.country).up().up()
      .up();
  }
  if (input.customer.vatNumber) {
    custParty
      .ele(NS.cac, 'PartyTaxScheme')
      .ele(NS.cbc, 'CompanyID').txt(input.customer.vatNumber).up()
      .ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT').up().up()
      .up();
  }
  custParty.ele(NS.cac, 'PartyLegalEntity').ele(NS.cbc, 'RegistrationName').txt(input.customer.name).up().up();
  custParty.up().up();

  doc
    .ele(NS.cac, 'PaymentMeans')
    .ele(NS.cbc, 'PaymentMeansCode').txt(input.paymentMeansCode).up()
    .up();

  const taxTotal = doc.ele(NS.cac, 'TaxTotal');
  taxTotal.ele(NS.cbc, 'TaxAmount').att('currencyID', input.currency).txt(taxAmount.toFixed(2)).up();
  for (const [rate, bucket] of byRate) {
    taxTotal
      .ele(NS.cac, 'TaxSubtotal')
      .ele(NS.cbc, 'TaxableAmount').att('currencyID', input.currency).txt(bucket.taxable.toFixed(2)).up()
      .ele(NS.cbc, 'TaxAmount').att('currencyID', input.currency).txt(bucket.tax.toFixed(2)).up()
      .ele(NS.cac, 'TaxCategory')
      .ele(NS.cbc, 'ID').txt(rate > 0 ? 'S' : 'Z').up() // S = standard rate, Z = zero-rated
      .ele(NS.cbc, 'Percent').txt((rate * 100).toFixed(2)).up()
      .ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT').up().up()
      .up()
      .up();
  }
  taxTotal.up();

  doc
    .ele(NS.cac, 'LegalMonetaryTotal')
    .ele(NS.cbc, 'LineExtensionAmount').att('currencyID', input.currency).txt(lineExtensionAmount.toFixed(2)).up()
    .ele(NS.cbc, 'TaxExclusiveAmount').att('currencyID', input.currency).txt(taxExclusiveAmount.toFixed(2)).up()
    .ele(NS.cbc, 'TaxInclusiveAmount').att('currencyID', input.currency).txt(taxInclusiveAmount.toFixed(2)).up()
    .ele(NS.cbc, 'PayableAmount').att('currencyID', input.currency).txt(taxInclusiveAmount.toFixed(2)).up()
    .up();

  for (const { line, calc } of lineCalcs) {
    doc
      .ele(NS.cac, 'InvoiceLine')
      .ele(NS.cbc, 'ID').txt(line.id).up()
      .ele(NS.cbc, 'InvoicedQuantity').att('unitCode', line.unitCode).txt(String(line.qty)).up()
      .ele(NS.cbc, 'LineExtensionAmount').att('currencyID', input.currency).txt(calc.net.toFixed(2)).up()
      .ele(NS.cac, 'TaxTotal')
      .ele(NS.cbc, 'TaxAmount').att('currencyID', input.currency).txt(calc.vat.toFixed(2)).up()
      .ele(NS.cbc, 'RoundingAmount').att('currencyID', input.currency).txt(calc.total.toFixed(2)).up()
      .up()
      .ele(NS.cac, 'Item')
      .ele(NS.cbc, 'Name').txt(line.itemNameEn).up()
      .ele(NS.cac, 'ClassifiedTaxCategory')
      .ele(NS.cbc, 'ID').txt(line.vatRate > 0 ? 'S' : 'Z').up()
      .ele(NS.cbc, 'Percent').txt((line.vatRate * 100).toFixed(2)).up()
      .ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT').up().up()
      .up()
      .up()
      .ele(NS.cac, 'Price')
      .ele(NS.cbc, 'PriceAmount').att('currencyID', input.currency).txt(line.unitPrice.toFixed(2)).up()
      .up()
      .up();
  }

  return doc.end({ prettyPrint: false });
}

export interface SigningMaterial {
  invoiceHashBase64: string;
  signatureBase64: string;
  certificatePem: string; // the CSID X.509 certificate, PEM
  qrBase64: string;
}

// Re-parses the unsigned XML text and injects the QR + signing extension now that hash/signature
// are known - string-level splice on the two placeholders left by buildUnsignedInvoiceXml, which
// keeps this simple and avoids re-serializing (and therefore risking a different canonical form
// for) the parts of the document that were already hashed.
export function embedSigningExtension(unsignedXml: string, signing: SigningMaterial): string {
  const withQr = unsignedXml.replace(
    /(<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject mimeCode="text\/plain">)(<\/cbc:EmbeddedDocumentBinaryObject>)/,
    `$1${signing.qrBase64}$2`
  );

  const certB64 = signing.certificatePem
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\s+/g, '');

  const signatureExtensionXml = `<ext:UBLExtension><ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI><ext:ExtensionContent><sig:UBLDocumentSignatures xmlns:sig="${NS.sig}" xmlns:sac="${NS.sac}" xmlns:sbc="${NS.sbc}"><sac:SignatureInformation><sbc:ProfileID>signature</sbc:ProfileID><sac:InvoiceHash>${signing.invoiceHashBase64}</sac:InvoiceHash><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature"><ds:SignedInfo/><ds:SignatureValue>${signing.signatureBase64}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certB64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures></ext:ExtensionContent></ext:UBLExtension>`;

  return withQr.replace(
    /<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades<\/ext:ExtensionURI><ext:ExtensionContent\/><\/ext:UBLExtension><\/ext:UBLExtensions>/,
    `<ext:UBLExtensions>${signatureExtensionXml}</ext:UBLExtensions>`
  );
}
