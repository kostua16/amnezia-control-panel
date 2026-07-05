/**
 * In-memory fixed-window rate limiter for the login endpoint.
 *
 * Two layers:
 *  - Per-IP bucket: each client IP tracks consumed attempts and a window expiry.
 *  - Global backstop: a single aggregate bucket caps TOTAL attempts per window
 *    across all clients, regardless of source IP. This is the spoof-resistant
 *    bound — proxy headers like `x-forwarded-for` are client-controlled, so an
 *    attacker rotating a unique value per request gets a fresh per-IP bucket
 *    each time and would never trip the per-IP limit. The global cap bounds the
 *    total bcrypt compares (the CPU-exhaustion vector) such a flood can force.
 *
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

/** Aggregate backstop bucket shared by every client, keyed only by window. */
const globalBucket = { count: 0, resetAt: 0 };

/** Maximum login attempts per IP within the window before 429. */
const MAX_ATTEMPTS = 5;

/** Fixed window duration in milliseconds (15 minutes). */
const WINDOW_MS = 15 * 60 * 1000;

/** Upper bound on tracked IPs to keep memory finite under spoofed-IP floods. */
const MAX_BUCKETS = 10_000;

/**
 * Upper bound on TOTAL login attempts per window across all clients. Caps the
 * bcrypt CPU an attacker can force by rotating spoofed `x-forwarded-for`
 * values (each gets its own per-IP bucket), while leaving generous headroom
 * for single-admin legitimate use.
 */
const MAX_GLOBAL_ATTEMPTS = 50;

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
 * The per-IP bucket is checked and reserved first. The global backstop is only
 * charged once a request has passed its per-IP check and will actually proceed
 * to bcrypt — a per-IP-blocked request never reaches bcrypt, so it must not
 * consume a global slot. Charging the global bucket on the blocked path would
 * let a single attacker IP (which hits its per-IP limit after MAX_ATTEMPTS and
 * is then blocked indefinitely) burn the whole global cap and lock out every
 * login — including the legitimate admin — for the rest of the window. The
 * global cap instead bounds the bcrypt CPU an attacker can force by rotating
 * spoofed `x-forwarded-for` values, each of which gets a fresh per-IP bucket.
 *
 * Both buckets are reserved synchronously here, before any awaited work
 * (bcrypt), so concurrent requests cannot overrun either limit while the slow
 * comparison is in flight. Requests with no attributable IP skip per-IP
 * limiting, so direct local admin access cannot be locked out by a shared
 * per-IP bucket (but still count toward the global cap).
 */
export function checkLoginRateLimit(ip: string): {
  allowed: boolean;
  retryAfterMs: number;
} {
  const now = Date.now();

  if (globalBucket.resetAt <= now) {
    globalBucket.count = 0;
    globalBucket.resetAt = now + WINDOW_MS;
  }

  if (ip) {
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

    // Per-IP-blocked requests never reach bcrypt — return before the global
    // bucket is touched so one blocked IP cannot exhaust the global cap.
    if (entry.count >= MAX_ATTEMPTS) {
      return { allowed: false, retryAfterMs: entry.resetAt - now };
    }
    entry.count += 1;
  }

  // This request will proceed to bcrypt. Charge the global backstop now
  // (synchronously, before any await) to bound the total bcrypt work across
  // all clients, including spoofed-IP floods that each pass their own per-IP
  // bucket.
  if (globalBucket.count >= MAX_GLOBAL_ATTEMPTS) {
    return { allowed: false, retryAfterMs: globalBucket.resetAt - now };
  }
  globalBucket.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

/** Clear rate limit entries for the given IP (called on successful login). */
export function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

/** Reset all rate limit state. For testing only. */
export function resetLoginRateLimiter(): void {
  loginAttempts.clear();
  globalBucket.count = 0;
  globalBucket.resetAt = 0;
}
