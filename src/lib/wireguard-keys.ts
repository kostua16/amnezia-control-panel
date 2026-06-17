import { generateKeyPairSync } from 'crypto';

/**
 * Valid WireGuard base64 public/private key: 44 characters ending with `=`.
 *
 * Curve25519 keys are 32 raw bytes → base64 encodes to 44 characters
 * (32 * 4/3 = 42.67, padded to 44 with the trailing `=`).
 */
const WG_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

/**
 * Generate a WireGuard Curve25519 (x25519) keypair.
 *
 * Uses Node.js `crypto.generateKeyPairSync` with the `x25519` curve and
 * exports the raw public/private keys, then base64-encodes them to the
 * WireGuard wire format.
 */
export function generateKeypair(): {
  publicKey: string;
  privateKey: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync('x25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  // DER-encoded SPKI for x25519: 44 bytes. Raw key is the last 32 bytes.
  const pubRaw = Buffer.from(publicKey).subarray(-32);
  const privRaw = Buffer.from(privateKey).subarray(-32);

  return {
    publicKey: pubRaw.toString('base64'),
    privateKey: privRaw.toString('base64'),
  };
}

/**
 * Check whether a string is a valid WireGuard base64 key (32 bytes encoded).
 */
export function isValidWireGuardKey(key: string): boolean {
  return WG_KEY_PATTERN.test(key);
}
