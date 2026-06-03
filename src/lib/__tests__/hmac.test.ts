import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signPayload, verifySignature } from '../hmac';

const SECRET = 'test-secret-key';

describe('hmac', () => {
  describe('signPayload', () => {
    it('produces a hex digest for a simple object', () => {
      const sig = signPayload({ a: 1 }, SECRET);
      assert.match(sig, /^[0-9a-f]{64}$/);
    });

    it('is deterministic — same input yields same signature', () => {
      const payload = { foo: 'bar', count: 42 };
      assert.strictEqual(
        signPayload(payload, SECRET),
        signPayload(payload, SECRET),
      );
    });

    it('changes when the payload changes', () => {
      assert.notStrictEqual(
        signPayload({ v: 1 }, SECRET),
        signPayload({ v: 2 }, SECRET),
      );
    });

    it('changes when the secret changes', () => {
      const payload = { x: 1 };
      assert.notStrictEqual(
        signPayload(payload, 'secret-a'),
        signPayload(payload, 'secret-b'),
      );
    });
  });

  describe('verifySignature', () => {
    it('returns true for a valid signature', () => {
      const payload = { action: 'sync', ts: 1000 };
      const sig = signPayload(payload, SECRET);
      assert.ok(verifySignature(payload, SECRET, sig));
    });

    it('returns false for a tampered payload', () => {
      const sig = signPayload({ action: 'sync' }, SECRET);
      assert.ok(!verifySignature({ action: 'destroy' }, SECRET, sig));
    });

    it('returns false for a wrong secret', () => {
      const sig = signPayload({ a: 1 }, SECRET);
      assert.ok(!verifySignature({ a: 1 }, 'wrong-secret', sig));
    });

    it('returns false for a malformed signature string', () => {
      assert.ok(!verifySignature({ a: 1 }, SECRET, 'not-hex'));
    });

    it('returns false for empty signature', () => {
      assert.ok(!verifySignature({ a: 1 }, SECRET, ''));
    });
  });
});
