import type { JWTPayload } from 'jose';

// The authenticated principal is derived only from a verified JWT. Client-supplied identity
// fields (cashierName, userId, roles) are never copied into this object.
export interface Principal {
  cashierId: number;
  username: string;
  fullName: string;
  roles: string[];
  isAdmin: boolean;
  claims: JWTPayload;
}

declare global {
  namespace Express {
    interface Request {
      auth?: Principal;
    }
  }
}
