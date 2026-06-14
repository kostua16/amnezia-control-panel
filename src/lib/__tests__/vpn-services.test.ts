import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
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
  // A syntactically valid username passes sanitizeUsername and proceeds to the
  // real CLI. With no `awg` binary in the test environment, key generation
  // fails, but the failure must come from the CLI layer (not validation) and
  // still be wrapped as a structured result — proving the sanitizer accepted
  // the input and the error path does not leak thrown exceptions.
  it('createAwgUser accepts a valid username and reports a non-validation failure', async () => {
    const result = await createAwgUser('alice_01');
    assert.equal(result.success, false);
    assert.doesNotMatch(
      result.message,
      /invalid characters/i,
      'A valid username must not fail at the validation step',
    );
  });
});
