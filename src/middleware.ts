import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const securityHeaders = new Headers({
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
});

export function middleware(_request: NextRequest) {
  const response = NextResponse.next();

  // Apply static security headers to every response.
  for (const [key, value] of securityHeaders) {
    response.headers.set(key, value);
  }

  // Content-Security-Policy: allow same-origin, inline styles/scripts (Next.js),
  // WebSocket connections (Socket.IO), and data/blob images.
  const csp =
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "connect-src 'self' ws: wss:;";

  response.headers.set('Content-Security-Policy', csp);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, public assets
     */
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
