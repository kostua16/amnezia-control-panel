import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Public API routes that skip JWT verification.
 * - /api/auth/login — no token available before login
 * - /api/health — health check must work without auth
 * - /api/ws — Socket.io upgrade handled separately, not via middleware
 * - /api/sync/receive — uses HMAC + API key auth, not JWT
 */
const PUBLIC_API_ROUTES = [
  '/api/auth/login',
  '/api/health',
  '/api/ws',
  '/api/sync/receive',
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
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    try {
      const secret = getJwtSecret();
      await jwtVerify(token, secret);
      return NextResponse.next();
    } catch {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
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
    await jwtVerify(token, secret);
    return NextResponse.next();
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
    '/servers/:path*',
    '/settings/:path*',
  ],
};
