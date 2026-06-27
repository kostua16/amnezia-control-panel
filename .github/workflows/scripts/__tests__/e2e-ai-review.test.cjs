/* eslint-disable @typescript-eslint/no-require-imports */
// E2E §3 (AI-review gate) + §6a (fix-issue gate) via evaluate-trigger-policy.
// evaluate-trigger-policy.cjs is CLI-only (no exports), so we spawn it the same
// way scripts/__tests__/evaluate-trigger-policy.test.cjs does. See
// docs/workflow-e2e-scenarios.md (R-cases, F-cases).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evaluateExternalReview } = require('../evaluate-external-review.cjs');
const {
  evaluateAutoCoverReview,
} = require('../evaluate-auto-cover-review.cjs');
const {
  evaluateFixReviewEligibility,
} = require('../evaluate-fix-review-eligibility.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const scriptPath = path.join(
  repoRoot,
  '.github/workflows/scripts/evaluate-trigger-policy.cjs',
);
const policyPath = path.join(repoRoot, '.github/workflows/policy.json');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

function runMode({ mode, eventName, event }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-review-'));
  const eventPath = path.join(tempDir, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify(event), 'utf8');
  const output = execFileSync(
    process.execPath,
    [
      scriptPath,
      '--mode',
      mode,
      '--policy-file',
      policyPath,
      '--event-path',
      eventPath,
      '--event-name',
      eventName,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return JSON.parse(output);
}

// ---------- §3 AI-review mention gate (parametrized over provider) ----------
test('R1 char: maintainer @mention → triggered + trusted', () => {
  const out = runMode({
    mode: 'claude',
    eventName: 'issue_comment',
    event: {
      comment: { body: '@claude please fix', author_association: 'OWNER' },
    },
  });
  assert.equal(out.triggered, true);
  assert.equal(out.trusted, true);
});

test('R1 char: maintainer /review → PR Flow control wake', () => {
  const out = runMode({
    mode: 'pr-flow-control',
    eventName: 'issue_comment',
    event: {
      issue: { number: 42, pull_request: { url: 'https://example/pr/42' } },
      comment: {
        body: '/review',
        author_association: 'OWNER',
        user: { login: 'kostua16', type: 'User' },
      },
    },
  });

  assert.equal(out.should_run, true);
  assert.equal(out.review_requested, true);
  assert.equal(out.approve_requested, false);
  assert.equal(out.pr_number, 42);
});

test('R4 char: bot /review → ignored by PR Flow control', () => {
  const out = runMode({
    mode: 'pr-flow-control',
    eventName: 'issue_comment',
    event: {
      issue: { number: 42, pull_request: { url: 'https://example/pr/42' } },
      comment: {
        body: '/review',
        author_association: 'OWNER',
        user: { login: 'github-actions[bot]', type: 'Bot' },
      },
    },
  });

  assert.equal(out.should_run, false);
  assert.equal(out.triggered, true);
  assert.equal(out.trusted, false);
});

test('R7b spec: manual /review control remains exact standalone command', () => {
  const out = runMode({
    mode: 'pr-flow-control',
    eventName: 'issue_comment',
    event: {
      issue: { number: 42, pull_request: { url: 'https://example/pr/42' } },
      comment: {
        body: 'please /review this',
        author_association: 'OWNER',
        user: { login: 'kostua16', type: 'User' },
      },
    },
  });

  assert.equal(out.should_run, false);
  assert.equal(out.triggered, false);
});

test('R3 char: non-maintainer @mention → triggered but NOT trusted', () => {
  const out = runMode({
    mode: 'claude',
    eventName: 'issue_comment',
    event: {
      comment: { body: '@claude please fix', author_association: 'NONE' },
    },
  });
  assert.equal(out.triggered, true);
  assert.equal(out.trusted, false);
});

test('R7 char: workflow_dispatch review → should_run + trusted', () => {
  const out = runMode({
    mode: 'antigravity-review',
    eventName: 'workflow_dispatch',
    event: { inputs: { pr_number: '42' } },
  });
  assert.equal(out.should_run, true);
  assert.equal(out.trusted, true);
  assert.equal(out.trigger_source, 'workflow_dispatch');
});

// ---------- §3 Kilo external review signal ----------
const kiloUser = { login: 'kilo-code-bot[bot]', type: 'Bot' };
const kiloHead = 'abc123';
const kiloPr = { headRefOid: kiloHead };

test('R13 char: current-head Kilo No Issues Found → passed', () => {
  const out = evaluateExternalReview({
    pr: kiloPr,
    reviews: [
      {
        user: kiloUser,
        commit_id: kiloHead,
        submitted_at: '2026-06-24T12:00:00Z',
      },
    ],
    comments: [
      {
        user: kiloUser,
        body: '<!-- kilo-review -->\nStatus: No Issues Found',
        created_at: '2026-06-24T12:01:00Z',
      },
    ],
  });
  assert.equal(out.state, 'passed');
});

test('R14 char: current-head Kilo issues → blocked', () => {
  const out = evaluateExternalReview({
    pr: kiloPr,
    reviewComments: [{ user: kiloUser, commit_id: kiloHead, body: 'fix this' }],
  });
  assert.equal(out.state, 'blocked');
});

test('R15 char: old-head Kilo issues are ignored', () => {
  const out = evaluateExternalReview({
    pr: kiloPr,
    reviewComments: [{ user: kiloUser, commit_id: 'old', body: 'old issue' }],
    statuses: [
      {
        context: 'pr-flow/kilo-review',
        state: 'pending',
        created_at: '2026-06-24T11:45:00Z',
      },
    ],
    now: '2026-06-24T12:00:00Z',
  });
  assert.equal(out.state, 'pending');
});

test('R16 char: canceled Kilo check → skipped', () => {
  const out = evaluateExternalReview({
    pr: kiloPr,
    checkRuns: [{ name: 'Kilo Review', conclusion: 'cancelled' }],
  });
  assert.equal(out.state, 'skipped');
});

test('R17/R18 char: Kilo no-reply timeout pending then skipped', () => {
  const fresh = evaluateExternalReview({
    pr: kiloPr,
    statuses: [
      {
        context: 'pr-flow/kilo-review',
        state: 'pending',
        created_at: '2026-06-24T11:45:00Z',
      },
    ],
    now: '2026-06-24T12:00:00Z',
  });
  const expired = evaluateExternalReview({
    pr: kiloPr,
    statuses: [
      {
        context: 'pr-flow/kilo-review',
        state: 'pending',
        created_at: '2026-06-24T11:29:00Z',
      },
    ],
    now: '2026-06-24T12:00:00Z',
  });
  assert.equal(fresh.state, 'pending');
  assert.equal(expired.state, 'skipped');
});

// ---------- §6d auto-cover repair ----------
function autoCoverPr(overrides = {}) {
  return {
    number: 507,
    title: 'ci(workflows): repair review blockers',
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    headRefOid: 'abc123',
    headRefName: 'claude-workflow-optimize-review-loop',
    baseRefName: 'main',
    labels: ['ai-review-concerns'],
    files: ['.planning/example.md'],
    ...overrides,
  };
}

test('FR7/FR8 char: internal or Kilo blockers dispatch auto-cover repair', () => {
  const internal = evaluateAutoCoverReview({
    pr: autoCoverPr(),
    policy,
    expectedHeadSha: 'abc123',
  });
  const kiloOnly = evaluateAutoCoverReview({
    pr: autoCoverPr({ labels: ['needs-review'] }),
    policy,
    externalReview: { state: 'blocked' },
    expectedHeadSha: 'abc123',
  });

  assert.equal(internal.should_run, true);
  assert.equal(kiloOnly.should_run, true);
});

test('FR9 char: manual-only review blockers are repairable', () => {
  const out = evaluateAutoCoverReview({
    pr: autoCoverPr({
      headRefName: 'claude-audit-fix-1',
      labels: ['needs-review', 'security-review-concerns'],
      files: ['.github/workflows/ci.yml'],
    }),
    policy,
    expectedHeadSha: 'abc123',
  });

  assert.equal(out.should_run, true);
  assert.equal(out.manual_only, true);
});

test('FR12 char: maintainer /fix-review repairs Kilo-only GSD blockers without making merge automatic', () => {
  const pr = autoCoverPr({
    number: 520,
    headRefName: 'claude-gsd-planning-execute-28215679711',
    labels: [
      'auto-fix',
      'needs-review',
      'security-review-passed',
      'ai-review-passed',
      'skip-improve',
      'flow/review-blocked',
      'gsd-plan-execution',
    ],
    files: ['.github/workflows/scripts/__tests__/orchestrate-pr-flow.test.cjs'],
  });
  const files = [
    {
      filename:
        '.github/workflows/scripts/__tests__/orchestrate-pr-flow.test.cjs',
      additions: 11,
      deletions: 1,
    },
  ];
  const manualRepair = evaluateFixReviewEligibility({
    pr,
    policy,
    files,
    expectedHeadSha: 'abc123',
  });
  const automatedRepair = evaluateAutoCoverReview({
    pr,
    policy,
    files,
    externalReview: { state: 'blocked' },
    expectedHeadSha: 'abc123',
  });

  assert.equal(manualRepair.eligible, true);
  assert.equal(manualRepair.manual_only, true);
  assert.deepEqual(manualRepair.merge_blocking_labels, ['needs-review']);
  assert.equal(automatedRepair.should_run, true);
  assert.equal(automatedRepair.manual_only, true);
});

test('FR10/FR11 char: cap reached or active repair no-ops', () => {
  const capped = evaluateAutoCoverReview({
    pr: autoCoverPr(),
    policy,
    expectedHeadSha: 'abc123',
    attempts: [{ id: 1 }, { id: 2 }, { id: 3 }],
  });
  const active = evaluateAutoCoverReview({
    pr: autoCoverPr(),
    policy,
    expectedHeadSha: 'abc123',
    fixReviewRuns: [
      { displayTitle: 'Fix Review PR #507 @ abc123', status: 'queued' },
    ],
  });

  assert.equal(capped.should_run, false);
  assert.equal(active.should_run, false);
});

// ---------- §6a fix-issue gate ----------
test('F1 char: maintainer /fix on an open issue → should_run (comment)', () => {
  const out = runMode({
    mode: 'fix-issue',
    eventName: 'issue_comment',
    event: {
      issue: { number: 5, state: 'open' },
      comment: { body: '/fix the bug', author_association: 'OWNER' },
    },
  });
  assert.equal(out.should_run, true);
  assert.equal(out.trigger_source, 'comment');
});

test('F2 char: non-maintainer /fix → should_run false', () => {
  const out = runMode({
    mode: 'fix-issue',
    eventName: 'issue_comment',
    event: {
      issue: { number: 5, state: 'open' },
      comment: { body: '/fix the bug', author_association: 'NONE' },
    },
  });
  assert.equal(out.should_run, false);
});

test('F6 char: /fix on a PR-linked issue → should_run false (open-issue guard)', () => {
  const out = runMode({
    mode: 'fix-issue',
    eventName: 'issue_comment',
    event: {
      // issue.pull_request present ⇒ not an open standalone issue
      issue: { number: 5, state: 'open', pull_request: { url: 'x' } },
      comment: { body: '/fix the bug', author_association: 'OWNER' },
    },
  });
  assert.equal(out.should_run, false);
});
