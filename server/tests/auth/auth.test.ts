// Security regression tests for Phase 0 / CRITICAL auth fixes. These pin deny-by-default
// behaviour, claim validation and admin-only function authorization. No active HTTP exploitation.
import { SignJWT } from 'jose';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { loadAuthConfig, type AuthConfig } from '../../src/auth/config';
import { requireAdmin, requireAuth } from '../../src/auth/middleware';

const SECRET = 'test-only-secret-that-is-long-enough-for-hs256-validation';
const OTHER_SECRET = 'another-test-only-secret-that-is-also-long-enough';
const ISSUER = 'dotnet-pos-test';
const AUDIENCE = 'pharmacy-app-test';

async function config(overrides: Record<string, string> = {}): Promise<AuthConfig> {
  return loadAuthConfig({
    AUTH_JWT_ALGORITHM: 'HS256',
    AUTH_JWT_SECRET: SECRET,
    AUTH_JWT_ISSUER: ISSUER,
    AUTH_JWT_AUDIENCE: AUDIENCE,
    ...overrides,
  });
}

async function token(options: {
  secret?: string;
  issuer?: string;
  audience?: string;
  expiresIn?: number | string;
  claims?: Record<string, unknown>;
} = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    cashierId: 7,
    username: 'cashier',
    fullName: 'Test Cashier',
    ...options.claims,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt(now - 60)
    .setNotBefore(now - 60)
    .setExpirationTime(options.expiresIn ?? now + 600)
    .sign(new TextEncoder().encode(options.secret ?? SECRET));
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function request(authorization?: string): Request {
  return { headers: authorization ? { authorization } : {} } as unknown as Request;
}

function response() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('loadAuthConfig', () => {
  it('fails closed when the signing key or issuer/audience are missing', async () => {
    await expect(loadAuthConfig({})).rejects.toThrow(/AUTH_JWT_SECRET|required/i);
    await expect(loadAuthConfig({
      AUTH_JWT_SECRET: SECRET,
      AUTH_JWT_ISSUER: ISSUER,
    })).rejects.toThrow(/AUTH_JWT_AUDIENCE/);
    await expect(loadAuthConfig({
      AUTH_JWT_SECRET: 'short',
      AUTH_JWT_ISSUER: ISSUER,
      AUTH_JWT_AUDIENCE: AUDIENCE,
    })).rejects.toThrow(/at least 32 characters/);
  });
});

describe('requireAuth', () => {
  it('rejects a request with no bearer token', async () => {
    const res = response();
    const next = vi.fn();
    await (requireAuth(await config()) as Handler)(request(), res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'authentication_required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a valid token and derives the principal from verified claims', async () => {
    const res = response();
    const req = request(`Bearer ${await token({ claims: { isAdmin: true } })}`);
    const next = vi.fn();
    await (requireAuth(await config()) as Handler)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.auth).toMatchObject({
      cashierId: 7,
      username: 'cashier',
      fullName: 'Test Cashier',
      isAdmin: true,
    });
  });

  it('rejects tampered, expired and wrong-issuer/audience tokens', async () => {
    const auth = requireAuth(await config());
    const cases = [
      await token({ secret: OTHER_SECRET }),
      await token({ expiresIn: Math.floor(Date.now() / 1000) - 30 }),
      await token({ issuer: 'another-issuer' }),
      await token({ audience: 'another-audience' }),
    ];
    for (const value of cases) {
      const res = response();
      const next = vi.fn();
      await (auth as Handler)(request(`Bearer ${value}`), res, next);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'invalid_token' });
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('rejects a structurally valid token with no usable cashier identity', async () => {
    const res = response();
    const next = vi.fn();
    const value = await token({ claims: { cashierId: 0, username: '' } });
    await (requireAuth(await config()) as Handler)(request(`Bearer ${value}`), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireAdmin', () => {
  it('allows an admin token and denies a cashier token', async () => {
    const adminReq = request();
    adminReq.auth = {
      cashierId: 1,
      username: 'admin',
      fullName: 'Admin',
      roles: ['cashier'],
      isAdmin: true,
      claims: {},
    };
    const adminNext = vi.fn();
    requireAdmin(adminReq, response(), adminNext);
    expect(adminNext).toHaveBeenCalledOnce();

    const cashierReq = request();
    cashierReq.auth = {
      cashierId: 2,
      username: 'cashier',
      fullName: 'Cashier',
      roles: ['cashier'],
      isAdmin: false,
      claims: {},
    };
    const res = response();
    const cashierNext = vi.fn();
    requireAdmin(cashierReq, res, cashierNext);
    expect(res.statusCode).toBe(403);
    expect(cashierNext).not.toHaveBeenCalled();
  });

  it('denies a request that has not passed authentication', async () => {
    const res = response();
    const next = vi.fn();
    requireAdmin(request(), res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
