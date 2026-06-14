import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeUsername,
  createAwgUser,
  deleteAwgUser,
  blockAwgUser,
  unblockAwgUser,
  createThreeXuiUser,
  deleteThreeXuiUser,
  blockThreeXuiUser,
  unblockThreeXuiUser,
} from '../vpn-services';

/**
 * Coverage for vpn-services username sanitization and error wrapping.
 *
 * Every exported CRUD function validates the username via sanitizeUsername()
 * before touching the WireGuard CLI, the 3x-ui HTTP API, or the database.
 * Invalid input therefore fails fast and is wrapped as a structured
 * { success: false, message } result instead of throwing, so callers (the
 * API layer, user-sync reconciliation) can report the failure cleanly.
 *
 * These cases exercise the validation path deterministically without a real
 * `awg` binary, a live 3x-ui panel, or a seeded database.
 */

const INVALID_USERNAMES: Array<[string, string]> = [
  ['has space', 'spaces are not in the allowed character class'],
  ['bad/chars!', 'slashes and exclamation marks are rejected'],
  ['', 'empty string matches nothing'],
  ['naïve', 'non-ASCII characters are rejected'],
];

describe('vpn-services: AWG username sanitization and error wrapping', () => {
  for (const [username, reason] of INVALID_USERNAMES) {
    it(`createAwgUser rejects "${username}" (${reason})`, async () => {
      const result = await createAwgUser(username);
      assert.equal(
        result.success,
        false,
        'Invalid username must not produce a successful AWG peer',
      );
      assert.match(
        result.message,
        /invalid characters/i,
        'Failure message should explain the validation failure',
      );
      assert.equal(
        result.config,
        undefined,
        'No partial config should be returned for invalid input',
      );
    });
  }

  it('deleteAwgUser wraps invalid-username validation as a structured failure', async () => {
    const result = await deleteAwgUser('not allowed');
    assert.equal(result.success, false);
    assert.match(result.message, /invalid characters/i);
  });

  it('blockAwgUser wraps invalid-username validation as a structured failure', async () => {
    const result = await blockAwgUser('bad/name');
    assert.equal(result.success, false);
    assert.match(result.message, /invalid characters/i);
  });

  it('unblockAwgUser wraps invalid-username validation as a structured failure', async () => {
    const result = await unblockAwgUser('bad name');
    assert.equal(result.success, false);
    assert.match(result.message, /invalid characters/i);
  });
});

describe('vpn-services: 3x-ui username sanitization and error wrapping', () => {
  for (const [username, reason] of INVALID_USERNAMES) {
    it(`createThreeXuiUser rejects "${username}" (${reason})`, async () => {
      const result = await createThreeXuiUser(username);
      assert.equal(
        result.success,
        false,
        'Invalid username must not create a 3x-ui client',
      );
      assert.match(result.message, /invalid characters/i);
      assert.equal(result.config, undefined);
    });
  }

  it('deleteThreeXuiUser wraps invalid-username validation as a structured failure', async () => {
    const result = await deleteThreeXuiUser('bad/name');
    assert.equal(result.success, false);
    assert.match(result.message, /invalid characters/i);
  });

  it('blockThreeXuiUser wraps invalid-username validation as a structured failure', async () => {
    const result = await blockThreeXuiUser('bad name');
    assert.equal(result.success, false);
    assert.match(result.message, /invalid characters/i);
  });

  it('unblockThreeXuiUser wraps invalid-username validation as a structured failure', async () => {
    const result = await unblockThreeXuiUser('bad/name!');
    assert.equal(result.success, false);
    assert.match(result.message, /invalid characters/i);
  });
});

describe('vpn-services: valid usernames are accepted by the sanitizer', () => {
  // Tests sanitizeUsername directly — deterministic, no CLI or database
  // dependency.  Invalid inputs already covered in the rejection describe
  // blocks above; here we prove the positive case and a negative control.
  const VALID_USERNAMES = ['alice_01', 'bob.test-1', 'user_name.here'];

  for (const username of VALID_USERNAMES) {
    it(`sanitizeUsername accepts "${username}" without throwing`, () => {
      assert.doesNotThrow(
        () => sanitizeUsername(username),
        `Valid username "${username}" must not trigger the sanitizer`,
      );
    });
  }

  it('sanitizeUsername rejects an invalid username as a negative control', () => {
    assert.throws(
      () => sanitizeUsername('bad name'),
      /invalid characters/i,
      'Invalid username must still be rejected by the sanitizer',
    );
  });
});
