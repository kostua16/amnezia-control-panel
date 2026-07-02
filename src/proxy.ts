import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, type JWTPayload } from 'jose';
import {
  getJwtSecret,
  createSessionToken,
  shouldRefreshToken,
  SESSION_MAX_AGE,
} from '@/lib/auth-jwt';

/**
 * Claims embedded in the auth-token JWT. The proxy is the single source
 * of truth for what a session contains; route handlers read these from request
 * headers instead of re-decoding the token on every authenticated call.
 */
interface AuthClaims extends JWTPayload {
  userId: string;
  username: string;
}

/**
 * Public API routes that skip JWT verification.
 * - /api/auth/login — no token available before login
 * - /api/health — health check must work without auth
 * - /api/ws — Socket.IO upgrade; the handshake is authenticated by the io.use()
 *   JWT gate in server.mjs (reusing this same auth-token cookie), not here
 * - /api/sync/receive — uses HMAC + API key auth, not JWT
 * - /api/sync/apply — uses HMAC + API key auth, not JWT
 */
const PUBLIC_API_ROUTES = [
  '/api/auth/login',
  '/api/health',
  '/api/ws',
  '/api/sync/receive',
  '/api/sync/apply',
];

const PROTECTED_PAGE_ROUTES = [
  '/dashboard',
  '/users',
  '/services',
  '/config',
  '/monitoring',
  '/panels',
  '/servers',
  '/settings',
  '/templates',
];

const STATIC_SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/**
 * Build CSP headers. `unsafe-eval` is included only in development for
 * Turbopack HMR; production drops it to harden XSS protections.
 */
function buildSecurityHeaders(): Headers {
  const headers = new Headers(STATIC_SECURITY_HEADERS);
  const evalDirective =
    process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : '';
  headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self';",
      `script-src 'self' 'unsafe-inline'${evalDirective};`,
      "style-src 'self' 'unsafe-inline';",
      "img-src 'self' data: blob:;",
      "connect-src 'self' ws: wss:;",
    ].join(' '),
  );
  return headers;
}

function isPublicApiRoute(pathname: string): boolean {
  return PUBLIC_API_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/'),
  );
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function isProtectedPageRoute(pathname: string): boolean {
  return PROTECTED_PAGE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/'),
  );
}

/**
 * Re-issue a fresh JWT when the current token is within the sliding-window
 * threshold (≤ 4 h remaining). The new cookie is set on the response
 * transparently — no frontend change required.
 */
async function maybeRefreshSession(
  response: NextResponse,
  payload: AuthClaims,
): Promise<NextResponse> {
  if (payload.exp && shouldRefreshToken(payload.exp)) {
    const newToken = await createSessionToken({
      userId: payload.userId,
      username: payload.username,
    });
    response.cookies.set('auth-token', newToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    });
  }
  return response;
}

function withSecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of buildSecurityHeaders()) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * Forward the decoded JWT claims to downstream handlers as request headers.
 * Because the headers are set here — after signature verification — any
 * client-supplied `x-user-id` / `x-user-name` values are overwritten, so route
 * handlers can trust them without re-decoding the token.
 */
function withClaims(request: NextRequest, payload: AuthClaims): NextResponse {
  const headers = new Headers(request.headers);
  headers.set('x-user-id', payload.userId);
  headers.set('x-user-name', payload.username);
  return withSecurityHeaders(NextResponse.next({ request: { headers } }));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip proxy for non-protected resources
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('/.') // dotfiles
  ) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Skip public API routes entirely
  if (isApiRoute(pathname) && isPublicApiRoute(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  // All remaining API routes require JWT
  if (isApiRoute(pathname)) {
    const token = request.cookies.get('auth-token')?.value;

    if (!token) {
      return withSecurityHeaders(
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      );
    }

    try {
      const secret = getJwtSecret();
      const { payload } = await jwtVerify<AuthClaims>(token, secret);
      const response = withClaims(request, payload);
      return maybeRefreshSession(response, payload);
    } catch {
      return withSecurityHeaders(
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      );
    }
  }

  if (!isProtectedPageRoute(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Page routes: redirect to login if not authenticated
  const token = request.cookies.get('auth-token')?.value;

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  try {
    const secret = getJwtSecret();
    const { payload } = await jwtVerify<AuthClaims>(token, secret);
    const response = withClaims(request, payload);
    return maybeRefreshSession(response, payload);
  } catch {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('expired', 'true');
    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
