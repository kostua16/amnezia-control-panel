# Add rate limiting to auth login endpoint

## Problem

`/api/auth/login` (`src/app/api/auth/login/route.ts`) has no rate limiting.

The endpoint performs `bcrypt.compare(password, admin.password)` which is intentionally
slow (~100ms per hash round with cost factor 10). This is CPU-bound work on the main
Node.js event loop.

An attacker can open concurrent connections to exhaust server capacity. With 50 parallel
requests, that's 5 seconds of sustained CPU saturation per batch. Node.js is single-threaded,
so this blocks all other request processing during the comparison.

The panel is designed for single-server deployment managing VPN infrastructure — denial of
service on the control panel means no admin access to manage users, routing, or alerts.

## Current state

- `auth/login/route.ts:21-92` — bare try/catch, no rate limit middleware
- `middleware.ts:23-29` — `/api/auth/login` is in PUBLIC_API_ROUTES, bypasses JWT check
- No existing rate-limiting infrastructure in the codebase

## Fix

Add an in-memory sliding-window rate limiter, specific to the login endpoint.

Design:
```
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
```

Check before bcrypt:
1. Extract client IP from `request.headers.get('x-forwarded-for')` or `request.ip`
2. Look up attempt count for IP
3. If `count >= MAX_ATTEMPTS`, return 429 immediately (skip bcrypt)
4. On failed login, increment count
5. On successful login, clear count for that IP
6. Periodic cleanup of expired entries (or lazy cleanup on each request)

The limiter should be module-scoped (not in prisma or DB — in-memory is correct for
single-server deployment per CLAUDE.md architecture).

## Impact

- Eliminates brute-force credential attack surface.
- 429 response before bcrypt means failed attempts cost ~0ms server CPU instead of ~100ms.
- No external dependencies — pure Map-based, fits single-server architecture.
- Production-safe: rate limit survives across requests within the same process.

## Files

- `src/app/api/auth/login/route.ts` — add rate limit check before bcrypt
- `src/lib/__tests__/auth-login.test.ts` — add rate limit tests (429 after N failures)

## Considerations

- Behind a reverse proxy, `x-forwarded-for` may be spoofed. For single-server deployment
  this is acceptable — the proxy itself should handle rate limiting at the network level.
- Map cleanup: lazy eviction on each request (check `resetAt < now`) avoids needing a timer.
  With typical admin-only usage, the Map stays tiny.
