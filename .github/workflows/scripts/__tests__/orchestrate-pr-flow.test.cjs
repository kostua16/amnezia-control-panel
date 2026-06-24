/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFlowGuidance,
  getWorkerDispatchRef,
  makeDecision: makePrFlowDecision,
  renderFlowComment,
  summarizeWorkerRuns,
} = require('../orchestrate-pr-flow.cjs');

const basePr = {
  number: 42,
  headSha: 'abc123',
  state: 'OPEN',
  mergedAt: '',
  labels: [],
};

const baseDecision = {
  state: 'flow/review-pending',
  reason: 'Waiting for review automation.',
  dispatch: null,
  checkStatus: {
    status: 'passed',
    failing: [],
    pending: [],
    missing: [],
  },
};

const baseVisibility = {
  aggregate: {
    displayState: 'pending',
    context: 'pr-flow/ready',
  },
  workers: {
    codeReview: {
      displayState: 'pending',
      description: 'Waiting for code review signal.',
      targetUrl: 'https://example.test/code-review',
    },
    securityReview: {
      displayState: 'pending',
      description: 'Waiting for security review signal.',
      targetUrl: 'https://example.test/code-review',
    },
    dependencyReview: {
      displayState: 'N/A',
      description: 'N/A: Dependency review is not required for this PR.',
      targetUrl: '',
    },
    prImprove: {
      displayState: 'N/A',
      description: 'N/A: PR Improve is not required for this PR.',
      targetUrl: '',
    },
    finalizer: {
      displayState: 'pending',
      description: 'Waiting for prior orchestration gates.',
      targetUrl: 'https://example.test/finalizer',
    },
  },
};

const testConfig = {
  labels: {
    'flow/review-pending': {},
    'flow/review-blocked': {},
    'flow/review-failed': {},
    'flow/finalizer-dispatched': {},
  },
  resetOnHeadChange: {
    labels: [
      'ai-review-passed',
      'ai-review-concerns',
      'security-review-passed',
      'security-review-concerns',
    ],
  },
  workers: {
    codeReview: {
      workflow: 'code-review.yml',
      passLabels: ['ai-review-passed', 'security-review-passed'],
      blockLabels: ['ai-review-concerns', 'security-review-concerns'],
    },
    finalizer: {
      workflow: 'pr-finalizer.yml',
    },
  },
};

function makeDecision(overrides = {}) {
  return {
    ...baseDecision,
    ...overrides,
    checkStatus: {
      ...baseDecision.checkStatus,
      ...(overrides.checkStatus ?? {}),
    },
  };
}

function makeComment({ pr = {}, decision = {}, visibility = {} } = {}) {
  return renderFlowComment({
    pr: { ...basePr, ...pr },
    decision: makeDecision(decision),
    visibility: {
      ...baseVisibility,
      ...visibility,
      aggregate: {
        ...baseVisibility.aggregate,
        ...(visibility.aggregate ?? {}),
      },
      workers: {
        ...baseVisibility.workers,
        ...(visibility.workers ?? {}),
      },
    },
  });
}

function assertNoEmptyGuidance(body) {
  assert.doesNotMatch(body, /undefined/);
  assert.doesNotMatch(body, /^- \s*$/m);
}

test('dispatches same-repo PR workers from the head branch', () => {
  assert.equal(
    getWorkerDispatchRef({
      baseRefName: 'main',
      headRefName: 'codex/fix-branch',
      isCrossRepository: false,
    }),
    'codex/fix-branch',
  );
});

test('falls back to the base branch when the head branch is unavailable', () => {
  assert.equal(
    getWorkerDispatchRef({
      baseRefName: 'main',
      headRefName: '',
      isCrossRepository: false,
    }),
    'main',
  );
});

test('keeps cross-repo PR workers on the base branch', () => {
  assert.equal(
    getWorkerDispatchRef({
      baseRefName: 'main',
      headRefName: 'contrib/fork-branch',
      isCrossRepository: true,
    }),
    'main',
  );
});

