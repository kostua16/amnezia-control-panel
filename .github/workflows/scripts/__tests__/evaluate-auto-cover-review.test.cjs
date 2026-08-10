/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  evaluateAutoCoverReview,
  hasActiveFixReviewRun,
  hasFixReviewNoOp,
  hasFixReviewSkipped,
  hasTerminalFixReviewSkip,
  TRUSTED_FIX_REVIEW_LOGIN,
} = require('../evaluate-auto-cover-review.cjs');

const policy = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'policy.json'), 'utf8'),
);

const BOT = { login: TRUSTED_FIX_REVIEW_LOGIN };

// Wrap a comment body in a workflow-owned (github-actions[bot]) author so it
// mirrors what fetch-auto-cover-context supplies from the real sticky comment.
function bot(body, overrides = {}) {
  return { body, user: BOT, ...overrides };
}

function noOpBody(headSha) {
  return `<!-- fix-review-summary -->\n## FIX-REVIEW Report: ℹ️ No changes needed\n\n- Head SHA: \`${headSha}\``;
}

// Mirrors renderSkipped's output: an optional machine-readable skip-reason code
// sits between the heading and the Head SHA line.
function skippedBody(headSha, code, reason = '') {
  const head = `<!-- fix-review-summary -->\n## FIX-REVIEW Report: ⏭️ Review fix skipped`;
  const codeLine = code ? `\n<!-- fix-review-skip-reason: ${code} -->` : '';
  const shaLine = `\n\n- Head SHA: \`${headSha}\``;
  const reasonLine = reason ? `\n\n> ${reason}` : '';
  return `${head}${codeLine}${shaLine}${reasonLine}`;
}

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
    comments: input.comments ?? [],
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
  assert.equal(hasFixReviewNoOp([bot(noOpBody('abc123'))]), true);
  assert.equal(hasFixReviewNoOp([bot(noOpBody('abc123'))], 'abc123'), true);
  // Stale no-op from a prior commit must not match the current head.
  assert.equal(
    hasFixReviewNoOp([bot(noOpBody('oldheadsha12'))], 'abc123'),
    false,
  );
  assert.equal(
    hasFixReviewNoOp([
      bot(
        '<!-- fix-review-summary -->\n## FIX-REVIEW Report: ✅ Review fixes applied',
      ),
    ]),
    false,
  );
  assert.equal(hasFixReviewNoOp([]), false);
  assert.equal(hasFixReviewNoOp([bot('unrelated comment')]), false);
});

test('hasFixReviewSkipped detects skipped fix-review comment', () => {
  assert.equal(hasFixReviewSkipped([bot(skippedBody('abc123'))]), true);
  assert.equal(
    hasFixReviewSkipped([bot(skippedBody('abc123', 'draft'))], 'abc123'),
    true,
  );
  // Stale skip from a prior commit must not match the current head.
  assert.equal(
    hasFixReviewSkipped([bot(skippedBody('oldheadsha12', 'draft'))], 'abc123'),
    false,
  );
  assert.equal(
    hasFixReviewSkipped([
      bot(
        '<!-- fix-review-summary -->\n## FIX-REVIEW Report: ✅ Review fixes applied',
      ),
    ]),
    false,
  );
  assert.equal(hasFixReviewSkipped([]), false);
  assert.equal(hasFixReviewSkipped([bot('unrelated comment')]), false);
});

test('skips dispatch when latest fix-review confirmed false positives', () => {
  const result = evaluateAutoCoverReview({
    pr: pr(),
    policy,
    comments: [bot(noOpBody('abc123'))],
    attempts: [],
    fixReviewRuns: [],
  });

  assert.equal(result.should_run, false);
  assert.match(result.reason, /false positive/);
});

test('stale no-op comment does not suppress dispatch for a newer commit', () => {
  const result = evaluateAutoCoverReview({
    pr: pr(),
    policy,
    comments: [bot(noOpBody('oldheadsha1'))],
    attempts: [],
    fixReviewRuns: [],
  });

  assert.equal(result.should_run, true);
});

