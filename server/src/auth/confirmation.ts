import type { RequestHandler } from 'express';
import { securityAudit } from '../audit.js';

// Second key for irreversible admin actions: a valid admin token alone must not be enough to flip
// a terminal into live ZATCA/SFDA mode. The phrase is sent explicitly by the UI after a human
// confirmation dialog; it is not a secret, just proof of intent.
export async function confirmationMatches(req: Parameters<typeof securityAudit>[0], phrase: string, action: string): Promise<boolean> {
  const body = (req.body ?? {}) as { confirmation?: unknown };
  if (body.confirmation === phrase) return true;
  try {
    await securityAudit(req, action, 'denied', { reason: 'confirmation_required' });
  } catch (err) {
    console.error('[audit] failed to record denial:', err);
  }
  return false;
}

export function requireConfirmation(phrase: string, action: string): RequestHandler {
  return async (req, res, next) => {
    if (await confirmationMatches(req, phrase, action)) {
      next();
      return;
    }
    res.status(400).json({ error: 'confirmation_required', confirmation: phrase });
  };
}
