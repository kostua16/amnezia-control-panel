import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDeterministicPublicKey,
  generateKeypair,
  isValidWireGuardKey,
} from '../wireguard-keys';

describe('generateKeypair', () => {
  it('returns a publicKey and privateKey', () => {
    const { publicKey, privateKey } = generateKeypair();
    assert.equal(typeof publicKey, 'string');
    assert.equal(typeof privateKey, 'string');
  });

  it('keys are valid WireGuard base64 (44 chars, trailing =)', () => {
    const { publicKey, privateKey } = generateKeypair();
    assert.equal(publicKey.length, 44);
    assert.equal(privateKey.length, 44);
    assert.ok(publicKey.endsWith('='));
    assert.ok(privateKey.endsWith('='));
  });

  it('keys decode to exactly 32 bytes (Curve25519)', () => {
    const { publicKey, privateKey } = generateKeypair();
    const pubBytes = Buffer.from(publicKey, 'base64');
    const privBytes = Buffer.from(privateKey, 'base64');
    assert.equal(pubBytes.length, 32);
    assert.equal(privBytes.length, 32);
  });

  it('keys pass isValidWireGuardKey', () => {
    const { publicKey, privateKey } = generateKeypair();
    assert.ok(isValidWireGuardKey(publicKey));
    assert.ok(isValidWireGuardKey(privateKey));
  });

  it('generates unique keys across calls', () => {
    const a = generateKeypair();
    const b = generateKeypair();
    assert.notEqual(a.publicKey, b.publicKey);
    assert.notEqual(a.privateKey, b.privateKey);
  });

  it('publicKey differs from privateKey within a pair', () => {
    const { publicKey, privateKey } = generateKeypair();
    assert.notEqual(publicKey, privateKey);
  });
});

describe('isValidWireGuardKey', () => {
  it('accepts a real generated key', () => {
    const { publicKey } = generateKeypair();
    assert.ok(isValidWireGuardKey(publicKey));
  });

  it('rejects empty string', () => {
    assert.ok(!isValidWireGuardKey(''));
  });

  it('rejects wrong length', () => {
    assert.ok(
      !isValidWireGuardKey('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    );
  });

  it('rejects missing trailing padding', () => {
    // 43 chars without trailing =
    assert.ok(
      !isValidWireGuardKey('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    );
  });

  it('rejects non-base64 characters', () => {
    assert.ok(
      !isValidWireGuardKey('!!!AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),
    );
  });

  it('rejects non-key strings', () => {
    assert.ok(!isValidWireGuardKey('STUB_PUBLIC_KEY'));
  });

  it('rejects null-like values without throwing', () => {
    assert.ok(!isValidWireGuardKey(undefined));
    assert.ok(!isValidWireGuardKey(null));
  });
});

describe('generateDeterministicPublicKey', () => {
  it('returns the same valid key for the same seed', () => {
    const first = generateDeterministicPublicKey('template|entry|exit');
    const second = generateDeterministicPublicKey('template|entry|exit');

    assert.equal(first, second);
    assert.ok(isValidWireGuardKey(first));
  });

  it('returns different valid keys for different seeds', () => {
    const first = generateDeterministicPublicKey('template|entry|exit');
    const second = generateDeterministicPublicKey('template|exit|entry');

    assert.notEqual(first, second);
    assert.ok(isValidWireGuardKey(first));
    assert.ok(isValidWireGuardKey(second));
  });
});
