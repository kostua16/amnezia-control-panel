/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  KILO_MARKER,
  KILO_LOGINS,
  isKiloUser,
  isKiloSummary,
} = require('../lib/kilo.cjs');

test('KILO_MARKER and KILO_LOGINS are the canonical constants', () => {
  assert.equal(KILO_MARKER, '<!-- kilo-review -->');
  assert.deepEqual(KILO_LOGINS, ['kilo-code-bot', 'kilo-code-bot[bot]']);
});

test('isKiloUser accepts both Kilo bot login variants', () => {
  assert.equal(isKiloUser({ login: 'kilo-code-bot' }), true);
  assert.equal(isKiloUser({ login: 'kilo-code-bot[bot]' }), true);
  assert.equal(isKiloUser({ author: { login: 'kilo-code-bot[bot]' } }), true);
  assert.equal(isKiloUser({ login: 'github-actions[bot]' }), false);
  assert.equal(isKiloUser({ login: 'octocat' }), false);
  assert.equal(isKiloUser({}), false);
});

test('isKiloSummary requires both a Kilo author and the marker', () => {
  assert.equal(
    isKiloSummary({
      user: { login: 'kilo-code-bot[bot]' },
      body: '<!-- kilo-review -->\nblocked',
    }),
    true,
  );
  assert.equal(
    isKiloSummary({
      author: { login: 'kilo-code-bot' },
      body: '<!-- kilo-review -->\nblocked',
    }),
    true,
  );
  assert.equal(
    isKiloSummary({
      user: { login: 'octocat' },
      body: '<!-- kilo-review -->\nblocked',
    }),
    false,
  );
  assert.equal(
    isKiloSummary({
      user: { login: 'kilo-code-bot[bot]' },
      body: 'no marker here',
    }),
    false,
  );
});
