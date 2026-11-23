// Which sold lines may be reported to RSD.
//
// RSD's Pharmacy Sale is for DRUGS only. The item master's "Batch / expiry tracking" switch is this
// app's marker for a drug: supplies, equipment and other non-dated goods have it off. A line whose
// item had tracking off is never enqueued, even if it somehow carries a serial.
//
// RSD is also unit-level: the service requires GTIN + SN and has no quantity element, so a line with
// no captured serials is out of scope rather than guessed batch-by-batch.
import type { RsdUnit } from '../types/rsd';
import type { SaleLine } from '../types/sales';
import type { DrugSerial } from '../types/serial';

// `=== true` is deliberate. undefined means the line predates this snapshot (or the item was never
// loaded); treating that as "not a drug" keeps supplies out of RSD and only loses reports for old
// invoices, which are never enqueued in the first place.
export function isRsdReportableLine(line: SaleLine): boolean {
  return line.requiresBatchTracking === true;
}

// One cart line -> the RSD units it represents.
export function rsdUnitsForLine(line: SaleLine): RsdUnit[] {
  if (!isRsdReportableLine(line)) return [];
  if (!line.serials || line.serials.length === 0) return [];
  return line.serials
    // Reporting needs a real expiry date; a serial captured without one cannot be sent and is
    // surfaced by the caller instead of being guessed here.
    .filter((serial): serial is DrugSerial & { expiryDate: string } =>
      typeof serial.expiryDate === 'string' && serial.expiryDate !== '',
    )
    .map((serial) => ({
      gtin: serial.gtin,
      serialNo: serial.serialNo,
      batchNo: serial.batchNo,
      expiryDate: serial.expiryDate,
    }));
}
