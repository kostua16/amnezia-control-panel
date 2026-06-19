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
