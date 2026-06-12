/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFlowGuidance,
  getWorkerDispatchRef,
  renderFlowComment,
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
