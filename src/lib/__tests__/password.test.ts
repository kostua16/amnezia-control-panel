import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashValue, verifyValue } from '../password';

describe('password', () => {
  it('hashValue produces a bcrypt hash', async () => {
    const hashStr = await hashValue('hello');
    // bcrypt hashes always start with $2
    assert.ok(
      hashStr.startsWith('$2'),
      `hash should start with $2, got: ${hashStr}`,
    );
    assert.notStrictEqual(hashStr, 'hello');
  });

  it('verifyValue returns true for correct plaintext', async () => {
    const hashStr = await hashValue('secret');
    const result = await verifyValue('secret', hashStr);
    assert.strictEqual(result, true);
  });

  it('verifyValue returns false for wrong plaintext', async () => {
    const hashStr = await hashValue('secret');
    const result = await verifyValue('wrong', hashStr);
    assert.strictEqual(result, false);
  });
});
