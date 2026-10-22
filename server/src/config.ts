import 'dotenv/config';
import { getEnvironment, setEnvironment, type ZatcaEnv } from './store/secureStore.js';

export type { ZatcaEnv };

// Base URLs per ZATCA's e-invoicing gateway. VERIFY these against ZATCA's current developer
// documentation before relying on them - ZATCA has restructured these paths across spec versions.
//
// `sandbox` (ZATCA's public "developer portal") is the one worth starting with: it's designed for
// exactly this - testing an integration's mechanics with no real Fatoora account or OTP required
// (ZATCA documents a fixed test OTP for it). `simulation` and `production` both need a real
// business's actual onboarding credentials.
const ZATCA_BASE_URLS: Record<ZatcaEnv, string> = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
};

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} - copy .env.example to .env and fill it in`);
  return v;
}

// The active environment is stored (see store/secureStore.ts) rather than fixed at process start,
// so the Settings > ZATCA panel can switch it live without a server restart. `.env`'s ZATCA_ENV is
// only the seed value used the very first time the state file is created.
let cachedEnv: ZatcaEnv = (process.env.ZATCA_ENV as ZatcaEnv) ?? 'sandbox';
getEnvironment().then((e) => {
  cachedEnv = e;
});

export const config = {
  port: Number(process.env.PORT ?? 4300),
  get zatcaEnv() {
    return cachedEnv;
  },
  async setZatcaEnv(env: ZatcaEnv) {
    await setEnvironment(env);
    cachedEnv = env;
  },
  get zatcaBaseUrl() {
    return ZATCA_BASE_URLS[this.zatcaEnv];
  },
  seller: {
    nameEn: process.env.ZATCA_SELLER_NAME_EN ?? '',
    nameAr: process.env.ZATCA_SELLER_NAME_AR ?? '',
    vatNumber: process.env.ZATCA_VAT_NUMBER ?? '',
    crNumber: process.env.ZATCA_CR_NUMBER ?? '',
    street: process.env.ZATCA_STREET ?? '',
    city: process.env.ZATCA_CITY ?? '',
    postalCode: process.env.ZATCA_POSTAL_CODE ?? '',
    district: process.env.ZATCA_DISTRICT ?? '',
    country: process.env.ZATCA_COUNTRY ?? 'SA',
  },
  csr: {
    commonName: process.env.ZATCA_CSR_COMMON_NAME ?? '',
    organizationUnit: process.env.ZATCA_CSR_ORGANIZATION_UNIT ?? '',
    organizationName: process.env.ZATCA_CSR_ORGANIZATION_NAME ?? '',
    serialNumber: process.env.ZATCA_CSR_SERIAL_NUMBER ?? '',
    invoiceType: process.env.ZATCA_CSR_INVOICE_TYPE ?? '1100',
  },
  requireSellerConfigured() {
    required('ZATCA_VAT_NUMBER');
    required('ZATCA_SELLER_NAME_EN');
  },
  erp: {
    baseUrl: process.env.ERP_API_BASE_URL ?? 'http://localhost:5000',
    serviceUserId: process.env.ERP_SERVICE_USER_ID ?? '',
    servicePassword: process.env.ERP_SERVICE_PASSWORD ?? '',
    storeNo: Number(process.env.ERP_STORE_NO ?? 0),
  },
};
