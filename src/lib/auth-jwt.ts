import { SignJWT } from 'jose';

/** JWT session duration (matches cookie maxAge). */
const SESSION_DURATION = '24h';

/** Cookie maxAge in seconds (24 hours). */
export const SESSION_MAX_AGE = 86400;

/**
 * Threshold for the sliding-session window. When the token has ≤ 4 hours
 * remaining, a fresh token is re-issued on the next authenticated request.
 */
const SLIDING_WINDOW_THRESHOLD_MS = 4 * 60 * 60 * 1000;

export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  username: string;
  [key: string]: unknown;
}

/**
 * Create a signed JWT for an admin session.
 */
export async function createSessionToken(
  payload: SessionPayload,
): Promise<string> {
  const secret = getJwtSecret();
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(secret);
}

/**
 * Return true when the token's remaining lifetime is within the
 * sliding-window threshold (≤ 4 h). Called after successful verification
 * to decide whether to re-issue a fresh token.
 */
export function shouldRefreshToken(expiration: number): boolean {
  const remaining = expiration * 1000 - Date.now();
  return remaining <= SLIDING_WINDOW_THRESHOLD_MS;
}
