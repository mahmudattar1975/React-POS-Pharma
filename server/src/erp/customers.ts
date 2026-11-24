import { erpPost } from './erpClient.js';
import { getErpSession } from './erpAuth.js';

// Confirmed working (this exact id is already used live by the React ERP frontend's Customers
// screen - see App.tsx's CUSTOMER_FUNCTION_ID in OpenMind-FrontEnd-React). Exported so items.ts
// can reuse it for the Fcodcsvn cust_type=35 "stores" convention (see getOtherBranchStock there)
// rather than duplicating the same magic string.
export const FUNCTION_ID_FCODCSVN = '10110400';
const CUST_TYPE_CUSTOMER = 2; // vs. 1 = vendor, per fcodcsvn.ts in the React app

export interface ErpCustomer {
  custNo: number;
  nameAr: string;
  nameEn: string;
  // The field that actually plays the "VAT registration number" role on this entity - there's no
  // separately named vat_registration_no field (confirmed via erp/README.md's research). Presence
  // of a real value here is this app's B2B/B2C (standard/simplified invoice) signal.
  vatFileNo: string;
  isLocked: boolean;
}

interface RawCustomer {
  cust_no: number;
  cust_name_a?: string | null;
  cust_name_e?: string | null;
  vat_file_no?: string | null;
  lock_flag?: number | null;
}

function trimmed(s: string | null | undefined): string {
  return (s ?? '').trim();
}

function mapCustomer(r: RawCustomer): ErpCustomer {
  return {
    custNo: r.cust_no,
    nameAr: trimmed(r.cust_name_a),
    nameEn: trimmed(r.cust_name_e),
    vatFileNo: trimmed(r.vat_file_no),
    isLocked: r.lock_flag === 1,
  };
}

export async function searchCustomers(query: string, limit = 20): Promise<ErpCustomer[]> {
  const session = await getErpSession();
  const res = await erpPost<RawCustomer>('/api/user/Fcodcsvn/SearchData', FUNCTION_ID_FCODCSVN, {
    key: { fappl_type: session.fapplType, fappl_sub: session.fapplSub, cust_type: CUST_TYPE_CUSTOMER, cust_no: 0, cust_main: 0 },
    filter: { search: query, page: 1, limit, orderby: 'cust_no', ordertype: 'asc' },
  });
  return (res.datac ?? []).map(mapCustomer);
}
