// The SFDA wire format, isolated in one file.
//
// Sources: SFDA Integration Guide OPS-G-117-V2.1, the production WSDLs (2026-11-21) and the XSDs
// they import. Production expects SOAP 1.1, document/literal, a namespace-qualified operation
// element with unqualified children.
//
// Sale (PharmacySaleService, verified against ?xsd=1) is an ordered sequence:
//   TOGLN, DOCTORID?, PATIENTNATIONALID?, PRESCRIPTIONID, PRESCRIPTIONDATE, PRODUCTLIST
// PRODUCT = GTIN, SN, BN?, XD?. SN is required and there is no quantity element: one PRODUCT is one
// serialized unit.
//
// Cancel (PharmacySaleCancelService, verified against ?xsd=1) differs from the sale: it has no
// PRESCRIPTIONDATE and PRODUCTLIST is optional:
//   TOGLN, PRESCRIPTIONID, PRODUCTLIST?
// PRODUCT = GTIN, SN, BN?, XD?.
//
// The cancel envelope must not carry PRESCRIPTIONDATE: the cancel XSD is a strict xs:sequence, so an
// element that is not declared there can be rejected by the service.
import type { NormalizedCancel, NormalizedSale } from './normalize.js';
import type { RsdParsedResponse, RsdResponseProduct } from './types.js';

export const SOAP_ENVELOPE_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
export const SALE_SERVICE_NS = 'http://dtts.sfda.gov.sa/PharmacySaleService';
export const CANCEL_SERVICE_NS = 'http://dtts.sfda.gov.sa/PharmacySaleCancelService';

export function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function productXml(sale: { gtin: string; serialNo: string; batchNo: string; expiryDate: string }): string {
  return `         <PRODUCT>
            <GTIN>${escapeXml(sale.gtin)}</GTIN>
            <SN>${escapeXml(sale.serialNo)}</SN>
            <BN>${escapeXml(sale.batchNo)}</BN>
            <XD>${escapeXml(sale.expiryDate)}</XD>
         </PRODUCT>`;
}

export function buildSaleEnvelope(sale: NormalizedSale): string {
  // Ordering is significant: the XSD is a sequence, not an all-group.
  const optional = [
    sale.doctorId ? `         <DOCTORID>${escapeXml(sale.doctorId)}</DOCTORID>` : '',
    sale.patientNationalId
      ? `         <PATIENTNATIONALID>${escapeXml(sale.patientNationalId)}</PATIENTNATIONALID>`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENVELOPE_NS}" xmlns:phar="${SALE_SERVICE_NS}">
   <soapenv:Body>
      <phar:PharmacySaleServiceRequest>
         <TOGLN>${escapeXml(sale.toGln)}</TOGLN>
${optional ? `${optional}\n` : ''}         <PRESCRIPTIONID>${escapeXml(sale.prescriptionId)}</PRESCRIPTIONID>
         <PRESCRIPTIONDATE>${escapeXml(sale.prescriptionDate)}</PRESCRIPTIONDATE>
         <PRODUCTLIST>
${productXml(sale)}
         </PRODUCTLIST>
      </phar:PharmacySaleServiceRequest>
   </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildCancelEnvelope(
  cancel: NormalizedCancel,
  sale: Pick<NormalizedSale, 'toGln' | 'prescriptionId'>,
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENVELOPE_NS}" xmlns:phar="${CANCEL_SERVICE_NS}">
   <soapenv:Body>
      <phar:PharmacySaleCancelServiceRequest>
         <TOGLN>${escapeXml(sale.toGln)}</TOGLN>
         <PRESCRIPTIONID>${escapeXml(sale.prescriptionId)}</PRESCRIPTIONID>
         <PRODUCTLIST>
${productXml(cancel)}
         </PRODUCTLIST>
      </phar:PharmacySaleCancelServiceRequest>
   </soapenv:Body>
</soapenv:Envelope>`;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function tagPattern(tag: string): RegExp {
  // Accepts an optional namespace prefix: <ns:RC>00000</ns:RC> and <RC>00000</RC>.
  return new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'i');
}

function tag(xml: string, name: string): string | undefined {
  const match = tagPattern(name).exec(xml);
  return match ? decodeXml(match[1]).trim() : undefined;
}

function blocks(xml: string, name: string): string[] {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`,
    'gi',
  );
  return [...xml.matchAll(re)].map((m) => m[1]);
}

// A batch response can be mixed: HTTP 200 with one PRODUCT at RC 00000 and another at 11043.
// Parsing is therefore per product, and the caller must never collapse a mixed batch to a single
// boolean. This app sends one unit per call, but the parser keeps the shape so a future batch
// endpoint cannot reintroduce the bug the field guide describes.
export function parseSoapResponse(xml: string): RsdParsedResponse {
  const faultString = tag(xml, 'faultstring');
  const faultCode = tag(xml, 'FC') ?? tag(xml, 'faultcode');
  const products: RsdResponseProduct[] = blocks(xml, 'PRODUCT').map((block) => ({
    gtin: tag(block, 'GTIN'),
    sn: tag(block, 'SN'),
    bn: tag(block, 'BN'),
    xd: tag(block, 'XD'),
    rc: tag(block, 'RC'),
  }));

  const fault =
    faultString || faultCode
      ? { code: faultCode, message: faultString ?? `SFDA fault ${faultCode ?? 'unknown'}` }
      : undefined;

  // Strip the PRODUCT blocks before looking for a top-level RC, otherwise the regex would pick
  // the first product's code and a batch answer could look like a single success.
  const withoutProducts = xml.replace(
    /<(?:[\w.-]+:)?PRODUCT\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?PRODUCT>/gi,
    '',
  );

  return {
    notificationId: tag(xml, 'NOTIFICATIONID'),
    rc: tag(withoutProducts, 'RC'),
    products,
    fault,
  };
}

export function isSuccessRc(rc: string | undefined): boolean {
  return (rc ?? '').trim() === '00000';
}
