// HTTP-aware error type for the RSD routes. Anything else that escapes a route is an unexpected
// 500, so an SFDA answer is never confused with a bug in this app.
export class RsdApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    // Whether the caller may retry the same operation without changing the data. Infrastructure
    // failures are retryable; a business rejection from SFDA is not.
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'RsdApiError';
  }
}

export function badRequest(message: string, code = 'invalid_request'): RsdApiError {
  return new RsdApiError(400, message, code);
}

export function conflict(message: string, code: string, retryable = false): RsdApiError {
  return new RsdApiError(409, message, code, retryable);
}

// The honest answer when live mode is selected without the credentials/endpoint it needs:
// never fake a success that SFDA never received.
export function unavailable(message: string, code = 'rsd_unavailable'): RsdApiError {
  return new RsdApiError(503, message, code, false);
}