test('renderFlowComment keeps the sticky marker and worker table', () => {
  const body = makeComment();

  assert.match(body, /^<!-- pr-flow-orchestration -->/);
  assert.match(body, /## PR Flow Orchestration/);
  assert.match(body, /- Decision: flow\/review-pending/);
  assert.match(body, /- Dispatch: none/);
  assert.match(body, /### Next steps/);
  assert.match(body, /### Controls/);
  assert.match(body, /\| Worker \| Status \| Details \| Link \|/);
  assert.match(body, /\| Code review \| pending \|/);
  assertNoEmptyGuidance(body);
});

test('manual-only guidance shows approval and manual-control labels', () => {
  const body = makeComment({
    pr: { labels: ['needs-review'] },
    decision: {
      state: 'flow/manual-only',
      reason: 'Manual review is required by label: needs-review.',
    },
  });

  assert.match(body, /\/approve/);
  assert.match(body, /maintainer-approved/);
  assert.match(body, /needs-review/);
  assert.match(body, /do-not-merge/);
  assertNoEmptyGuidance(body);
});

test('review-blocked guidance points to concern labels and review rerun', () => {
  const body = makeComment({
    pr: { labels: ['ai-review-concerns'] },
    decision: {
      state: 'flow/review-blocked',
      reason: 'AI review is blocking.',
    },
  });

  assert.match(body, /ai-review-concerns/);
  assert.match(body, /concern\/block labels/);
  assert.match(body, /\/review/);
  assertNoEmptyGuidance(body);
});

test('improve-pending guidance explains skip-improve control', () => {
  const body = makeComment({
    decision: {
      state: 'flow/improve-pending',
      reason: 'PR Improve is already running.',
    },
  });

  assert.match(body, /PR Improve/);
  assert.match(body, /skip-improve/);
  assertNoEmptyGuidance(body);
});

test('checks-failed guidance names failing checks and rerun path', () => {
  const body = makeComment({
    decision: {
      state: 'flow/checks-failed',
      reason: 'Required checks are failing.',
      checkStatus: {
        status: 'failed',
        failing: ['Lint'],
      },
    },
  });

  assert.match(body, /Fix `Lint`/);
  assert.match(body, /rerun the failed jobs/);
  assertNoEmptyGuidance(body);
});

test('finalizer-dispatched guidance asks the user to wait for PR Finalizer', () => {
  const body = makeComment({
    decision: {
      state: 'flow/finalizer-dispatched',
      reason: 'Finalizer already dispatched for this head SHA.',
    },
  });

  assert.match(body, /Wait for PR Finalizer to finish/);
  assert.match(body, /do-not-merge/);
  assertNoEmptyGuidance(body);
});

test('buildFlowGuidance limits next steps to three actions', () => {
  const guidance = buildFlowGuidance({
    pr: basePr,
    decision: makeDecision({
      state: 'flow/manual-only',
      reason: 'Manual review is required by label: needs-review.',
    }),
    visibility: baseVisibility,
  });

  assert.ok(guidance.nextSteps.length <= 3);
});

test('manual /review dispatches Code Review through PR Flow and resets stale review labels', () => {
  const decision = makePrFlowDecision({
    pr: {
      ...basePr,
      labels: ['ai-review-passed', 'security-review-passed'],
      files: ['src/example.ts'],
    },
    policy: { blocking_labels_present: [] },
    workerRuns: { codeReview: [] },
    eventName: 'issue_comment',
    event: {
      issue: { pull_request: { url: 'https://example/pr/42' } },
      comment: { body: '/review' },
    },
    config: testConfig,
    checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
  });

  assert.equal(decision.state, 'flow/review-pending');
  assert.equal(decision.reason, 'Manual code review requested.');
  assert.equal(decision.dispatch?.key, 'codeReview');
  assert.equal(decision.dispatch?.workflow, 'code-review.yml');
  assert.deepEqual(decision.labelsToRemove.sort(), [
    'ai-review-passed',
    'security-review-passed',
  ]);
});

test('manual /review does not treat old-head failed review runs as current', () => {
  const decision = makePrFlowDecision({
    pr: { ...basePr, labels: [], files: ['src/example.ts'] },
    policy: { blocking_labels_present: [] },
    workerRuns: {
      codeReview: [
        {
          displayTitle: 'PR #42 @ old-head',
          status: 'completed',
          conclusion: 'failure',
          createdAt: '2026-06-23T12:00:00Z',
        },
      ],
    },
    eventName: 'issue_comment',
    event: {
      issue: { pull_request: { url: 'https://example/pr/42' } },
      comment: { body: '/review' },
    },
    config: testConfig,
    checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
  });

  assert.equal(decision.state, 'flow/review-pending');
  assert.equal(decision.reason, 'Manual code review requested.');
  assert.equal(decision.dispatch?.key, 'codeReview');
});

test('worker run matching requires both PR number and current head SHA', () => {
  const summary = summarizeWorkerRuns(
    {
      codeReview: [
        {
          displayTitle: 'PR #42 @ old-head',
          status: 'completed',
          conclusion: 'failure',
          createdAt: '2026-06-23T12:00:00Z',
        },
        {
          displayTitle: 'PR #42 @ abc123',
          status: 'in_progress',
          createdAt: '2026-06-23T12:01:00Z',
        },
      ],
    },
    'codeReview',
    basePr,
  );

  assert.equal(summary.active?.displayTitle, 'PR #42 @ abc123');
  assert.equal(summary.latest?.displayTitle, 'PR #42 @ abc123');
});
