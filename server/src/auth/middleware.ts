import type { RequestHandler } from 'express';
import type { AuthConfig } from './config.js';
import { verifyToken } from './verifyToken.js';

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

// Deny by default. Every /api/* route passes through this before any router is reached.
export function requireAuth(config: AuthConfig): RequestHandler {
  return async (req, res, next) => {
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ error: 'authentication_required' });
      return;
    }
    try {
      req.auth = await verifyToken(token, config);
      next();
    } catch {
      // Do not leak whether the token was expired, unsigned or malformed.
      res.status(401).json({ error: 'invalid_token' });
    }
  };
}

// Function-level authorization. Roles are compared case-insensitively; admin implies all roles.
export function requireRoles(...allowed: string[]): RequestHandler {
  const allowedRoles = allowed.map((role) => role.toLowerCase());
  return (req, res, next) => {
    const principal = req.auth;
    if (!principal) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const roles = principal.roles.map((role) => role.toLowerCase());
    if (principal.isAdmin || roles.some((role) => allowedRoles.includes(role))) {
      next();
      return;
    }
    res.status(403).json({ error: 'forbidden' });
  };
}

export const requireAdmin = requireRoles('admin');
