/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildFlowGuidance,
  buildFlowVisibility,
  evaluatePolicy,
  getWorkerDispatchRef,
  makeDecision: makePrFlowDecision,
  renderFlowComment,
  resolvePrNumber,
  summarizeWorkerRuns,
} = require('../orchestrate-pr-flow.cjs');

const policyPath = path.join(__dirname, '..', '..', 'policy.json');

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
    kiloReview: {
      displayState: 'N/A',
      description: 'Kilo review was skipped.',
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
    kiloReview: {
      required: false,
      external: true,
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
    policy: {
      blocking_labels_present: [],
      maintainerAssociations: ['OWNER', 'MEMBER', 'COLLABORATOR'],
    },
    workerRuns: { codeReview: [] },
    eventName: 'issue_comment',
    event: {
      issue: { pull_request: { url: 'https://example/pr/42' } },
      comment: {
        body: '/review',
        author_association: 'OWNER',
        user: { login: 'kostua16', type: 'User' },
      },
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
    policy: {
      blocking_labels_present: [],
      maintainerAssociations: ['OWNER', 'MEMBER', 'COLLABORATOR'],
    },
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
      comment: {
        body: '/review',
        author_association: 'OWNER',
        user: { login: 'kostua16', type: 'User' },
      },
    },
    config: testConfig,
    checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
  });

  assert.equal(decision.state, 'flow/review-pending');
  assert.equal(decision.reason, 'Manual code review requested.');
  assert.equal(decision.dispatch?.key, 'codeReview');
});

test('manual /review is ignored inside PR Flow for bots and non-maintainers', () => {
  for (const comment of [
    {
      body: '/review',
      author_association: 'OWNER',
      user: { login: 'github-actions[bot]', type: 'Bot' },
    },
    {
      body: '/review',
      author_association: 'NONE',
      user: { login: 'external-user', type: 'User' },
    },
  ]) {
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
        comment,
      },
      config: testConfig,
      checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
    });

    assert.notEqual(decision.reason, 'Manual code review requested.');
    assert.notEqual(decision.dispatch?.key, 'codeReview');
  }
});

test('manual /review maintainer check uses policy maintainer associations', () => {
  const decision = makePrFlowDecision({
    pr: {
      ...basePr,
      labels: ['ai-review-passed', 'security-review-passed'],
      files: ['src/example.ts'],
    },
    policy: {
      blocking_labels_present: [],
      maintainerAssociations: ['CONTRIBUTOR'],
    },
    workerRuns: { codeReview: [] },
    eventName: 'issue_comment',
    event: {
      issue: { pull_request: { url: 'https://example/pr/42' } },
      comment: {
        body: '/review',
        author_association: 'CONTRIBUTOR',
        user: { login: 'trusted-contributor', type: 'User' },
      },
    },
    config: testConfig,
    checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
  });

  assert.equal(decision.state, 'flow/review-pending');
  assert.equal(decision.reason, 'Manual code review requested.');
  assert.equal(decision.dispatch?.key, 'codeReview');
});

