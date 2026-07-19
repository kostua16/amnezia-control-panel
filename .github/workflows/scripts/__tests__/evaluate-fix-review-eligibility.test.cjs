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

test('manual repair skips automation planning and dependency classes', () => {
  const cases = [
    {
      branch: 'claude-auto-fix-ci-review-follow-up',
      labels: ['needs-review', 'ai-review-concerns'],
      expectedClass: 'automation-fix',
    },
    {
      branch: 'claude-planning-pr-533',
      labels: ['needs-review'],
      expectedClass: 'trusted-planning',
    },
    {
      branch: 'dependabot/npm_and_yarn/eslint-9.0.0',
      labels: ['needs-review'],
      expectedClass: 'dependabot',
    },
  ];

  for (const item of cases) {
    const result = evaluateFixReviewEligibility({
      pr: pr({
        headRefName: item.branch,
        labels: item.labels,
        files: [{ path: '.planning/example.md', additions: 1, deletions: 1 }],
      }),
      policy,
      files: [{ filename: '.planning/example.md', additions: 1, deletions: 1 }],
    });

    assert.equal(result.eligible, false, item.branch);
    assert.equal(result.pr_class, item.expectedClass, item.branch);
    assert.match(result.reason, /requires automation review loop/, item.branch);
  }
});

test('automation review loop can repair automation classes selected by auto-cover', () => {
  const result = evaluateFixReviewEligibility({
    pr: pr({
      headRefName: 'claude-auto-fix-ci-review-follow-up',
      labels: ['needs-review', 'ai-review-concerns'],
    }),
    policy,
    automationReviewLoop: true,
  });

  assert.equal(result.eligible, true);
  assert.equal(result.pr_class, 'automation-fix');
  assert.equal(result.automation_review_loop, true);
});

test('allow_protected_edits defaults off without label or flag', () => {
  const result = evaluateFixReviewEligibility({
    pr: pr(),
    policy,
    expectedHeadSha: 'b6205dce2cbb3bfe528b6b3839d7e0edbc2594aa',
  });
  assert.equal(result.allow_protected_edits, false);
});

test('allow_protected_edits set by the policy-defined PR label', () => {
  const result = evaluateFixReviewEligibility({
    pr: pr({
      labels: [
        'auto-fix',
        'gsd-plan-execution',
        policy.protectedEditsLabel || 'allow-protected-edits',
      ],
    }),
    policy,
    expectedHeadSha: 'b6205dce2cbb3bfe528b6b3839d7e0edbc2594aa',
  });
  assert.equal(result.allow_protected_edits, true);
});

test('allow_protected_edits set by the trigger flag without the label', () => {
  const result = evaluateFixReviewEligibility({
    pr: pr(),
    policy,
    expectedHeadSha: 'b6205dce2cbb3bfe528b6b3839d7e0edbc2594aa',
    allowProtectedEdits: 'true',
  });
  assert.equal(result.allow_protected_edits, true);
});

test('policy.protectedEditsLabel names the recognized label', () => {
  assert.equal(typeof policy.protectedEditsLabel, 'string');
  assert.ok(
    policy.labels[policy.protectedEditsLabel],
    'protected-edits label must be defined in policy.labels so ensure-workflow-labels can create it',
  );
  const result = evaluateFixReviewEligibility({
    pr: pr({ labels: ['custom-allow'] }),
    policy: { ...policy, protectedEditsLabel: 'custom-allow' },
    expectedHeadSha: 'b6205dce2cbb3bfe528b6b3839d7e0edbc2594aa',
  });
  assert.equal(result.allow_protected_edits, true);
});
