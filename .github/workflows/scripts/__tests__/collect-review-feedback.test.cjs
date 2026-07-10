/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRepo,
  isTrustedKiloSummary,
  isNoiseComment,
  formatBundle,
  hasActionableFeedback,
  bundleHasActionableFeedback,
  extractReviewThreads,
  REVIEW_THREAD_FETCH_FAILURE_POLICY,
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

test('hasActionableFeedback sees trusted Kilo summaries as feedback', () => {
  const comments = [
    {
      author: 'kilo-code-bot[bot]',
      body: '<!-- kilo-review -->\nStatus: 1 Issue Found',
    },
  ];
  const md = formatBundle({
    threads: [],
    reviews: [],
    comments,
    diff: 'diff',
  });
  assert.equal(hasActionableFeedback({ comments }), true);
  assert.equal(bundleHasActionableFeedback(md), true);
});

test('extractReviewThreads keeps unresolved Kilo issue and suggestion comments', () => {
  const threads = extractReviewThreads([
    {
      isResolved: false,
      isOutdated: true,
      path: 'src/lib/api-client.ts',
      line: null,
      comments: {
        nodes: [
          {
            author: { login: 'kilo-code-bot' },
            body: 'stale critical from old diff',
          },
        ],
      },
    },
    {
      isResolved: false,
      isOutdated: false,
      path: 'src/hooks/use-users.ts',
      line: 48,
      comments: {
        nodes: [
          {
            author: { login: 'kilo-code-bot' },
            body: '**Severity**: critical\n\n**The Fix**: preserve pagination',
          },
        ],
      },
    },
    {
      isResolved: false,
      isOutdated: false,
      path: 'src/hooks/use-alerts.ts',
      line: 31,
      comments: {
        nodes: [
          {
            author: { login: 'kilo-code-bot' },
            body: '**Severity**: suggestion\n\n**The Fix**: add coverage',
          },
        ],
      },
    },
  ]);

  assert.deepEqual(threads, [
    {
      path: 'src/hooks/use-users.ts',
      line: 48,
      author: 'kilo-code-bot',
      body: '**Severity**: critical\n\n**The Fix**: preserve pagination',
    },
    {
      path: 'src/hooks/use-alerts.ts',
      line: 31,
      author: 'kilo-code-bot',
      body: '**Severity**: suggestion\n\n**The Fix**: add coverage',
    },
  ]);
});

test('review thread collection is intentionally fail-closed', () => {
  assert.equal(REVIEW_THREAD_FETCH_FAILURE_POLICY, 'fail-closed');
});

test('hasActionableFeedback sees review submission bodies as feedback', () => {
  const reviews = [
    { state: 'COMMENTED', author: 'reviewer', body: 'Please tighten this.' },
  ];
  const md = formatBundle({
    threads: [],
    reviews,
    comments: [],
    diff: 'diff',
  });
  assert.equal(hasActionableFeedback({ reviews }), true);
  assert.equal(bundleHasActionableFeedback(md), true);
});

test('bundleHasActionableFeedback treats all-empty feedback sections as absent', () => {
  const md = formatBundle({
    threads: [],
    reviews: [],
    comments: [],
    diff: 'diff still exists',
  });
  assert.equal(hasActionableFeedback({}), false);
  assert.equal(bundleHasActionableFeedback(md), false);
});

test('sticky summaries and slash commands remain noise', () => {
  const comments = [
    {
      user: { login: 'alice', type: 'User' },
      body: '<!-- rebase-pr-summary -->\n## Rebase complete',
    },
    { user: { login: 'bob', type: 'User' }, body: '/rebase' },
  ];
  const actionable = comments.filter((comment) => !isNoiseComment(comment));
  const md = formatBundle({
    threads: [],
    reviews: [],
    comments: actionable,
    diff: 'diff',
  });
  assert.deepEqual(actionable, []);
  assert.equal(bundleHasActionableFeedback(md), false);
});
