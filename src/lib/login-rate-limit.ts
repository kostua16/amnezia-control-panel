/**
 * In-memory fixed-window rate limiter for the login endpoint.
 *
 * Each client IP gets a bucket tracking consumed attempts and a window expiry.
 * A slot is reserved synchronously at check time, before any awaited work
 * (bcrypt), so concurrent requests cannot overrun the limit while the slow
 * comparison is in flight. Lazy cleanup of expired buckets plus a hard cap on
 * bucket count bound memory; with admin-only traffic the Map stays tiny.
 *
 * Module-scoped state is correct for single-server deployment (CLAUDE.md).
 */

interface RateLimitEntry {
  /** Attempts already consumed in the current window. */
  count: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
}

const loginAttempts = new Map<string, RateLimitEntry>();

/** Maximum login attempts per IP within the window before 429. */
const MAX_ATTEMPTS = 5;

/** Fixed window duration in milliseconds (15 minutes). */
const WINDOW_MS = 15 * 60 * 1000;

/** Upper bound on tracked IPs to keep memory finite under spoofed-IP floods. */
const MAX_BUCKETS = 10_000;

/** Extract the client IP from trusted proxy headers. Empty when unattributable. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  return '';
}

function evictExpired(now: number): void {
  for (const [key, entry] of loginAttempts) {
    if (entry.resetAt <= now) {
      loginAttempts.delete(key);
    }
  }
}

function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldestReset = Infinity;
  for (const [key, entry] of loginAttempts) {
    if (entry.resetAt < oldestReset) {
      oldestReset = entry.resetAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) {
    loginAttempts.delete(oldestKey);
  }
}

/**
 * Reserve a login attempt slot for the given IP.
 *
 * Returns `allowed: false` once the window's attempts are exhausted. Reserving
 * synchronously here — instead of recording after the awaited bcrypt compare —
 * closes the check/record race that let concurrent requests bypass the limit.
 * Requests with no attributable IP are not limited, so direct local access by
 * the admin cannot be locked out by a shared bucket.
 */
export function checkLoginRateLimit(ip: string): {
  allowed: boolean;
  retryAfterMs: number;
} {
  if (!ip) {
    return { allowed: true, retryAfterMs: 0 };
  }

  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (entry && entry.resetAt <= now) {
    loginAttempts.delete(ip);
    entry = undefined;
  }

  if (!entry) {
    if (loginAttempts.size >= MAX_BUCKETS) {
      evictExpired(now);
      if (loginAttempts.size >= MAX_BUCKETS) {
        evictOldest();
      }
    }
    entry = { count: 0, resetAt: now + WINDOW_MS };
    loginAttempts.set(ip, entry);
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

/** Clear rate limit entries for the given IP (called on successful login). */
export function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

/** Reset all rate limit state. For testing only. */
export function resetLoginRateLimiter(): void {
  loginAttempts.clear();
}
