// Head Office's own transfer reference format (confirmed by the business owner): a single code per
// row, e.g. "TRANSOUT12345601" - a fixed "TRANSOUT" prefix, then a 6-digit transfer number, then a
// 2-digit destination pharmacy/branch number. One transfer (one shipment document) can cover
// several line items, all sharing the same code - see HeadOfficeReceivingPage.tsx, which uses the
// transfer number half to detect/reject re-importing the same shipment twice, and the branch number
// half to reject any row not addressed to this pharmacy's own store.
const TRANSFER_CODE_RE = /^TRANSOUT(\d{6})(\d{2})$/i;

export interface ParsedTransferCode {
  transferNo: string; // kept as a string (zero-padding is significant, e.g. "012345" - not a quantity to do arithmetic on)
  branchNo: number;
}

export function parseTransferCode(code: string): ParsedTransferCode | null {
  const match = TRANSFER_CODE_RE.exec(code.trim());
  if (!match) return null;
  return { transferNo: match[1], branchNo: Number(match[2]) };
}
