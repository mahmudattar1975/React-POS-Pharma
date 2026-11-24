// Retention archive for every ZATCA submission attempt.
//
// ZATCA requires the seller to keep the signed invoice (and produce it on request), and this app's
// frontend deliberately does NOT store the ~10 KB signed XML per sale in browser localStorage - that
// would blow the quota within a few hundred invoices and put a legal record in the least durable
// place the system has. The signed document therefore lives here, next to the CSID that signed it.
//
// Two properties this file guarantees, because the invoice chain depends on them:
//  - an accepted document is archived BEFORE the ICV/PIH chain advances (see submitSaleInvoice),
//    so a crash between the two can only ever cause a duplicate archive row, never a gap in the
//    chain;
//  - writes are serialised through one promise chain - two simultaneous checkouts would otherwise
//    read-modify-write the same JSON and silently lose one invoice.
//
// Like secureStore.ts, this is DEV-GRADE plaintext-on-disk: fine locally, not a production
// retention solution (that needs an append-only store with access control and a backup policy).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'zatca-invoices.json');

export interface ArchivedInvoiceRecord {
  uuid: string;
  icv: number;
  invoiceNo: string;
  invoiceType: 'standard' | 'simplified';
  // A return produces a credit note, not another sales invoice. Kept on the archive row so the
  // retention list can distinguish them and a dispute can show what the document actually was.
  documentType?: 'invoice' | 'credit_note' | 'debit_note';
  billingReference?: { id: string; uuid?: string; issueDate?: string };
  note?: string;
  issueDate: string; // ISO - the document's own issue timestamp
  status: 'cleared' | 'reported' | 'accepted_with_warnings' | 'failed';
  invoiceHashBase64: string;
  qrBase64: string;
  signedXml: string;
  // For clearance submissions ZATCA returns the stamped legal copy; retain it too, not just the
  // document we sent.
  clearedInvoiceXmlBase64?: string;
  reason?: string; // structured failure/validation reason from the gateway
  response: unknown;
  submittedAt: string; // ISO - when this attempt was made
  environment: 'sandbox' | 'simulation' | 'production';
}

// What the list endpoint returns: everything except the two large fields, so the e-invoices page can
// render a table without downloading every document.
export type ArchivedInvoiceSummary = Omit<ArchivedInvoiceRecord, 'signedXml' | 'qrBase64' | 'response'>;

let writeChain: Promise<void> = Promise.resolve();

async function readAll(): Promise<ArchivedInvoiceRecord[]> {
  try {
    const text = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as ArchivedInvoiceRecord[]) : [];
  } catch {
    // Missing (first run) and corrupt both mean "nothing archived yet" as far as a reader is
    // concerned; corrupt is reported by the writer below before it overwrites anything.
    return [];
  }
}

// Append-only by design: a resubmitted invoice produces a NEW attempt row rather than replacing the
// earlier one, because "what did ZATCA answer on attempt 1" is exactly the question a dispute asks.
export function archiveInvoice(record: ArchivedInvoiceRecord): Promise<void> {
  writeChain = writeChain.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const all = await readAll();
    all.push(record);
    await writeFile(FILE, JSON.stringify(all, null, 2), 'utf8');
  });
  return writeChain;
}

export async function listArchivedInvoices(limit = 200): Promise<ArchivedInvoiceSummary[]> {
  const all = await readAll();
  return all
    .slice(-Math.max(1, limit))
    .reverse()
    .map(({ signedXml: _xml, qrBase64: _qr, response: _res, ...summary }) => summary);
}

// The most recent FAILED attempt for a document number. A retry must reuse the UUID of the attempt
// it is correcting: ZATCA expects one document identity per invoice/credit note, and generating a
// new UUID on every retry would create a second document with the same invoice number.
export async function findFailedSubmissionByInvoiceNo(invoiceNo: string): Promise<ArchivedInvoiceRecord | undefined> {
  const all = await readAll();
  for (let i = all.length - 1; i >= 0; i -= 1) {
    if (all[i].invoiceNo === invoiceNo && all[i].status === 'failed') return all[i];
  }
  return undefined;
}

export async function findArchivedInvoice(uuid: string): Promise<ArchivedInvoiceRecord | undefined> {
  const all = await readAll();
  // A UUID is one document, but retries may archive it twice; the newest accepted attempt wins.
  for (let i = all.length - 1; i >= 0; i -= 1) {
    if (all[i].uuid === uuid) return all[i];
  }
  return undefined;
}