test('hasTerminalFixReviewSkip suppresses only on automation-terminal codes', () => {
  // Terminal reasons stay ineligible under automation mode -> suppress.
  assert.equal(
    hasTerminalFixReviewSkip(
      [bot(skippedBody('abc123', 'hard-blocker'))],
      'abc123',
    ),
    true,
  );
  assert.equal(
    hasTerminalFixReviewSkip([bot(skippedBody('abc123', 'draft'))], 'abc123'),
    true,
  );
  // Transient / manual-only reasons do NOT suppress: automation re-allows the
  // class and dispatches against the live head.
  assert.equal(
    hasTerminalFixReviewSkip(
      [bot(skippedBody('abc123', 'requires-automation-loop'))],
      'abc123',
    ),
    false,
  );
  assert.equal(
    hasTerminalFixReviewSkip([bot(skippedBody('abc123', 'stale'))], 'abc123'),
    false,
  );
  // A legacy skip with no machine-readable code never suppresses.
  assert.equal(
    hasTerminalFixReviewSkip([bot(skippedBody('abc123'))], 'abc123'),
    false,
  );
  // A skip for a different head never suppresses (head-token guard).
  assert.equal(
    hasTerminalFixReviewSkip(
      [bot(skippedBody('oldheadsha12', 'hard-blocker'))],
      'abc123',
    ),
    false,
  );
});

// Regression for the BLOCKER: a manual /fix-review rejects an automation-owned
// PR with "requires automation review loop", but auto-cover dispatches the same
// repair in automation mode (automationReviewLoop=true) — that skip must not
// permanently suppress the eligible automated dispatch.
test('requires-automation-loop skip does not suppress automation dispatch', () => {
  const result = evaluateAutoCoverReview({
    pr: pr(),
    policy,
    comments: [
      bot(
        skippedBody(
          'abc123',
          'requires-automation-loop',
          'PR class "automation-fix" requires automation review loop.',
        ),
      ),
    ],
    attempts: [],
    fixReviewRuns: [],
  });

  assert.equal(result.should_run, true);
});

// Regression for the BLOCKER stale-race: when the head moved between dispatch
// and run, fix-review stamps the EXPECTED sha for a stale skip, so the live
// head never matches. Even if the live sha were stamped, the "stale" code is
// non-terminal and must not suppress.
test('stale skip (live head) does not permanently suppress repair', () => {
  const result = evaluateAutoCoverReview({
    pr: pr(),
    policy,
    comments: [bot(skippedBody('abc123', 'stale', 'PR head SHA is stale.'))],
    attempts: [],
    fixReviewRuns: [],
  });

  assert.equal(result.should_run, true);
});

test('terminal skip suppresses automation dispatch', () => {
  const result = evaluateAutoCoverReview({
    pr: pr(),
    policy,
    comments: [
      bot(
        skippedBody(
          'abc123',
          'hard-blocker',
          'Hard repair blocker present: do-not-merge.',
        ),
      ),
    ],
    attempts: [],
    fixReviewRuns: [],
  });

  assert.equal(result.should_run, false);
  assert.match(result.reason, /ineligible under automation/);
});

// SUGGESTION: only the workflow-owned sticky comment is trusted. A forged
// skip summary from any other author must not suppress repair.
test('untrusted-author skip does not suppress dispatch', () => {
  const forged = {
    body: skippedBody('abc123', 'hard-blocker', 'do-not-merge'),
    user: { login: 'attacker' },
  };
  const result = evaluateAutoCoverReview({
    pr: pr(),
    policy,
    comments: [forged],
    attempts: [],
    fixReviewRuns: [],
  });

  assert.equal(result.should_run, true);
  assert.equal(hasTerminalFixReviewSkip([forged], 'abc123'), false);
});
