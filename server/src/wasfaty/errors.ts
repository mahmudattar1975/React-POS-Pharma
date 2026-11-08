// Small HTTP-aware error type so routes can translate domain failures into status codes without
// string-sniffing. Anything that is NOT a WasfatyApiError is treated as an unexpected 500.
export class WasfatyApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'WasfatyApiError';
  }
}

export function badRequest(message: string, code = 'invalid_request'): WasfatyApiError {
  return new WasfatyApiError(400, message, code);
}

export function notFound(message: string): WasfatyApiError {
  return new WasfatyApiError(404, message, 'not_found');
}

// The honest answer for a connector that is not configured: 503, never a guessed success.
export function unavailable(message: string): WasfatyApiError {
  return new WasfatyApiError(503, message, 'provider_unavailable');
}
