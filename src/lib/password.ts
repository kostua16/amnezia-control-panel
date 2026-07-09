import { createHash } from 'crypto';
import { hash, compare } from 'bcryptjs';

/** Hash a plaintext value using bcrypt with 10 salt rounds. */
export async function hashValue(plaintext: string): Promise<string> {
  return hash(plaintext, 10);
}

/** Verify a plaintext value against an existing bcrypt hash. */
export async function verifyValue(
  plaintext: string,
  hashStr: string,
): Promise<boolean> {
  return compare(plaintext, hashStr);
}

/**
 * Compute a fast SHA-256 hash of a plaintext value.
 * Used for O(1) indexed lookups before expensive bcrypt verification.
 */
export function fastHash(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
