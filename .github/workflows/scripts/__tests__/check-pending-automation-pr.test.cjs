/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  countOpenAutomationPrs,
  findPendingPullRequest,
} = require('../check-pending-automation-pr.cjs');

const AUDIT_PREFIX = 'ci(workflows): audit automation-created PRs';
const SUGGEST_PREFIX = 'planning: repo-wide improvement follow-ups';

test('returns the matching PR when title prefix matches and it is not self', () => {
  const prs = [{ number: 1, title: AUDIT_PREFIX, headRefName: 'claude-a' }];
  const result = findPendingPullRequest(prs, {
    titlePrefix: AUDIT_PREFIX,
    excludeHead: 'self',
  });
  assert.deepEqual(result, prs[0]);
});

test('returns null when no open PR matches the title prefix', () => {
  const prs = [
    { number: 2, title: 'planning: unrelated follow-ups', headRefName: 'b' },
  ];
  const result = findPendingPullRequest(prs, {
    titlePrefix: AUDIT_PREFIX,
    excludeHead: 'self',
  });
  assert.equal(result, null);
});

test('excludes self by head ref even when the title matches', () => {
  const prs = [{ number: 3, title: AUDIT_PREFIX, headRefName: 'self-branch' }];
  const result = findPendingPullRequest(prs, {
    titlePrefix: AUDIT_PREFIX,
    excludeHead: 'self-branch',
  });
  assert.equal(result, null);
});

test('returns the first match when several sibling PRs are open', () => {
  const prs = [
    { number: 10, title: SUGGEST_PREFIX, headRefName: 'a' },
    { number: 11, title: SUGGEST_PREFIX, headRefName: 'b' },
  ];
  const result = findPendingPullRequest(prs, {
    titlePrefix: SUGGEST_PREFIX,
    excludeHead: 'self',
  });
  assert.equal(result.number, 10);
});

test('matches a title that is longer than the prefix (anchored prefix)', () => {
  const prs = [
    { number: 7, title: `${AUDIT_PREFIX} (rerun)`, headRefName: 'z' },
  ];
  const result = findPendingPullRequest(prs, {
    titlePrefix: AUDIT_PREFIX,
    excludeHead: 'self',
  });
  assert.equal(result.number, 7);
});

test('does not match when the prefix only appears mid-title', () => {
  const prs = [
    { number: 8, title: `fix: ${AUDIT_PREFIX} bug`, headRefName: 'w' },
  ];
  const result = findPendingPullRequest(prs, {
    titlePrefix: AUDIT_PREFIX,
    excludeHead: 'self',
  });
  assert.equal(result, null);
});

test('returns null for an empty pull request list', () => {
  assert.equal(
    findPendingPullRequest([], {
      titlePrefix: AUDIT_PREFIX,
      excludeHead: 'self',
    }),
    null,
  );
});

test('skips null and non-object entries without throwing', () => {
  const prs = [
    null,
    'nope',
    undefined,
    { number: 5, title: AUDIT_PREFIX, headRefName: 'y' },
  ];
  const result = findPendingPullRequest(prs, {
    titlePrefix: AUDIT_PREFIX,
    excludeHead: 'self',
  });
  assert.equal(result.number, 5);
});

test('treats a missing excludeHead as "do not exclude any branch"', () => {
  const prs = [{ number: 9, title: AUDIT_PREFIX, headRefName: 'same' }];
  const result = findPendingPullRequest(prs, { titlePrefix: AUDIT_PREFIX });
  assert.equal(result.number, 9);
});

test('P9b: counts only automation-branch PRs for fleet back-pressure', () => {
  const prs = [
    { number: 1, title: 'a', headRefName: 'claude-audit-fix-1' },
    { number: 2, title: 'b', headRefName: 'claude/interactive-work' },
    { number: 3, title: 'c', headRefName: 'codex/fix-thing' },
    { number: 4, title: 'd', headRefName: 'dependabot/npm_and_yarn/x-1.0' },
    { number: 5, title: 'e', headRefName: 'feature/manual-work' },
    null,
    'nope',
  ];
  assert.equal(countOpenAutomationPrs(prs), 3);
});

test('P9b: excludeHead removes this run’s own branch from the count', () => {
  const prs = [
    { number: 1, title: 'a', headRefName: 'claude-audit-fix-1' },
    { number: 2, title: 'b', headRefName: 'claude-audit-fix-self' },
  ];
  assert.equal(
    countOpenAutomationPrs(prs, { excludeHead: 'claude-audit-fix-self' }),
    1,
  );
});

test('P9b: empty list counts zero', () => {
  assert.equal(countOpenAutomationPrs([]), 0);
});

test('returns null when no title prefix is given, so a back-pressure-only gate does not trip on any open PR', () => {
  const prs = [
    { number: 1, title: 'unrelated human PR', headRefName: 'feature/x' },
    { number: 2, title: 'another PR', headRefName: 'dependabot/y' },
  ];
  assert.equal(findPendingPullRequest(prs, { excludeHead: 'self' }), null);
});
