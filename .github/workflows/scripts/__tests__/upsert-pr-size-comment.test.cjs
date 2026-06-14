/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMMENT_MARKER,
  buildCommentBody,
  findExistingComment,
  shouldWarnLargePr,
  toNumber,
} = require('../upsert-pr-size-comment.cjs');

test('buildCommentBody prefixes the sticky marker and current size evidence', () => {
  const body = buildCommentBody(713308, 15);

  assert.match(body, new RegExp(`^${COMMENT_MARKER}`));
  assert.match(body, /\*\*Large PR\*\* \(713308 lines across 15 files\)/);
  assert.match(body, /Consider splitting into smaller, focused PRs/);
});

test('findExistingComment returns the workflow-owned sticky large PR comment', () => {
  const existing = findExistingComment([
    {
      id: 1,
      user: { login: 'github-actions[bot]' },
      body: `${COMMENT_MARKER}\nold body`,
    },
    {
      id: 2,
      user: { login: 'kostua16' },
      body: `${COMMENT_MARKER}\nmanual note`,
    },
  ]);

  assert.equal(existing?.id, 1);
});

test('findExistingComment ignores plain duplicate text without the marker', () => {
  const existing = findExistingComment([
    {
      id: 1,
      user: { login: 'github-actions[bot]' },
      body: '> **Large PR** (713308 lines across 15 files)',
    },
  ]);

  assert.equal(existing, null);
});

test('shouldWarnLargePr only warns when the threshold is exceeded', () => {
  assert.equal(shouldWarnLargePr(800), false);
  assert.equal(shouldWarnLargePr(801), true);
  assert.equal(shouldWarnLargePr(800, 100), true);
});

test('toNumber returns null for null/undefined so ?? fallbacks fire correctly', () => {
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(undefined), null);
  assert.equal(toNumber('0'), 0);
  assert.equal(toNumber('42'), 42);
  assert.equal(toNumber('not-a-number'), null);
});
