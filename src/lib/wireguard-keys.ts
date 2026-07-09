import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from 'crypto';

/**
 * Valid WireGuard base64 public/private key: 44 characters ending with `=`.
 *
 * Curve25519 keys are 32 raw bytes → base64 encodes to 44 characters
 * (32 * 4/3 = 42.67, padded to 44 with the trailing `=`).
 */
const WG_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const X25519_PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b656e04220420',
  'hex',
);

function clampX25519Scalar(seed: Buffer): Buffer {
  const scalar = Buffer.from(seed);
  scalar[0] &= 248;
  scalar[31] &= 127;
  scalar[31] |= 64;
  return scalar;
}

function jwkFieldToWireGuardKey(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`x25519 JWK export missing ${label} key material`);
  }
  const raw = Buffer.from(value, 'base64url');
  if (raw.length !== 32) {
    throw new Error(`Unexpected x25519 ${label} key length`);
  }
  return raw.toString('base64');
}

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

  return {
    publicKey: jwkFieldToWireGuardKey(pair.publicKey.x, 'public'),
    privateKey: jwkFieldToWireGuardKey(pair.privateKey.d, 'private'),
  };
}

export function generateDeterministicPublicKey(seed: string): string {
  const scalar = clampX25519Scalar(createHash('sha256').update(seed).digest());
  const privateDer = Buffer.concat([X25519_PKCS8_PREFIX, scalar]);
  const privateKey = createPrivateKey({
    key: privateDer,
    format: 'der',
    type: 'pkcs8',
  });
  const publicDer = createPublicKey(privateKey).export({
    format: 'jwk',
  });
  return jwkFieldToWireGuardKey(publicDer.x, 'public');
}

/**
 * Check whether a string is a valid WireGuard base64 key (32 bytes encoded).
 */
export function isValidWireGuardKey(key: unknown): key is string {
  return typeof key === 'string' && WG_KEY_PATTERN.test(key);
}
