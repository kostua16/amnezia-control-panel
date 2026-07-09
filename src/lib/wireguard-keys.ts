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
 * Exports the keypair as JWK so the raw Curve25519 key material is delivered
 * directly (`x` = public, `d` = private) as base64url, with no DER/SPKI/PKCS8
 * framing to slice. Extraction therefore does not assume a specific DER prefix
 * length and stays stable across Node versions.
 */
export function generateKeypair(): {
  publicKey: string;
  privateKey: string;
} {
  const pair = generateKeyPairSync('x25519', {
    publicKeyEncoding: { format: 'jwk' },
    privateKeyEncoding: { format: 'jwk' },
  });

  const pubX = pair.publicKey.x;
  const privD = pair.privateKey.d;
  if (typeof pubX !== 'string' || typeof privD !== 'string') {
    throw new Error('x25519 JWK export missing key material');
  }

  return {
    publicKey: Buffer.from(pubX, 'base64url').toString('base64'),
    privateKey: Buffer.from(privD, 'base64url').toString('base64'),
  };
}

/**
 * Check whether a string is a valid WireGuard base64 key (32 bytes encoded).
 */
export function isValidWireGuardKey(key: string): boolean {
  return WG_KEY_PATTERN.test(key);
}
