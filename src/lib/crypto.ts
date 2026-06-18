import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export async function hashSecret(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function verifySecret(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
