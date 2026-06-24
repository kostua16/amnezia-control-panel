/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRepo,
  isTrustedKiloSummary,
  isNoiseComment,
  formatBundle,
} = require('../collect-review-feedback.cjs');

test('parseRepo splits owner/name', () => {
  assert.deepEqual(parseRepo('owner/repo'), { owner: 'owner', name: 'repo' });
  assert.throws(() => parseRepo('bad'), /owner\/name/);
});

test('isNoiseComment drops bots, slash commands, and sticky markers', () => {
  assert.equal(
    isNoiseComment({
      user: { login: 'github-actions[bot]', type: 'Bot' },
      body: 'x',
    }),
    true,
  );
  assert.equal(
    isTrustedKiloSummary({
      user: { login: 'kilo-code-bot[bot]', type: 'Bot' },
      body: '<!-- kilo-review -->\nStatus: 1 Issue Found',
    }),
    true,
  );
  assert.equal(
    isNoiseComment({
      user: { login: 'kilo-code-bot[bot]', type: 'Bot' },
      body: '<!-- kilo-review -->\nStatus: 1 Issue Found',
    }),
    false,
  );
  assert.equal(
    isNoiseComment({
      user: { login: 'alice', type: 'User' },
      body: '/fix-review',
    }),
    true,
  );
  assert.equal(
    isNoiseComment({
      user: { login: 'alice', type: 'User' },
      body: '/address-review please',
    }),
    true,
  );
  assert.equal(
    isNoiseComment({
      user: { login: 'alice', type: 'User' },
      body: '<!-- code-review-summary -->\n## done',
    }),
    true,
  );
  assert.equal(
    isNoiseComment({
      user: { login: 'alice', type: 'User' },
      body: 'This null check looks wrong.',
    }),
    false,
  );
});

test('formatBundle renders all sections and labels empties', () => {
  const md = formatBundle({
    threads: [
      { path: 'src/a.ts', line: 10, author: 'bob', body: 'guard null' },
    ],
    reviews: [{ state: 'CHANGES_REQUESTED', author: 'carol', body: 'plz fix' }],
    comments: [],
    diff: 'diff body',
  });
  assert.match(md, /Unresolved, non-outdated review threads/);
  assert.match(md, /`src\/a\.ts`:10 \(@bob\): guard null/);
  assert.match(md, /Review submissions/);
  assert.match(md, /@carol, CHANGES_REQUESTED\): plz fix/);
  assert.match(md, /PR comments \(non-command, human\)/);
  assert.match(md, /_None\./);
  assert.match(md, /```diff\ndiff body\n```/);
});

test('formatBundle labels every section empty when there is no feedback', () => {
  const md = formatBundle({
    threads: [],
    reviews: [],
    comments: [],
    diff: '_diff unavailable_',
  });
  assert.match(md, /review threads\n_None\./);
  assert.match(md, /Review submissions\n_None\./);
  assert.match(md, /PR comments \(non-command, human\)\n_None\./);
});
