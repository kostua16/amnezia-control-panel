import { NextRequest } from 'next/server';

/**
 * Validate the Origin header on state-changing requests.
 *
 * Single-server deployment: reject requests where the Origin header is present
 * but its host does not match the panel's own host. Browsers omit Origin on
 * same-origin requests from same-site navigations, so we only reject when it is
 * explicitly present and mismatched — a cross-origin form submission or fetch.
 *
 * Comparison is host-only (hostname:port), not scheme-sensitive. Behind a
 * TLS-terminating reverse proxy the app observes an http origin internally
 * while the browser sends https for the same host; a scheme-strict check would
 * reject every legitimate mutating request there. The CSRF boundary is the
 * host the browser believes it is talking to — the scheme adds nothing, since
 * an attacker cannot serve the panel's own host from a different origin.
 *
 * This mitigates CSRF for cookie-authenticated POST/PUT/DELETE/PATCH routes
 * where `sameSite: 'lax'` cookies are sent with top-level navigations.
 */
export function isValidOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');

  // No Origin header — same-origin browser request or non-browser client.
  // Allow through; JWT auth still required.
  if (!origin) return true;

  const originHost = hostOf(origin);
  const requestHost = request.nextUrl.host;

  // Unparseable Origin or missing host → treat as cross-origin (reject).
  if (!originHost || !requestHost) return false;

  return normalizeHost(originHost) === normalizeHost(requestHost);
}

/** Extract the host (hostname:port) from an origin URL string, or null. */
function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/**
 * Strip an explicit default HTTP/HTTPS port. `new URL().host` omits the
 * default port for the parsed scheme, but `request.nextUrl.host` reflects
 * the raw `Host` header, which a reverse proxy may forward with an explicit
 * default port (e.g. `Host: panel.example.com:443`). Normalizing both sides
 * prevents a false cross-origin rejection in that case.
 */
function normalizeHost(host: string): string {
  return host.replace(/:(80|443)$/, '');
}

/** HTTP methods that mutate server state. */
export const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
