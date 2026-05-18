import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Sign a JSON payload with HMAC-SHA256.
 * payload is stringified internally to ensure deterministic input.
 */
export function signPayload(payload: unknown, secret: string): string {
  const data = JSON.stringify(payload);
  return createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Verify an HMAC-SHA256 signature using timing-safe comparison.
 * Returns true if the signature matches the payload+secret.
 */
export function verifySignature(
  payload: unknown,
  secret: string,
  signature: string,
): boolean {
  const expected = signPayload(payload, secret);
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex'),
    );
  } catch {
    return false;
  }
}
