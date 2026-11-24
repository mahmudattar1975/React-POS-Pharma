// HTTP transport for the SFDA SOAP services.
//
// Production expects SOAP 1.1 over HTTPS with HTTP Basic auth, `text/xml; charset=utf-8` and an
// empty quoted SOAPAction. A SOAP 1.2 content type (application/soap+xml) is answered with 415.
//
// Network failures are returned, not thrown: a timeout has to become a retryable `failed` ledger
// attempt, not an unhandled promise rejection.
import type { RsdCredentials } from './config.js';

export interface SoapHttpResult {
  httpStatus: number | null;
  body: string;
  durationMs: number;
  networkError?: string;
}

export interface WsdlProbeResult {
  url: string;
  httpStatus: number | null;
  contentType?: string;
  bytes: number;
  operations: string[];
  networkError?: string;
  snippet: string;
  // The raw WSDL, returned so the trial can save it for schema verification. Never logged.
  body?: string;
}

export interface XmlFetchResult {
  url: string;
  httpStatus: number | null;
  contentType?: string;
  body: string;
  networkError?: string;
}

function basicAuth(creds: RsdCredentials): string {
  return `Basic ${Buffer.from(`${creds.username}:${creds.password}`, 'utf8').toString('base64')}`;
}

// Node's fetch hides the useful network detail in `cause` ("fetch failed" alone tells an operator
// nothing). Surface the code (ENOTFOUND, ECONNREFUSED, ETIMEDOUT, ...) without any credential.
function networkDetail(err: unknown, timedOut: boolean, timeoutMs: number): string {
  if (timedOut) return `Timed out after ${timeoutMs} ms`;
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    const code = cause?.code;
    const detail = cause?.message ?? err.message;
    return code ? `${code}: ${detail}` : detail;
  }
  return String(err);
}

export async function postSoap(
  url: string,
  xml: string,
  creds: RsdCredentials,
  timeoutMs: number,
): Promise<SoapHttpResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        // SOAP 1.1. The integration guide says 1.2, but the live endpoints reject that with 415.
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '""',
        Authorization: basicAuth(creds),
      },
      body: xml,
      signal: controller.signal,
    });
    const body = await res.text();
    return { httpStatus: res.status, body, durationMs: Date.now() - started };
  } catch (err) {
    return {
      httpStatus: null,
      body: '',
      durationMs: Date.now() - started,
      networkError: networkDetail(err, controller.signal.aborted, timeoutMs),
    };
  } finally {
    clearTimeout(timer);
  }
}

// Read-only XML fetch with the same Basic auth as the SOAP calls. Used for the WSDL and the XSD it
// imports; it never posts a document, so it cannot create a movement.
export async function fetchXml(
  url: string,
  creds: RsdCredentials,
  timeoutMs: number,
): Promise<XmlFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/xml, application/xml, */*', Authorization: basicAuth(creds) },
      signal: controller.signal,
    });
    const body = await res.text();
    return {
      url,
      httpStatus: res.status,
      contentType: res.headers.get('content-type') ?? undefined,
      body,
    };
  } catch (err) {
    return {
      url,
      httpStatus: null,
      body: '',
      networkError: networkDetail(err, controller.signal.aborted, timeoutMs),
    };
  } finally {
    clearTimeout(timer);
  }
}

// A non-mutating connectivity check: GET the WSDL with Basic auth. Never submit a dummy sale to
// "test the connection" - even a fake unit becomes a movement that then has to be reversed.
export async function probeWsdl(
  url: string,
  creds: RsdCredentials,
  timeoutMs: number,
): Promise<WsdlProbeResult> {
  const target = /[?&]wsdl\b/i.test(url) ? url : `${url}${url.includes('?') ? '&' : '?'}wsdl`;
  const res = await fetchXml(target, creds, timeoutMs);
  const operations = [...res.body.matchAll(/<(?:\w+:)?operation\b[^>]*\bname="([^"]+)"/gi)].map(
    (m) => m[1],
  );
  return {
    url: target,
    httpStatus: res.httpStatus,
    contentType: res.contentType,
    bytes: res.body.length,
    operations: [...new Set(operations)],
    networkError: res.networkError,
    // Enough to identify a fault page without dumping credentials or a huge document.
    snippet: res.body.slice(0, 400),
    body: res.httpStatus && res.httpStatus >= 200 && res.httpStatus < 300 ? res.body : undefined,
  };
}
