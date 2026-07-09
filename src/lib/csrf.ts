import { NextRequest } from 'next/server';

/**
 * Validate the Origin header on state-changing requests.
 *
 * Single-server deployment: reject requests where the Origin header is present
 * but does not match the panel's own origin. Browsers omit Origin on same-origin
 * requests from same-site navigations, so we only reject when it is explicitly
 * present and mismatched — a cross-origin form submission or fetch.
 *
 * This mitigates CSRF for cookie-authenticated POST/PUT/DELETE/PATCH routes
 * where `sameSite: 'lax'` cookies are sent with top-level navigations.
 */
export function isValidOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');

  // No Origin header — same-origin browser request or non-browser client.
  // Allow through; JWT auth still required.
  if (!origin) return true;

  // Build the expected origin from the request URL.
  const requestOrigin = request.nextUrl.origin;

  return origin === requestOrigin;
}

/** HTTP methods that mutate server state. */
export const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
