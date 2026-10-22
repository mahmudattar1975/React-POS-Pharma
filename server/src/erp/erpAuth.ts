// Authenticates this server against the existing PharmaAxis .NET backend (OpenMind-Backend-Net-main)
// so it can read real item/stock/customer data from XPH instead of Pharmacy-App's local seed data.
// One shared login for the whole server, not per-cashier - see server/src/erp/README.md.
import { config } from '../config.js';

export interface ErpSession {
  token: string;
  userId: number;
  fapplType: number;
  fapplSub: number;
  profileId: number;
  funitId: number;
}

interface LoginResponseUser {
  fuser_id: number;
  fappl_type: number;
  fappl_sub: number;
  fprofile_id?: number;
  funit_id?: number;
  accessToken?: string;
}

interface LoginResponse {
  isSuccess: boolean;
  message?: string;
  datac?: LoginResponseUser[];
}

let session: ErpSession | null = null;
let loginPromise: Promise<ErpSession> | null = null;

async function doLogin(): Promise<ErpSession> {
  if (!config.erp.serviceUserId || !config.erp.servicePassword) {
    throw new Error('ERP_SERVICE_USER_ID / ERP_SERVICE_PASSWORD not set - copy server/.env.example to .env and fill them in');
  }

  const res = await fetch(`${config.erp.baseUrl}/api/AuthUser/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fappl_type: 0,
      fappl_sub: 0,
      funit_id: 0,
      userid: Number(config.erp.serviceUserId),
      password: config.erp.servicePassword,
      gTermNo: 0,
      currentdate: new Date().toISOString(),
    }),
  });
  const body = (await res.json()) as LoginResponse;
  const user = body.datac?.[0];
  if (!res.ok || !body.isSuccess || !user?.accessToken) {
    throw new Error(`ERP login failed: ${body.message ?? res.status}`);
  }

  session = {
    token: user.accessToken,
    userId: user.fuser_id,
    fapplType: user.fappl_type,
    fapplSub: user.fappl_sub,
    profileId: user.fprofile_id ?? 0,
    funitId: user.funit_id ?? 0,
  };
  return session;
}

export async function getErpSession(): Promise<ErpSession> {
  if (session) return session;
  // Multiple concurrent callers hitting an expired/missing session shouldn't each fire their own
  // login request - share the one in-flight attempt.
  loginPromise ??= doLogin().finally(() => {
    loginPromise = null;
  });
  return loginPromise;
}

export function invalidateErpSession(): void {
  session = null;
}
