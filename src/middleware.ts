import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, type JWTPayload } from 'jose';

/**
 * Claims embedded in the auth-token JWT. The middleware is the single source
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

function isPublicApiRoute(pathname: string): boolean {
  return PUBLIC_API_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/'),
  );
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return new TextEncoder().encode(secret);
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
  return NextResponse.next({ request: { headers } });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for non-protected resources
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('/.') // dotfiles
  ) {
    return NextResponse.next();
  }

  // Skip public API routes entirely
  if (isApiRoute(pathname) && isPublicApiRoute(pathname)) {
    return NextResponse.next();
  }

  // All remaining API routes require JWT
  if (isApiRoute(pathname)) {
    const token = request.cookies.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const secret = getJwtSecret();
      const { payload } = await jwtVerify<AuthClaims>(token, secret);
      return withClaims(request, payload);
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Page routes: redirect to login if not authenticated
  const token = request.cookies.get('auth-token')?.value;

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const secret = getJwtSecret();
    const { payload } = await jwtVerify<AuthClaims>(token, secret);
    return withClaims(request, payload);
  } catch {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('expired', 'true');
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    // API routes
    '/api/:path*',
    // Page routes that require authentication
    '/dashboard/:path*',
    '/users/:path*',
    '/services/:path*',
    '/config/:path*',
    '/monitoring/:path*',
    '/panels/:path*',
    '/servers/:path*',
    '/settings/:path*',
    '/templates/:path*',
  ],
};
