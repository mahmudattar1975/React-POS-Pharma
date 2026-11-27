// JWT validation settings come from the environment only. No key material is stored in the repo.
// Fail closed: a missing key, issuer or audience prevents the server from starting rather than
// silently accepting unauthenticated traffic.
import { createRemoteJWKSet, importSPKI, jwtVerify } from 'jose';

type VerifyKey = Parameters<typeof jwtVerify>[1];

export interface AuthConfig {
  algorithm: 'HS256' | 'RS256';
  key: VerifyKey;
  issuer: string;
  audience: string;
  cashierIdClaim: string;
  usernameClaims: string[];
  fullNameClaims: string[];
  rolesClaims: string[];
  adminClaim: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required to validate POS JWTs`);
  }
  return value.trim();
}

function claimList(env: NodeJS.ProcessEnv, name: string, fallback: string): string[] {
  return (env[name] ?? fallback)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): Promise<AuthConfig> {
  const rawAlgorithm = (env.AUTH_JWT_ALGORITHM ?? 'HS256').toUpperCase();
  if (rawAlgorithm !== 'HS256' && rawAlgorithm !== 'RS256') {
    throw new Error('AUTH_JWT_ALGORITHM must be HS256 or RS256');
  }
  const algorithm: 'HS256' | 'RS256' = rawAlgorithm;
  const issuer = required(env, 'AUTH_JWT_ISSUER');
  const audience = required(env, 'AUTH_JWT_AUDIENCE');

  let key: VerifyKey;
  if (algorithm === 'HS256') {
    const secret = required(env, 'AUTH_JWT_SECRET');
    if (secret.length < 32) {
      throw new Error('AUTH_JWT_SECRET must be at least 32 characters');
    }
    key = new TextEncoder().encode(secret);
  } else {
    const jwksUrl = env.AUTH_JWT_JWKS_URL?.trim();
    const publicKey = env.AUTH_JWT_PUBLIC_KEY?.trim();
    if (jwksUrl) {
      key = createRemoteJWKSet(new URL(jwksUrl));
    } else if (publicKey) {
      key = await importSPKI(publicKey.replace(/\\n/g, '\n'), algorithm);
    } else {
      throw new Error('RS256 requires AUTH_JWT_JWKS_URL or AUTH_JWT_PUBLIC_KEY');
    }
  }

  return {
    algorithm,
    key,
    issuer,
    audience,
    cashierIdClaim: env.AUTH_JWT_CASHIER_ID_CLAIM?.trim() || 'cashierId',
    usernameClaims: claimList(
      env,
      'AUTH_JWT_USERNAME_CLAIMS',
      'username,sub,unique_name,http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
    ),
    fullNameClaims: claimList(
      env,
      'AUTH_JWT_FULL_NAME_CLAIMS',
      'fullName,name,http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
    ),
    rolesClaims: claimList(
      env,
      'AUTH_JWT_ROLES_CLAIM',
      'roles,role,http://schemas.microsoft.com/ws/2008/06/identity/claims/role'
    ),
    adminClaim: env.AUTH_JWT_ADMIN_CLAIM?.trim() || 'isAdmin',
  };
}
