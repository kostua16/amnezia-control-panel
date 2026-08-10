/* eslint-disable @typescript-eslint/no-require-imports */
// Producer -> renderer -> consumer roundtrip for the fix-review skip summary.
// Proves that a skip verdict flows from evaluate-fix-review-eligibility (code)
// through renderSkipped (machine-readable tag + stamped SHA) into
// evaluateAutoCoverReview's dispatch decision, and that the two BLOCKER paths
// (manual-only class, stale dispatch) no longer permanently suppress an
// eligible automated repair while a genuinely terminal skip still does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  evaluateFixReviewEligibility,
} = require('../evaluate-fix-review-eligibility.cjs');
const { renderSkipped } = require('../upsert-fix-review-comment.cjs');
const {
  evaluateAutoCoverReview,
  TRUSTED_FIX_REVIEW_LOGIN,
} = require('../evaluate-auto-cover-review.cjs');

const policy = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'policy.json'), 'utf8'),
);

const LIVE_SHA = 'b6205dce2cbb3bfe528b6b3839d7e0edbc2594aa';
const EXPECTED_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// An automation-owned, review-blocked PR: the only class auto-cover repairs,
// carrying an internal review concern so the consumer would otherwise dispatch.
function automationPr(overrides = {}) {
  return {
    number: 530,
    title: 'ci(workflows): auto-fix review follow-up',
    state: 'OPEN',
    mergedAt: null,
    isDraft: false,
    isCrossRepository: false,
    headRefName: 'claude-auto-fix-ci-review-follow-up',
    headRefOid: LIVE_SHA,
    baseRefName: 'main',
    labels: ['needs-review', 'ai-review-concerns', 'auto-fix'],
    files: [{ path: '.planning/example.md', additions: 1, deletions: 1 }],
    ...overrides,
  };
}

// Mirrors the fix-review.yml skip step: a stale verdict is stamped with the
// expected (abandoned) SHA, every other skip with the live head SHA.
function stampShaFor(code, liveSha, expectedSha) {
  return code === 'stale' && expectedSha ? expectedSha : liveSha;
}

// Run the full pipe: eligibility verdict -> rendered summary -> auto-cover
// decision. The consumer evaluates the LIVE head (as auto-cover does), with no
// expected-head staleness of its own.
function roundtrip({ pr, eligibility, expectedSha }) {
  const stampSha = stampShaFor(
    eligibility.skip_reason_code,
    eligibility.head_sha,
    expectedSha,
  );
  const body = renderSkipped({
    headSha: stampSha,
    runUrl: 'https://example.com/o/r/actions/runs/1',
    reason: eligibility.reason,
    skipReasonCode: eligibility.skip_reason_code,
    updatedAt: '2026-08-10T00:00:00.000Z',
  });
  return evaluateAutoCoverReview({
    pr,
    policy,
    files: [{ filename: '.planning/example.md', additions: 1, deletions: 1 }],
    comments: [{ body, user: { login: TRUSTED_FIX_REVIEW_LOGIN } }],
    attempts: [],
    fixReviewRuns: [],
  });
}

// BLOCKER path 1: a manual /fix-review is rejected with "requires automation
// review loop", but auto-cover dispatches the same repair in automation mode
// (automationReviewLoop=true). The skip must not suppress that dispatch.
test('requires-automation-loop skip does not suppress automation repair', () => {
  const eligibility = evaluateFixReviewEligibility({
    pr: automationPr(),
    policy,
    files: [{ filename: '.planning/example.md', additions: 1, deletions: 1 }],
    automationReviewLoop: false,
  });

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.skip_reason_code, 'requires-automation-loop');

  const result = roundtrip({ pr: automationPr(), eligibility });
  assert.equal(result.should_run, true);
});

// BLOCKER path 2: the head moved between dispatch and run, so fix-review skips
// as stale. The workflow stamps the EXPECTED sha, so the live head never
// matches; and even if it did, "stale" is non-terminal. Repair is not blocked.
test('stale-dispatch skip does not permanently suppress repair', () => {
  const eligibility = evaluateFixReviewEligibility({
    pr: automationPr(),
    policy,
    expectedHeadSha: EXPECTED_SHA,
  });

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.skip_reason_code, 'stale');

  const result = roundtrip({
    pr: automationPr(),
    eligibility,
    expectedSha: EXPECTED_SHA,
  });
  assert.equal(result.should_run, true);
});

// Control: a genuinely terminal skip (hard repair blocker) still suppresses,
// preserving the feature for conditions that stay ineligible under automation.
test('terminal hard-blocker skip still suppresses automation repair', () => {
  const eligibility = evaluateFixReviewEligibility({
    pr: automationPr({
      labels: ['needs-review', 'ai-review-concerns', 'do-not-merge'],
    }),
    policy,
  });

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.skip_reason_code, 'hard-blocker');

  // Note: the consumer's own do-not-merge check (run before the skip check)
  // already blocks this PR; this case confirms the pipe renders and parses the
  // terminal code without error. Use a PR whose hard-blocker was since removed
  // to isolate the skip-summary suppression path:
  const result = roundtrip({
    // Consumer sees a PR with the blocker already removed, so only the
    // same-head terminal skip summary can suppress it.
    pr: automationPr(),
    eligibility,
  });
  assert.equal(result.should_run, false);
});
