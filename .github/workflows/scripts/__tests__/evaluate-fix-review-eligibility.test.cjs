/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  evaluateFixReviewEligibility,
} = require('../evaluate-fix-review-eligibility.cjs');

const policy = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'policy.json'), 'utf8'),
);

function pr(overrides = {}) {
  return {
    number: 520,
    title: 'feat(gsd): execute planning intake',
    state: 'OPEN',
    mergedAt: null,
    isDraft: false,
    isCrossRepository: false,
    headRefName: 'claude-gsd-planning-execute-28215679711',
    headRefOid: 'b6205dce2cbb3bfe528b6b3839d7e0edbc2594aa',
    baseRefName: 'main',
    labels: [
      'auto-fix',
      'needs-review',
      'security-review-passed',
      'ai-review-passed',
      'skip-improve',
      'flow/review-blocked',
      'gsd-plan-execution',
    ],
    files: [
      {
        path: '.github/workflows/scripts/__tests__/orchestrate-pr-flow.test.cjs',
        additions: 11,
        deletions: 1,
      },
      {
        path: '.planning/phases/999-gh-planning-execution-queue/999-047-PLAN.md',
        additions: 74,
        deletions: 0,
      },
    ],
    ...overrides,
  };
}

test('maintainer repair is allowed for Kilo-only blocked GSD PRs', () => {
  const result = evaluateFixReviewEligibility({
    pr: pr(),
    policy,
    expectedHeadSha: 'b6205dce2cbb3bfe528b6b3839d7e0edbc2594aa',
  });

  assert.equal(result.eligible, true);
  assert.equal(result.reason, null);
  assert.equal(result.pr_class, 'gsd-planning-execution');
  assert.equal(result.manual_only, true);
  assert.deepEqual(result.merge_blocking_labels, ['needs-review']);
  assert.deepEqual(result.repair_blocking_labels, []);
});

test('hard repair blockers still skip fix-review', () => {
  const result = evaluateFixReviewEligibility({
    pr: pr({ labels: ['needs-review', 'do-not-merge'] }),
    policy,
  });

  assert.equal(result.eligible, false);
  assert.match(result.reason, /do-not-merge/);
});

test('stale dispatch is skipped with a specific reason', () => {
  const result = evaluateFixReviewEligibility({
    pr: pr(),
    policy,
    expectedHeadSha: 'old-head',
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'PR head SHA is stale.');
});

test('automation review loop is retained as metadata, not required for repair', () => {
  const result = evaluateFixReviewEligibility({
    pr: pr({ labels: ['needs-review', 'security-review-concerns'] }),
    policy,
    automationReviewLoop: true,
  });

  assert.equal(result.eligible, true);
  assert.equal(result.automation_review_loop, true);
});
