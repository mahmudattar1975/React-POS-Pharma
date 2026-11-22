// Print the exact sale/cancel request this app would send for one unit, without any network call.
//
//   npx tsx src/rsd/preview.ts --unit 08691234567890:1323424679:X2512061322:2031-03-31
//
// The expiry accepts YYMMDD as printed on a DataMatrix (e.g. 310331) or an ISO date. This is the
// safe way to check a payload against the verified XSD before a live sale; it never contacts SFDA.
import 'dotenv/config';
import { normalizeCancelInput, normalizeSaleInput } from './normalize.js';
import { buildCancelEnvelope, buildSaleEnvelope } from './wire.js';

function expandGs1Expiry(value: string): string {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(value.trim());
  return match ? `20${match[1]}-${match[2]}-${match[3]}` : value.trim();
}

// GS1 check digit (mod 10, alternating weights 3/1 from the right). RSD rejects a wrong GTIN.
function gtinCheckDigitOk(gtin: string): boolean {
  const digits = gtin.replace(/\D/g, '');
  if (digits.length !== 14) return false;
  const body = digits.slice(0, 13);
  let sum = 0;
  for (let i = 0; i < 13; i += 1) {
    const digit = Number(body[12 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits[13]);
}

const args = process.argv.slice(2);
const unitIndex = args.indexOf('--unit');
if (unitIndex < 0 || !args[unitIndex + 1]) {
  console.error('Usage: npx tsx src/rsd/preview.ts --unit gtin:serialNo:batchNo:expiry');
  process.exit(1);
}
const [gtin, serialNo, batchNo, expiry] = args[unitIndex + 1].split(':');
if (!gtin || !serialNo || !batchNo || !expiry) {
  console.error('--unit must be gtin:serialNo:batchNo:expiry');
  process.exit(1);
}

const raw = { gtin, serialNo, batchNo, expiryDate: expandGs1Expiry(expiry) };
console.log('input :', raw);
console.log('gtin check digit:', gtinCheckDigitOk(gtin) ? 'valid' : 'INVALID');

try {
  const sale = normalizeSaleInput(raw);
  console.log('sale  :', sale);
  const today = new Date().toISOString().slice(0, 10);
  if (sale.expiryDate < today) {
    console.log(`WARNING: expiry ${sale.expiryDate} is in the past (today ${today}); RSD will reject it.`);
  }
  console.log('\n--- sale envelope (not sent) ---\n');
  console.log(buildSaleEnvelope(sale));

  const cancel = normalizeCancelInput(raw);
  console.log('\n--- cancel envelope (not sent) ---\n');
  console.log(
    buildCancelEnvelope(cancel, { toGln: sale.toGln, prescriptionId: sale.prescriptionId }),
  );
} catch (err) {
  console.error('invalid:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
