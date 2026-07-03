/**
 * In-memory sliding-window rate limiter for the login endpoint.
 *
 * Uses a Map keyed by client IP. Each entry tracks the failure count and
 * the window expiry. Lazy cleanup on each check avoids timer overhead;
 * with admin-only traffic the Map stays tiny.
 *
 * Module-scoped state is correct for single-server deployment (CLAUDE.md).
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const loginAttempts = new Map<string, RateLimitEntry>();

/** Maximum failed login attempts per IP within the window. */
const MAX_ATTEMPTS = 5;

/** Sliding window duration in milliseconds (15 minutes). */
const WINDOW_MS = 15 * 60 * 1000;

/** Extract client IP from request headers. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  return 'unknown';
}

/**
 * Check whether a login attempt from the given IP is allowed.
 * Performs lazy cleanup of expired entries.
 */
export function checkLoginRateLimit(ip: string): {
  allowed: boolean;
  retryAfterMs: number;
} {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (entry && entry.resetAt <= now) {
    loginAttempts.delete(ip);
  }

  const current = loginAttempts.get(ip);
  if (current && current.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterMs: current.resetAt - now };
  }

  return { allowed: true, retryAfterMs: 0 };
}

/** Record a failed login attempt for the given IP. */
export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const existing = loginAttempts.get(ip);

  if (existing && existing.resetAt > now) {
    existing.count += 1;
  } else {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  }
}

/** Clear rate limit entries for the given IP (called on successful login). */
export function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

/** Reset all rate limit state. For testing only. */
export function resetLoginRateLimiter(): void {
  loginAttempts.clear();
}
