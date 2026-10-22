// Talks to the separate dotnet-pos backend (cashier login, shift/drawer, per-cashier commission) -
// see C:\Work_Projects\GeneralWork\React\dotnet-pos. Not the same backend or database as erpApi.ts/
// salesApi.ts (that's this app's own server/ + Prisma, port 4300) - this one is its own ASP.NET
// Core project on a different port, authenticated with a JWT bearer token instead of being open.
import { useAuthStore } from '../store/authStore';
import type { CashierSession, Shift, ShiftCloseResult } from '../types/auth';
import type { CreatePosPayload, CreatePosReturnPayload, PosSaleResult } from '../types/pos';

const BASE_URL = import.meta.env.VITE_POS_API_URL ?? 'http://localhost:5000';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().session?.token;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401) {
    // Token missing/expired/rejected - drop the stale session so the login screen comes back up
    // instead of the app silently failing every request from here on.
    useAuthStore.getState().logout();
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = typeof body === 'string' ? body : body?.message ?? body?.title;
    throw new Error(message ?? `POS request ${path} failed (${res.status})`);
  }
  return body as T;
}

export function login(username: string, password: string): Promise<CashierSession> {
  return request<CashierSession>('/Account/Login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function getCurrentShift(): Promise<Shift | null> {
  return request<Shift | null>('/Shift/Current');
}

export function openShift(openingFloat: number): Promise<Shift> {
  return request<Shift>('/Shift/Open', {
    method: 'POST',
    body: JSON.stringify({ openingFloat }),
  });
}

export function closeShift(closingAmount: number): Promise<ShiftCloseResult> {
  return request<ShiftCloseResult>('/Shift/Close', {
    method: 'POST',
    body: JSON.stringify({ closingAmount }),
  });
}

// Mirrors an already-completed sale into dotnet-pos for shift totals/commission tracking - this
// app's own localStorage + Node/Prisma backup (see salesStore.ts) remains the actual sale of
// record; a failure here must never block or undo a sale that already happened at the register.
export function createSale(payload: CreatePosPayload): Promise<PosSaleResult> {
  return request<PosSaleResult>('/Pos/Create', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function createReturn(payload: CreatePosReturnPayload): Promise<unknown> {
  return request('/PosReturn/Create', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
