// The SOAP envelopes and response parser are the only place this app speaks SFDA's wire format.
// A wrong element order, namespace or RC lookup is rejected in production, so these are pinned.
import { describe, expect, it } from 'vitest';
import type { NormalizedCancel, NormalizedSale } from '../../src/rsd/normalize';
import {
  buildCancelEnvelope,
  buildSaleEnvelope,
  isSuccessRc,
  parseSoapResponse,
} from '../../src/rsd/wire';

const sale: NormalizedSale = {
  gtin: '06281007320021',
  serialNo: 'SN123456',
  batchNo: 'AX24C09',
  expiryDate: '2027-05-31',
  toGln: '0000000000000',
  prescriptionId: 'DIRECT-SALE',
  prescriptionDate: '2026-11-21',
};

const cancel: NormalizedCancel = {
  gtin: sale.gtin,
  serialNo: sale.serialNo,
  batchNo: sale.batchNo,
  expiryDate: sale.expiryDate,
  invoiceNo: 'INV-1',
};

describe('buildSaleEnvelope', () => {
  it('uses the verified SOAP 1.1 sale namespace and element order', () => {
    const xml = buildSaleEnvelope(sale);
    expect(xml).toContain('xmlns:phar="http://dtts.sfda.gov.sa/PharmacySaleService"');
    expect(xml).toContain('<phar:PharmacySaleServiceRequest>');

    const order = ['<TOGLN>', '<PRESCRIPTIONID>', '<PRESCRIPTIONDATE>', '<PRODUCTLIST>'];
    const positions = order.map((tag) => xml.indexOf(tag));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(xml.indexOf('<GTIN>')).toBeLessThan(xml.indexOf('<SN>'));
    expect(xml.indexOf('<SN>')).toBeLessThan(xml.indexOf('<BN>'));
    expect(xml.indexOf('<BN>')).toBeLessThan(xml.indexOf('<XD>'));
  });

  it('omits optional elements that were not supplied', () => {
    const xml = buildSaleEnvelope(sale);
    expect(xml).not.toContain('<DOCTORID>');
    expect(xml).not.toContain('<PATIENTNATIONALID>');
  });

  it('places optional doctor and patient before the prescription block', () => {
    const xml = buildSaleEnvelope({
      ...sale,
      doctorId: 'DOC-1',
      patientNationalId: '1234567890',
    });
    expect(xml.indexOf('<DOCTORID>')).toBeLessThan(xml.indexOf('<PATIENTNATIONALID>'));
    expect(xml.indexOf('<PATIENTNATIONALID>')).toBeLessThan(xml.indexOf('<PRESCRIPTIONID>'));
  });

  it('escapes values so a batch number cannot break the XML', () => {
    const xml = buildSaleEnvelope({ ...sale, batchNo: 'A&B<C>' });
    expect(xml).toContain('<BN>A&amp;B&lt;C&gt;</BN>');
    expect(xml).not.toContain('<BN>A&B<C></BN>');
  });
});

describe('buildCancelEnvelope', () => {
  it('uses the cancel namespace and the sale context, never a local invoice id', () => {
    const xml = buildCancelEnvelope(cancel, sale);
    expect(xml).toContain('xmlns:phar="http://dtts.sfda.gov.sa/PharmacySaleCancelService"');
    expect(xml).toContain('<phar:PharmacySaleCancelServiceRequest>');
    expect(xml).toContain('<TOGLN>0000000000000</TOGLN>');
    expect(xml).toContain('<PRESCRIPTIONID>DIRECT-SALE</PRESCRIPTIONID>');
    expect(xml).not.toContain('INV-1');
    expect(xml).toContain(
      `<GTIN>${sale.gtin}</GTIN>`,
    );
  });

  it('matches the cancel XSD exactly: no PRESCRIPTIONDATE, order TOGLN/PRESCRIPTIONID/PRODUCTLIST', () => {
    const xml = buildCancelEnvelope(cancel, sale);
    // The cancel schema is a strict xs:sequence and has no PRESCRIPTIONDATE element.
    expect(xml).not.toContain('<PRESCRIPTIONDATE>');
    const order = ['<TOGLN>', '<PRESCRIPTIONID>', '<PRODUCTLIST>'];
    const positions = order.map((tag) => xml.indexOf(tag));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe('parseSoapResponse', () => {
  function envelope(body: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`;
  }

  it('reads the notification id and a namespaced per-product success code', () => {
    const parsed = parseSoapResponse(
      envelope(`
        <ns:PharmacySaleServiceResponse xmlns:ns="http://dtts.sfda.gov.sa/PharmacySaleService">
          <NOTIFICATIONID>N-123</NOTIFICATIONID>
          <PRODUCTLIST>
            <PRODUCT>
              <GTIN>06281007320021</GTIN>
              <SN>SN123456</SN>
              <BN>AX24C09</BN>
              <XD>2027-05-31</XD>
              <ns:RC>00000</ns:RC>
            </PRODUCT>
          </PRODUCTLIST>
        </ns:PharmacySaleServiceResponse>`),
    );
    expect(parsed.notificationId).toBe('N-123');
    expect(parsed.fault).toBeUndefined();
    expect(parsed.products).toEqual([
      {
        gtin: '06281007320021',
        sn: 'SN123456',
        bn: 'AX24C09',
        xd: '2027-05-31',
        rc: '00000',
      },
    ]);
    expect(parsed.rc).toBeUndefined();
  });

  it('keeps mixed batch outcomes per product instead of collapsing them', () => {
    const parsed = parseSoapResponse(
      envelope(`
        <PRODUCTLIST>
          <PRODUCT><GTIN>1</GTIN><SN>A</SN><RC>00000</RC></PRODUCT>
          <PRODUCT><GTIN>2</GTIN><SN>B</SN><RC>11043</RC></PRODUCT>
        </PRODUCTLIST>`),
    );
    expect(parsed.rc).toBeUndefined();
    expect(parsed.products.map((p) => p.rc)).toEqual(['00000', '11043']);
  });

  it('reads a top-level RC when the service answers without PRODUCT nodes', () => {
    const parsed = parseSoapResponse(envelope('<RC>00000</RC><NOTIFICATIONID>N-9</NOTIFICATIONID>'));
    expect(parsed.rc).toBe('00000');
    expect(parsed.notificationId).toBe('N-9');
  });

  it('reads a SOAP fault and its SFDA fault code', () => {
    const parsed = parseSoapResponse(
      envelope(`
        <soapenv:Fault>
          <faultcode>soapenv:Client</faultcode>
          <faultstring>Invalid prescription date</faultstring>
          <detail><FC>21000</FC></detail>
        </soapenv:Fault>`),
    );
    expect(parsed.fault).toEqual({ code: '21000', message: 'Invalid prescription date' });
  });
});

describe('isSuccessRc', () => {
  it('accepts only RC 00000, ignoring whitespace', () => {
    expect(isSuccessRc('00000')).toBe(true);
    expect(isSuccessRc(' 00000 ')).toBe(true);
    expect(isSuccessRc('11043')).toBe(false);
    expect(isSuccessRc(undefined)).toBe(false);
  });
});
