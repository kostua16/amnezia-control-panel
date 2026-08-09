/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  evaluateAutoCoverReview,
  hasActiveFixReviewRun,
  hasFixReviewNoOp,
} = require('../evaluate-auto-cover-review.cjs');

const policy = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'policy.json'), 'utf8'),
);

function pr(overrides = {}) {
  return {
    number: 507,
    title: 'ci(workflows): audit automation-created PRs',
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    headRefOid: 'abc123',
    headRefName: 'claude-workflow-optimize-auto-pr-audit-1',
    baseRefName: 'main',
    labels: ['needs-review', 'ai-review-concerns'],
    files: ['.planning/example.md'],
    ...overrides,
  };
}

function run(input = {}) {
  return evaluateAutoCoverReview({
    pr: pr(input.pr),
    policy,
    files: input.files ?? [
      {
        filename: '.planning/example.md',
        additions: 1,
        deletions: 1,
      },
    ],
    externalReview: input.externalReview,
    commits: input.commits ?? [],
    attempts: input.attempts ?? [],
    fixReviewRuns: input.fixReviewRuns ?? [],
    expectedHeadSha: input.expectedHeadSha ?? 'abc123',
  });
}

test('eligible review-blocked automation PR dispatches auto-cover repair', () => {
  const result = run();

  assert.equal(result.should_run, true);
  assert.equal(result.manual_only, false);
});

test('manual-only and needs-review do not block repair', () => {
  const result = run({
    pr: {
      headRefName: 'claude-audit-fix-1',
      labels: ['needs-review', 'security-review-concerns'],
      files: ['.github/workflows/ci.yml'],
    },
    files: [
      {
        filename: '.github/workflows/ci.yml',
        additions: 1,
        deletions: 1,
      },
    ],
  });

  assert.equal(result.should_run, true);
  assert.equal(result.manual_only, true);
});

test('Kilo-only external blocker dispatches repair', () => {
  const result = run({
    pr: { labels: ['needs-review'] },
    externalReview: { state: 'blocked' },
  });

  assert.equal(result.should_run, true);
});

test('skips when no review blocker is present', () => {
  const result = run({ pr: { labels: ['needs-review'] } });

  assert.equal(result.should_run, false);
  assert.match(result.reason, /No review blocker/);
});

test('skips do-not-merge and dependency blockers', () => {
  assert.equal(
    run({ pr: { labels: ['do-not-merge', 'ai-review-concerns'] } }).should_run,
    false,
  );
  assert.equal(
    run({ pr: { labels: ['deps-review-blocked', 'ai-review-concerns'] } })
      .should_run,
    false,
  );
});

test('skips stale head, draft, closed, and cross-repo PRs', () => {
  assert.equal(run({ expectedHeadSha: 'old-head' }).should_run, false);
  assert.equal(run({ pr: { isDraft: true } }).should_run, false);
  assert.equal(run({ pr: { state: 'CLOSED' } }).should_run, false);
  assert.equal(run({ pr: { isCrossRepository: true } }).should_run, false);
});

test('skips when attempt cap is reached', () => {
  const result = run({
    commits: [
      { message: 'fix(review): address review feedback via /fix-review' },
      { message: 'fix(review): address review feedback via /fix-review' },
      { message: 'fix(review): address review feedback via /fix-review' },
    ],
    attempts: [{ id: 1 }],
  });

  assert.equal(result.should_run, false);
  assert.match(result.reason, /cap reached/);
});

test('counts repair commits and marker comments as the same attempt stream', () => {
  const result = run({
    commits: [
      { message: 'fix(review): address review feedback via /fix-review' },
      { message: 'fix(review): address review feedback via /fix-review' },
    ],
    attempts: [{ id: 1 }, { id: 2 }],
  });

  assert.equal(result.should_run, true);
  assert.equal(result.attempt_count, 2);
});

test('detects active current fix-review runs', () => {
  assert.equal(
    hasActiveFixReviewRun(
      [
        {
          displayTitle: 'Fix Review PR #507 @ abc123',
          status: 'in_progress',
        },
      ],
      507,
      'abc123',
    ),
    true,
  );
  assert.equal(
    run({
      fixReviewRuns: [
        {
          displayTitle: 'Fix Review PR #507 @ abc123',
          status: 'queued',
        },
      ],
    }).should_run,
    false,
  );
});

test('hasFixReviewNoOp detects no-changes fix-review comment', () => {
  const noOpBody = (headSha) =>
    `<!-- fix-review-summary -->\n## FIX-REVIEW Report: ℹ️ No changes needed\n\n- Head SHA: \`${headSha}\``;
  assert.equal(hasFixReviewNoOp([{ body: noOpBody('abc123') }]), true);
  assert.equal(hasFixReviewNoOp([{ body: noOpBody('abc123') }], 'abc123'), true);
  // Stale no-op from a prior commit must not match the current head.
  assert.equal(hasFixReviewNoOp([{ body: noOpBody('oldheadsha12') }], 'abc123'), false);
  assert.equal(
    hasFixReviewNoOp([
      {
        body: '<!-- fix-review-summary -->\n## FIX-REVIEW Report: ✅ Review fixes applied',
      },
    ]),
    false,
  );
  assert.equal(hasFixReviewNoOp([]), false);
  assert.equal(hasFixReviewNoOp([{ body: 'unrelated comment' }]), false);
});

test('skips dispatch when latest fix-review confirmed false positives', () => {
  const comments = [
    {
      body: '<!-- fix-review-summary -->\n## FIX-REVIEW Report: ℹ️ No changes needed\n\n- Head SHA: `abc123`',
    },
  ];
  const result = evaluateAutoCoverReview({
    pr: pr(),
    policy,
    comments,
    attempts: [],
    fixReviewRuns: [],
  });

  assert.equal(result.should_run, false);
  assert.match(result.reason, /false positive/);
});

test('stale no-op comment does not suppress dispatch for a newer commit', () => {
  const comments = [
    {
      body: '<!-- fix-review-summary -->\n## FIX-REVIEW Report: ℹ️ No changes needed\n\n- Head SHA: `oldheadsha1`',
    },
  ];
  const result = evaluateAutoCoverReview({
    pr: pr(),
    policy,
    comments,
    attempts: [],
    fixReviewRuns: [],
  });

  assert.equal(result.should_run, true);
});

test('skips dispatch when latest fix-review was skipped (ineligible)', () => {
  const skippedBody =
    '<!-- fix-review-summary -->\n## FIX-REVIEW Report: ⏭️ Review fix skipped\n\n- Head SHA: `abc123`\n\n> PR class "automation-fix" requires automation review loop.';
  const result = evaluateAutoCoverReview({
    pr: pr(),
    policy,
    comments: [{ body: skippedBody }],
    attempts: [],
    fixReviewRuns: [],
  });

  assert.equal(result.should_run, false);
  assert.match(result.reason, /skipped/);
});

test('stale skipped comment does not suppress dispatch for a newer commit', () => {
  const skippedBody =
    '<!-- fix-review-summary -->\n## FIX-REVIEW Report: ⏭️ Review fix skipped\n\n- Head SHA: `oldheadsha1`';
  const result = evaluateAutoCoverReview({
    pr: pr(),
    policy,
    comments: [{ body: skippedBody }],
    attempts: [],
    fixReviewRuns: [],
  });

  assert.equal(result.should_run, true);
});
