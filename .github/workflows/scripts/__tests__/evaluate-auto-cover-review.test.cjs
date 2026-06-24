/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  evaluateAutoCoverReview,
  hasActiveFixReviewRun,
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
