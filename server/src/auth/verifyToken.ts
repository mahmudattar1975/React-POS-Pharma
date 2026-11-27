import { jwtVerify } from 'jose';
import type { AuthConfig } from './config.js';
import type { Principal } from './principal.js';

function firstClaim(claims: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    const value = claims[name];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' ? [value] : [];
}

// Verifies signature, algorithm, issuer, audience and lifetimes before any claim is trusted.
// Unknown claim layouts fail closed rather than yielding an anonymous principal.
export async function verifyToken(token: string, config: AuthConfig): Promise<Principal> {
  const { payload } = await jwtVerify(token, config.key, {
    algorithms: [config.algorithm],
    issuer: config.issuer,
    audience: config.audience,
    clockTolerance: 5,
  });
  const claims = payload as Record<string, unknown>;

  const cashierId = Number(firstClaim(claims, [config.cashierIdClaim]));
  if (!Number.isSafeInteger(cashierId) || cashierId <= 0) {
    throw new Error('invalid cashierId claim');
  }

  const usernameValue = firstClaim(claims, config.usernameClaims);
  const username = typeof usernameValue === 'string' ? usernameValue.trim() : '';
  if (!username) throw new Error('invalid username claim');

  const fullNameValue = firstClaim(claims, config.fullNameClaims);
  const fullName = typeof fullNameValue === 'string' ? fullNameValue : '';

  const roles = strings(firstClaim(claims, config.rolesClaims));
  const adminValue = firstClaim(claims, [config.adminClaim]);
  const isAdmin =
    adminValue === true ||
    (typeof adminValue === 'string' && adminValue.toLowerCase() === 'true') ||
    roles.some((role) => role.toLowerCase() === 'admin');

  return { cashierId, username, fullName, roles, isAdmin, claims: payload };
}