test('manual /review dispatch works with policy from the production evaluator', () => {
  const pr = {
    ...basePr,
    number: 42,
    title: 'fix: review routing',
    url: 'https://example/pr/42',
    headRefName: 'codex/example',
    baseRefName: 'main',
    authorLogin: 'kostua16',
    labels: ['ai-review-passed', 'security-review-passed'],
    files: ['src/example.ts'],
    isCrossRepository: false,
  };
  const policy = evaluatePolicy(pr, policyPath);

  const decision = makePrFlowDecision({
    pr,
    policy,
    workerRuns: { codeReview: [] },
    eventName: 'issue_comment',
    event: {
      issue: { pull_request: { url: 'https://example/pr/42' } },
      comment: {
        body: '/review',
        author_association: 'OWNER',
        user: { login: 'kostua16', type: 'User' },
      },
    },
    config: testConfig,
    checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
  });

  assert.deepEqual(policy.maintainerAssociations, [
    'OWNER',
    'MEMBER',
    'COLLABORATOR',
  ]);
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

test('buildFlowVisibility returns draft PR with all pending statuses', () => {
  const visibility = buildFlowVisibility({
    pr: { ...basePr, isDraft: true, state: 'OPEN', mergedAt: '' },
    config: testConfig,
    decision: {
      state: 'flow/draft',
      reason: 'PR is draft.',
      checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
    },
    workerRuns: {},
    currentRunUrl: 'https://github.com/test/repo/actions/runs/123',
  });

  assert.equal(visibility.aggregate.state, 'pending');
  assert.equal(visibility.aggregate.displayState, 'pending');
  assert.equal(visibility.aggregate.context, 'pr-flow/ready');
  assert.equal(visibility.workers.codeReview.displayState, 'pending');
  assert.equal(visibility.workers.securityReview.displayState, 'pending');
  assert.equal(visibility.workers.finalizer.displayState, 'pending');
});

test('buildFlowVisibility returns failure aggregate when checks failed', () => {
  const visibility = buildFlowVisibility({
    pr: { ...basePr, isDraft: false, state: 'OPEN', mergedAt: '' },
    config: testConfig,
    decision: {
      state: 'flow/checks-failed',
      reason: 'Required checks are failing.',
      checkStatus: {
        status: 'failed',
        failing: ['Lint'],
        pending: [],
        missing: [],
      },
    },
    workerRuns: {},
    currentRunUrl: 'https://github.com/test/repo/actions/runs/123',
  });

  assert.equal(visibility.aggregate.state, 'failure');
  assert.equal(visibility.aggregate.displayState, 'failure');
  assert.equal(visibility.workers.codeReview.displayState, 'pending');
  assert.equal(visibility.workers.securityReview.displayState, 'pending');
});

test('buildFlowVisibility returns success workers when review passed', () => {
  const visibility = buildFlowVisibility({
    pr: {
      ...basePr,
      isDraft: false,
      state: 'OPEN',
      mergedAt: '',
      labels: ['ai-review-passed', 'security-review-passed'],
    },
    config: testConfig,
    decision: {
      state: 'flow/finalizer-dispatched',
      reason: 'Finalizer already dispatched for this head SHA.',
      checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
    },
    workerRuns: {
      codeReview: [
        {
          displayTitle: 'PR #42 @ abc123',
          status: 'completed',
          conclusion: 'success',
          url: 'https://github.com/test/repo/actions/runs/456',
        },
      ],
    },
    currentRunUrl: 'https://github.com/test/repo/actions/runs/123',
  });

  assert.equal(visibility.workers.codeReview.state, 'success');
  assert.equal(visibility.workers.codeReview.displayState, 'success');
  assert.equal(visibility.workers.securityReview.state, 'success');
  assert.equal(visibility.workers.securityReview.displayState, 'success');
});

test('buildFlowVisibility returns error aggregate when dispatch fails', () => {
  const visibility = buildFlowVisibility({
    pr: { ...basePr, isDraft: false, state: 'OPEN', mergedAt: '' },
    config: testConfig,
    decision: {
      state: 'flow/review-pending',
      reason: 'Manual code review requested.',
      dispatch: { key: 'codeReview', workflow: 'code-review.yml' },
      checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
    },
    dispatchOutcome: { ok: false, error: 'Workflow not found' },
    workerRuns: {},
    currentRunUrl: 'https://github.com/test/repo/actions/runs/123',
  });

  assert.equal(visibility.aggregate.state, 'error');
  assert.equal(visibility.aggregate.displayState, 'error');
  assert.match(visibility.aggregate.description, /Worker dispatch failed/);
  assert.equal(visibility.workers.codeReview.state, 'error');
  assert.equal(visibility.workers.codeReview.displayState, 'error');
});

test('buildFlowVisibility returns success+N/A for closed/merged PR', () => {
  const visibility = buildFlowVisibility({
    pr: {
      ...basePr,
      isDraft: false,
      state: 'CLOSED',
      mergedAt: '2026-06-26T12:00:00Z',
    },
    config: testConfig,
    decision: {
      state: null,
      reason: 'PR is closed or already merged.',
      checkStatus: {
        status: 'not_requested',
        failing: [],
        pending: [],
        missing: [],
      },
    },
    workerRuns: {},
    currentRunUrl: 'https://github.com/test/repo/actions/runs/123',
  });

  assert.equal(visibility.aggregate.state, 'success');
  assert.equal(visibility.aggregate.displayState, 'success');
  assert.match(visibility.aggregate.description, /closed or already merged/);
  assert.equal(visibility.workers.codeReview.displayState, 'N/A');
  assert.equal(visibility.workers.securityReview.displayState, 'N/A');
  assert.equal(visibility.workers.finalizer.displayState, 'N/A');
});

test('buildFlowVisibility returns success aggregate for manual-only decision', () => {
  const visibility = buildFlowVisibility({
    pr: {
      ...basePr,
      isDraft: false,
      state: 'OPEN',
      mergedAt: '',
      labels: ['needs-review'],
    },
    config: testConfig,
    policy: {
      manual_only: true,
      blocking_labels_present: [],
      maintainerAssociations: [],
    },
    decision: {
      state: 'flow/manual-only',
      reason: 'Manual review is required by label: needs-review.',
      checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
    },
    workerRuns: {},
    currentRunUrl: 'https://github.com/test/repo/actions/runs/123',
  });

  assert.equal(visibility.aggregate.state, 'success');
  assert.equal(visibility.aggregate.displayState, 'success');
  assert.match(visibility.aggregate.description, /Manual review is required/);
  assert.equal(visibility.workers.codeReview.displayState, 'pending');
  assert.equal(visibility.workers.finalizer.displayState, 'N/A');
});

test('buildFlowVisibility orderedStatuses includes aggregate and all workers', () => {
  const visibility = buildFlowVisibility({
    pr: { ...basePr, isDraft: true, state: 'OPEN', mergedAt: '' },
    config: testConfig,
    decision: {
      state: 'flow/draft',
      reason: 'PR is draft.',
      checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
    },
    workerRuns: {},
    currentRunUrl: 'https://github.com/test/repo/actions/runs/123',
  });

  assert.equal(visibility.orderedStatuses.length, 7);
  assert.equal(visibility.orderedStatuses[0].context, 'pr-flow/ready');
  assert.equal(visibility.orderedStatuses[1].context, 'pr-flow/code-review');
  assert.equal(
    visibility.orderedStatuses[2].context,
    'pr-flow/security-review',
  );
  assert.equal(
    visibility.orderedStatuses[3].context,
    'pr-flow/dependency-review',
  );
  assert.equal(visibility.orderedStatuses[4].context, 'pr-flow/kilo-review');
  assert.equal(visibility.orderedStatuses[5].context, 'pr-flow/pr-improve');
  assert.equal(visibility.orderedStatuses[6].context, 'pr-flow/finalizer');
});

// ── resolvePrNumber ──────────────────────────────────────────────────

test('resolvePrNumber returns explicit pr_number when provided', () => {
  assert.equal(resolvePrNumber('push', {}, '99'), 99);
  assert.equal(resolvePrNumber('workflow_run', {}, '7'), 7);
});

test('resolvePrNumber extracts from issue_comment with pull_request', () => {
  const event = {
    issue: { pull_request: { url: 'https://example/pr/55' }, number: 55 },
  };
  assert.equal(resolvePrNumber('issue_comment', event), 55);
});

test('resolvePrNumber extracts from pull_request_target event', () => {
  const event = { pull_request: { number: 12 } };
  assert.equal(resolvePrNumber('pull_request_target', event), 12);
});

test('resolvePrNumber extracts from pull_request event', () => {
  const event = { pull_request: { number: 88 } };
  assert.equal(resolvePrNumber('pull_request', event), 88);
});

test('resolvePrNumber extracts from workflow_run pull_requests payload', () => {
  const event = {
    workflow_run: {
      pull_requests: [{ number: 33 }],
      display_title: 'some title',
    },
  };
  assert.equal(resolvePrNumber('workflow_run', event), 33);
});

test('resolvePrNumber extracts from workflow_run display_title when pull_requests is empty', () => {
  const event = {
    workflow_run: {
      pull_requests: [],
      display_title: 'PR #77 @ abc123',
    },
  };
  assert.equal(resolvePrNumber('workflow_run', event), 77);
});

test('resolvePrNumber extracts from workflow_run name when display_title is null', () => {
  // The ?? operator only skips null/undefined, not empty string.
  const event = {
    workflow_run: {
      pull_requests: [],
      display_title: null,
      name: 'PR #44 @ def456',
    },
  };
  assert.equal(resolvePrNumber('workflow_run', event), 44);
});

test('resolvePrNumber does not fall back to name when display_title is an empty string', () => {
  // ?? keeps the empty string, so name is never reached and no number parses.
  const event = {
    workflow_run: {
      pull_requests: [],
      display_title: '',
      name: 'PR #44 @ def456',
    },
  };
  assert.equal(resolvePrNumber('workflow_run', event), null);
});

test('resolvePrNumber falls back to inputs.pr_number for non-workflow_run events', () => {
  // inputs.pr_number is only reachable outside the workflow_run branch.
  const event = {
    inputs: { pr_number: '22' },
  };
  assert.equal(resolvePrNumber('schedule', event), 22);
});

test('resolvePrNumber returns null when no source provides a number', () => {
  assert.equal(resolvePrNumber('push', {}), null);
  assert.equal(
    resolvePrNumber('workflow_run', {
      workflow_run: { pull_requests: [], display_title: 'no-pr-here' },
    }),
    null,
  );
});

test('resolvePrNumber returns null for non-numeric explicit value', () => {
  assert.equal(resolvePrNumber('push', {}, 'abc'), null);
});

// Manual-only PR code review path tests

test('makeDecision dispatches code review for manual-only PR without review labels (after CI passes)', () => {
  const decision = makePrFlowDecision({
    pr: {
      ...basePr,
      labels: ['needs-review'],
      files: ['src/example.ts'],
    },
    policy: {
      manual_only: true,
      blocking_labels_present: [],
      maintainerAssociations: ['OWNER', 'MEMBER'],
    },
    workerRuns: { codeReview: [] },
    eventName: 'workflow_dispatch',
    event: {},
    config: testConfig,
    checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
  });

  assert.equal(decision.state, 'flow/review-pending');
  assert.equal(decision.reason, 'Dispatching code review.');
  assert.equal(decision.dispatch?.key, 'codeReview');
  assert.equal(decision.dispatch?.workflow, 'code-review.yml');
});

test('makeDecision returns flow/manual-only when manual-only PR has review labels', () => {
  const decision = makePrFlowDecision({
    pr: {
      ...basePr,
      labels: ['needs-review', 'ai-review-passed', 'security-review-passed'],
      files: ['src/example.ts'],
    },
    policy: {
      manual_only: true,
      blocking_labels_present: [],
      maintainerAssociations: ['OWNER', 'MEMBER'],
    },
    workerRuns: { codeReview: [] },
    eventName: 'workflow_dispatch',
    event: {},
    config: testConfig,
    checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
  });

  assert.equal(decision.state, 'flow/manual-only');
  assert.equal(decision.reason, 'Manual-only PR: advisory reviews passed.');
  assert.equal(decision.dispatch, null);
});

test('buildFlowVisibility shows code review as success and finalizer as N/A for manual-only PR with review labels', () => {
  const visibility = buildFlowVisibility({
    pr: {
      ...basePr,
      isDraft: false,
      state: 'OPEN',
      mergedAt: '',
      labels: ['needs-review', 'ai-review-passed', 'security-review-passed'],
    },
    config: testConfig,
    policy: {
      manual_only: true,
      blocking_labels_present: [],
      maintainerAssociations: [],
    },
    decision: {
      state: 'flow/manual-only',
      reason: 'Manual-only PR: advisory reviews passed.',
      checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
    },
    workerRuns: {
      codeReview: [
        {
          displayTitle: 'PR #42 @ abc123',
          status: 'completed',
          conclusion: 'success',
          createdAt: '2026-06-23T12:00:00Z',
        },
      ],
    },
    currentRunUrl: 'https://github.com/test/repo/actions/runs/123',
  });

  assert.equal(visibility.aggregate.state, 'success');
  assert.equal(visibility.aggregate.displayState, 'success');
  assert.match(visibility.aggregate.description, /advisory reviews passed/);
  assert.equal(visibility.workers.codeReview.displayState, 'success');
  assert.equal(visibility.workers.finalizer.displayState, 'N/A');
  assert.match(visibility.workers.finalizer.description, /manual-only/);
});

test('buildFlowVisibility aggregate description mentions advisory reviews when manual-only has completed reviews', () => {
  const visibility = buildFlowVisibility({
    pr: {
      ...basePr,
      isDraft: false,
      state: 'OPEN',
      mergedAt: '',
      labels: ['needs-review', 'ai-review-passed', 'security-review-passed'],
    },
    config: testConfig,
    policy: {
      manual_only: true,
      blocking_labels_present: [],
      maintainerAssociations: [],
    },
    decision: {
      state: 'flow/manual-only',
      reason: 'Manual-only PR: advisory reviews passed.',
      checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
    },
    workerRuns: {
      codeReview: [
        {
          displayTitle: 'PR #42 @ abc123',
          status: 'completed',
          conclusion: 'success',
          createdAt: '2026-06-23T12:00:00Z',
        },
      ],
    },
    currentRunUrl: 'https://github.com/test/repo/actions/runs/123',
  });

  assert.equal(
    visibility.aggregate.description,
    'Manual-only PR: advisory reviews passed. Ready for human merge decision.',
  );
});
