/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildFlowGuidance,
  buildFlowVisibility,
  buildGraphqlArgs,
  collectLegacyWorkerRuns,
  evaluatePolicy,
  getWorkerDispatchRef,
  makeDecision: makePrFlowDecision,
  pathsMatch,
  publishFlowStatuses,
  publishVisibilityUpdates,
  renderFlowComment,
  resolvePrNumber,
  shouldPublishStatus,
  stabilizeRunLinks,
  summarizeWorkerRuns,
  upsertFlowComment,
  usableStatusId,
} = require('../orchestrate-pr-flow.cjs');
const { selectStalePrs } = require('../watch-pr-flow.cjs');

const policyPath = path.join(__dirname, '..', '..', 'policy.json');

test('pathsMatch supports exact paths and directory-prefix globs', () => {
  const paths = ['package.json', 'package-lock.json', '.github/workflows/**'];
  assert.equal(pathsMatch(['package.json'], paths), true);
  assert.equal(pathsMatch(['.github/workflows/ci.yml'], paths), true);
  assert.equal(pathsMatch(['.github/dependabot.yml'], paths), false);
  // Sibling files that share the directory name as a prefix (no trailing
  // slash) must NOT match the `/**` glob — the match is bound to the
  // directory separator, never a bare string prefix.
  assert.equal(pathsMatch(['.github/workflows.bak'], paths), false);
  assert.equal(pathsMatch(['src/app/page.tsx'], paths), false);
  assert.equal(pathsMatch([], paths), false);
});

test('buildGraphqlArgs keeps strings literal with -f and types numbers and booleans with -F', () => {
  // The review-inputs query declares typed variables (`: Int!`, `: Boolean!`);
  // a boolean or number routed through -f would be sent as the JSON string
  // "false"/"7" and rejected by GraphQL on every wake, silently degrading the
  // flow to permanent REST fallback.
  const args = buildGraphqlArgs('query X { rateLimit { cost } }', {
    owner: 'owner',
    name: 'repo',
    number: 7,
    commentsAfter: 'cursor-1',
    reviewsAfter: null,
    wantComments: true,
    wantReviews: false,
  });
  assert.deepEqual(args, [
    'api',
    'graphql',
    '-f',
    'query=query X { rateLimit { cost } }',
    '-f',
    'owner=owner',
    '-f',
    'name=repo',
    '-F',
    'number=7',
    '-f',
    'commentsAfter=cursor-1',
    '-F',
    'wantComments=true',
    '-F',
    'wantReviews=false',
  ]);
});

test('dependencyReview worker paths cover github_actions Dependabot bumps', () => {
  const config = JSON.parse(
    require('node:fs').readFileSync(
      path.join(__dirname, '..', '..', '..', 'pr-flow.json'),
      'utf8',
    ),
  );
  const workerPaths = config.workers.dependencyReview.paths;
  assert.equal(
    pathsMatch(['.github/workflows/ci.yml'], workerPaths),
    true,
    'workflow-only Dependabot diffs must dispatch dependency review',
  );
  assert.equal(
    pathsMatch(['.github/actions/run-zai/action.yml'], workerPaths),
    true,
  );
  assert.equal(pathsMatch(['package-lock.json'], workerPaths), true);
});

const basePr = {
  number: 42,
  headSha: 'abc123',
  state: 'OPEN',
  mergedAt: '',
  labels: [],
};

function completedWorkerRun(
  conclusion,
  createdAt = '2026-07-01T09:00:00.000Z',
) {
  return {
    databaseId: 900,
    status: 'completed',
    conclusion,
    displayTitle: 'PR #42 @ abc123',
    createdAt,
    url: 'https://example.test/run/900',
  };
}

test('R19/R20: failed code review retries up to the cap, then dispatches the advisory fallback reviewer', () => {
  const config = JSON.parse(
    require('node:fs').readFileSync(
      path.join(__dirname, '..', '..', '..', 'pr-flow.json'),
      'utf8',
    ),
  );
  const pr = {
    ...basePr,
    isDraft: false,
    isCrossRepository: false,
    baseRefName: 'main',
    headRefName: 'feature',
    files: ['src/app/page.tsx'],
  };
  const context = (workerRuns) => ({
    pr,
    config,
    eventName: 'workflow_dispatch',
    event: {},
    checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
    workerRuns,
    externalReview: { state: 'skipped', reason: 'not required' },
  });

  const retry = makePrFlowDecision(
    context({
      codeReview: [completedWorkerRun('failure')],
      antigravityCodeReview: [],
    }),
  );
  assert.equal(retry.state, 'flow/review-pending');
  assert.equal(retry.dispatch?.key, 'codeReview');
  assert.match(retry.reason, /retrying/i);

  const exhausted = [
    completedWorkerRun('failure', '2026-07-01T09:00:00.000Z'),
    completedWorkerRun('failure', '2026-07-01T08:00:00.000Z'),
    completedWorkerRun('failure', '2026-07-01T07:00:00.000Z'),
  ];
  const fallback = makePrFlowDecision(
    context({ codeReview: exhausted, antigravityCodeReview: [] }),
  );
  assert.equal(fallback.state, 'flow/review-failed');
  assert.equal(fallback.dispatch?.key, 'antigravityCodeReview');

  const settled = makePrFlowDecision(
    context({
      codeReview: exhausted,
      antigravityCodeReview: [completedWorkerRun('success')],
    }),
  );
  assert.equal(settled.state, 'flow/review-failed');
  assert.equal(settled.dispatch, null);
});

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
  assert.equal(visibility.workers.codeReview.displayState, 'N/A');
  assert.equal(visibility.workers.securityReview.displayState, 'N/A');
  assert.equal(visibility.workers.dependencyReview.displayState, 'N/A');
  assert.equal(visibility.workers.kiloReview.displayState, 'N/A');
  assert.equal(visibility.workers.prImprove.displayState, 'N/A');
  assert.equal(visibility.workers.finalizer.displayState, 'N/A');
});

test('terminal manual-only keeps recorded review outcomes visible', () => {
  // The terminal manual-only snapshot is the one a maintainer reads before
  // the manual merge decision — achieved review signals must render, not be
  // flattened to "N/A: PR is manual-only." (which is reserved for workers
  // with no recorded signal).
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
      reason: 'Manual review is required by label: needs-review.',
      checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
    },
    externalReview: {
      state: 'passed',
      reason: 'Kilo reported no current-head issues.',
    },
    workerRuns: {},
    currentRunUrl: 'https://github.com/test/repo/actions/runs/123',
  });

  assert.equal(visibility.workers.codeReview.displayState, 'success');
  assert.equal(visibility.workers.securityReview.displayState, 'success');
  assert.equal(visibility.workers.kiloReview.displayState, 'success');
  // No recorded signal: the not-required dependency review keeps its more
  // specific message, and prImprove/finalizer never run on manual-only PRs.
  assert.equal(visibility.workers.dependencyReview.displayState, 'N/A');
  assert.match(visibility.workers.dependencyReview.description, /not required/);
  assert.equal(visibility.workers.prImprove.displayState, 'N/A');
  assert.equal(visibility.workers.finalizer.displayState, 'N/A');
});

test('terminal manual-only keeps recorded review concerns visible as failure', () => {
  const visibility = buildFlowVisibility({
    pr: {
      ...basePr,
      isDraft: false,
      state: 'OPEN',
      mergedAt: '',
      labels: ['needs-review', 'ai-review-concerns'],
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

  assert.equal(visibility.workers.codeReview.displayState, 'failure');
  assert.match(visibility.workers.codeReview.description, /concerns/);
  // Security review has no recorded signal here — it stays N/A.
  assert.equal(visibility.workers.securityReview.displayState, 'N/A');
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

// ── commit status publishing ─────────────────────────────────────────

const RUN_URL = 'https://github.com/test/repo/actions/runs/200';
const OLD_RUN_URL = 'https://github.com/test/repo/actions/runs/100';
const WORKER_URL = 'https://github.com/test/repo/actions/runs/55';

function makeStatus(overrides = {}) {
  return {
    context: 'pr-flow/code-review',
    state: 'success',
    displayState: 'success',
    description: 'Code review passed.',
    targetUrl: WORKER_URL,
    details: '',
    ...overrides,
  };
}

function previousStatuses(entries) {
  return new Map(entries.map((entry) => [entry.context, entry]));
}

function previousSuccess(overrides = {}) {
  return {
    context: 'pr-flow/code-review',
    state: 'success',
    description: 'Code review passed.',
    target_url: WORKER_URL,
    ...overrides,
  };
}

test('shouldPublishStatus skips an identical success status', () => {
  const previous = previousStatuses([previousSuccess()]);
  assert.equal(shouldPublishStatus(previous, makeStatus(), RUN_URL), false);
});

test('shouldPublishStatus skips an identical success that links to the current run', () => {
  const previous = previousStatuses([
    previousSuccess({ target_url: OLD_RUN_URL }),
  ]);
  const status = makeStatus({ targetUrl: RUN_URL });
  assert.equal(shouldPublishStatus(previous, status, RUN_URL), false);
});

test('shouldPublishStatus keeps an older worker-run link when the new link is the current run', () => {
  const previous = previousStatuses([previousSuccess()]);
  const status = makeStatus({ targetUrl: RUN_URL });
  assert.equal(shouldPublishStatus(previous, status, RUN_URL), false);
});

test('shouldPublishStatus posts a linkless success that would gain the current-run link', () => {
  const previous = previousStatuses([previousSuccess({ target_url: null })]);
  const status = makeStatus({ targetUrl: RUN_URL });
  assert.equal(shouldPublishStatus(previous, status, RUN_URL), true);
});

test('shouldPublishStatus compares descriptions after truncation', () => {
  const long = 'x'.repeat(200);
  const previous = previousStatuses([
    previousSuccess({ description: `${'x'.repeat(137)}...` }),
  ]);
  const status = makeStatus({ description: long });
  assert.equal(shouldPublishStatus(previous, status, RUN_URL), false);
});

test('shouldPublishStatus posts when the success description changed', () => {
  const previous = previousStatuses([previousSuccess()]);
  const status = makeStatus({ description: 'Security review passed.' });
  assert.equal(shouldPublishStatus(previous, status, RUN_URL), true);
});

test('shouldPublishStatus posts when a worker run url changed', () => {
  const previous = previousStatuses([previousSuccess()]);
  const status = makeStatus({
    targetUrl: 'https://github.com/test/repo/actions/runs/56',
  });
  assert.equal(shouldPublishStatus(previous, status, RUN_URL), true);
});

test('shouldPublishStatus posts when the previous status had a different link or none', () => {
  const noUrl = previousStatuses([previousSuccess({ target_url: null })]);
  assert.equal(shouldPublishStatus(noUrl, makeStatus(), RUN_URL), true);
  const cleared = previousStatuses([previousSuccess()]);
  const status = makeStatus({ targetUrl: '' });
  assert.equal(shouldPublishStatus(cleared, status, RUN_URL), true);
});

test('shouldPublishStatus always posts pending, failure and error even when identical', () => {
  for (const state of ['pending', 'failure', 'error']) {
    const previous = previousStatuses([previousSuccess({ state })]);
    const status = makeStatus({ state, displayState: state });
    assert.equal(
      shouldPublishStatus(previous, status, RUN_URL),
      true,
      `${state} must be re-posted`,
    );
  }
});

test('shouldPublishStatus posts when the previous state differs', () => {
  for (const state of ['pending', 'failure', 'error']) {
    const previous = previousStatuses([previousSuccess({ state })]);
    assert.equal(shouldPublishStatus(previous, makeStatus(), RUN_URL), true);
  }
});

test('shouldPublishStatus posts when there is no previous status for the context', () => {
  assert.equal(shouldPublishStatus(new Map(), makeStatus(), RUN_URL), true);
  const other = previousStatuses([
    previousSuccess({ context: 'pr-flow/finalizer' }),
  ]);
  assert.equal(shouldPublishStatus(other, makeStatus(), RUN_URL), true);
  assert.equal(shouldPublishStatus(undefined, makeStatus(), RUN_URL), true);
});

function statusVisibility() {
  return {
    orderedStatuses: [
      makeStatus({
        context: 'pr-flow/ready',
        state: 'pending',
        description: 'Waiting.',
        targetUrl: RUN_URL,
      }),
      makeStatus({
        context: 'pr-flow/code-review',
        state: 'success',
        targetUrl: WORKER_URL,
      }),
      makeStatus({
        context: 'pr-flow/kilo-review',
        state: 'success',
        description: 'N/A',
        targetUrl: RUN_URL,
      }),
    ],
  };
}

test('publishFlowStatuses skips only unchanged successes and keeps order', () => {
  const posted = [];
  publishFlowStatuses({ ...basePr }, statusVisibility(), {
    currentRunUrl: RUN_URL,
    readStatuses: () => [
      previousSuccess({
        context: 'pr-flow/ready',
        state: 'pending',
        description: 'Waiting.',
        target_url: OLD_RUN_URL,
      }),
      previousSuccess(),
      previousSuccess({
        context: 'pr-flow/kilo-review',
        description: 'N/A',
        target_url: OLD_RUN_URL,
      }),
    ],
    publishStatus: (_pr, status) => posted.push(status.context),
  });

  assert.deepEqual(posted, ['pr-flow/ready']);
});

test('publishFlowStatuses uses the newest duplicate context even in newest-first order', () => {
  // Newest-first input, defensive: the combined /status endpoint is
  // deduplicated to one entry per context today, so duplicates cannot
  // reach this path; last-wins indexing would pick the older success
  // duplicate and wrongly skip if they ever did.
  const posted = [];
  publishFlowStatuses({ ...basePr }, statusVisibility(), {
    currentRunUrl: RUN_URL,
    readStatuses: () => [
      previousSuccess({
        context: 'pr-flow/code-review',
        state: 'failure',
        description: 'Code review failed.',
        created_at: '2026-11-22T10:00:00Z',
      }),
      previousSuccess({ created_at: '2026-11-22T09:00:00Z' }),
      previousSuccess({
        context: 'pr-flow/kilo-review',
        description: 'N/A',
        target_url: OLD_RUN_URL,
      }),
    ],
    publishStatus: (_pr, status) => posted.push(status.context),
  });

  assert.deepEqual(posted, ['pr-flow/ready', 'pr-flow/code-review']);
});

test('publishFlowStatuses uses the newest duplicate context in oldest-first history', () => {
  // Oldest-first input, defensive: the history endpoint
  // (commits/{sha}/statuses) returns newest-first today, but the newest
  // failure must still decide in either order.
  const posted = [];
  publishFlowStatuses({ ...basePr }, statusVisibility(), {
    currentRunUrl: RUN_URL,
    readStatuses: () => [
      previousSuccess({ created_at: '2026-11-22T09:00:00Z' }),
      previousSuccess({
        context: 'pr-flow/code-review',
        state: 'failure',
        description: 'Code review failed.',
        created_at: '2026-11-22T10:00:00Z',
      }),
      previousSuccess({
        context: 'pr-flow/kilo-review',
        description: 'N/A',
        target_url: OLD_RUN_URL,
      }),
    ],
    publishStatus: (_pr, status) => posted.push(status.context),
  });

  assert.deepEqual(posted, ['pr-flow/ready', 'pr-flow/code-review']);
});

test('publishFlowStatuses lets a usable created_at replace an unusable one', () => {
  // A missing or malformed timestamp must not pin the first array entry:
  // the duplicate with a parseable created_at decides even in oldest-first
  // order, where first-wins would keep the stale success.
  const posted = [];
  publishFlowStatuses({ ...basePr }, statusVisibility(), {
    currentRunUrl: RUN_URL,
    readStatuses: () => [
      previousSuccess({ created_at: 'not-a-date' }),
      previousSuccess({
        context: 'pr-flow/code-review',
        state: 'failure',
        description: 'Code review failed.',
        created_at: '2026-11-22T10:00:00Z',
      }),
      previousSuccess({
        context: 'pr-flow/kilo-review',
        description: 'N/A',
        target_url: OLD_RUN_URL,
      }),
    ],
    publishStatus: (_pr, status) => posted.push(status.context),
  });

  assert.deepEqual(posted, ['pr-flow/ready', 'pr-flow/code-review']);
});

test('publishFlowStatuses breaks equal created_at ties on the status id', () => {
  // GitHub timestamps have second granularity, so overlapping prt/wake runs
  // on the same head can post the same context within one second; the
  // monotonic id must decide in either array order.
  const tie = '2026-11-22T10:00:00Z';
  const staleSuccess = previousSuccess({ created_at: tie, id: '100' });
  const newerFailure = previousSuccess({
    context: 'pr-flow/code-review',
    state: 'failure',
    description: 'Code review failed.',
    created_at: tie,
    id: '200',
  });
  for (const duplicates of [
    [staleSuccess, newerFailure],
    [newerFailure, staleSuccess],
  ]) {
    const posted = [];
    publishFlowStatuses({ ...basePr }, statusVisibility(), {
      currentRunUrl: RUN_URL,
      readStatuses: () => [
        ...duplicates,
        previousSuccess({
          context: 'pr-flow/kilo-review',
          description: 'N/A',
          target_url: OLD_RUN_URL,
        }),
      ],
      publishStatus: (_pr, status) => posted.push(status.context),
    });

    assert.deepEqual(posted, ['pr-flow/ready', 'pr-flow/code-review']);
  }
});

test('usableStatusId never coerces a missing id into a real id of 0', () => {
  // Number(null) and Number('') are 0, which would make a missing id look
  // like a real (and oldest) one. Only publishFlowStatuses cannot observe
  // that, since no usable id is ever below 0, so the helper is checked here.
  assert.equal(usableStatusId(undefined), null);
  assert.equal(usableStatusId(null), null);
  assert.equal(usableStatusId(''), null);
  assert.equal(usableStatusId('not-a-number'), null);
  assert.equal(usableStatusId(0), 0);
  assert.equal(usableStatusId('200'), 200);
  assert.equal(usableStatusId(200), 200);
});

test('publishFlowStatuses lets a usable id beat an unusable one on tied created_at', () => {
  // Mirror of the created_at rule: when only one duplicate of a tied pair
  // carries a usable id, that entry must win in either array order. The
  // coercion edge cases (null, '') are pinned directly on usableStatusId
  // above; here the absent id is what the ordering assertions can observe.
  const tie = '2026-11-22T10:00:00Z';
  const staleSuccess = previousSuccess({ created_at: tie, id: '200' });
  for (const unusableId of [undefined, null, '']) {
    const failure = previousSuccess({
      context: 'pr-flow/code-review',
      state: 'failure',
      description: 'Code review failed.',
      created_at: tie,
      ...(unusableId === undefined ? {} : { id: unusableId }),
    });
    for (const duplicates of [
      [staleSuccess, failure],
      [failure, staleSuccess],
    ]) {
      const posted = [];
      publishFlowStatuses({ ...basePr }, statusVisibility(), {
        currentRunUrl: RUN_URL,
        readStatuses: () => [
          ...duplicates,
          previousSuccess({
            context: 'pr-flow/kilo-review',
            description: 'N/A',
            target_url: OLD_RUN_URL,
          }),
        ],
        publishStatus: (_pr, status) => posted.push(status.context),
      });

      assert.deepEqual(posted, ['pr-flow/ready']);
    }
  }
});

test('publishFlowStatuses keeps the first duplicate when created_at and id are unusable', () => {
  const posted = [];
  publishFlowStatuses({ ...basePr }, statusVisibility(), {
    currentRunUrl: RUN_URL,
    readStatuses: () => [
      previousSuccess(),
      previousSuccess({
        context: 'pr-flow/code-review',
        state: 'failure',
        description: 'Code review failed.',
        created_at: 'not-a-date',
      }),
      previousSuccess({
        context: 'pr-flow/kilo-review',
        description: 'N/A',
        target_url: OLD_RUN_URL,
      }),
    ],
    publishStatus: (_pr, status) => posted.push(status.context),
  });

  assert.deepEqual(posted, ['pr-flow/ready']);
});

test('publishFlowStatuses reads the status list once even with several successes', () => {
  const reads = [];
  const posted = [];
  publishFlowStatuses({ ...basePr }, statusVisibility(), {
    currentRunUrl: RUN_URL,
    readStatuses: (sha) => {
      reads.push(sha);
      return [];
    },
    publishStatus: (_pr, status) => posted.push(status.context),
  });

  assert.deepEqual(reads, [basePr.headSha]);
  assert.equal(posted.length, 3);
});

test('publishFlowStatuses posts everything when the status read throws', () => {
  const posted = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    publishFlowStatuses({ ...basePr }, statusVisibility(), {
      currentRunUrl: RUN_URL,
      readStatuses: () => {
        throw new Error('boom');
      },
      publishStatus: (_pr, status) => posted.push(status.context),
    });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(posted, [
    'pr-flow/ready',
    'pr-flow/code-review',
    'pr-flow/kilo-review',
  ]);
});

test('publishFlowStatuses posts everything when the read returns an unexpected shape', () => {
  for (const unexpected of [null, undefined, {}, 'nope', [null, 42]]) {
    const posted = [];
    publishFlowStatuses({ ...basePr }, statusVisibility(), {
      currentRunUrl: RUN_URL,
      readStatuses: () => unexpected,
      publishStatus: (_pr, status) => posted.push(status.context),
    });
    assert.equal(posted.length, 3);
  }
});

test('publishFlowStatuses does not read statuses when nothing is a success', () => {
  let reads = 0;
  const posted = [];
  publishFlowStatuses(
    { ...basePr },
    { orderedStatuses: [makeStatus({ state: 'pending' })] },
    {
      currentRunUrl: RUN_URL,
      readStatuses: () => {
        reads += 1;
        return [];
      },
      publishStatus: (_pr, status) => posted.push(status.context),
    },
  );

  assert.equal(reads, 0);
  assert.equal(posted.length, 1);
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

// ── Manual-only advisory review flow ──
// Manual-review markers keep the PR out of auto-merge, but should still run
// advisory review workers after CI is green.

test('makeDecision dispatches code review for needs-review after CI green', () => {
  const decision = makePrFlowDecision({
    pr: {
      ...basePr,
      labels: ['needs-review'],
      files: ['src/example.ts'],
    },
    policy: {
      blocking_labels_present: ['needs-review'],
      manual_only: false,
      maintainerAssociations: ['OWNER', 'MEMBER', 'COLLABORATOR'],
    },
    workerRuns: {},
    config: testConfig,
    checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
  });

  assert.equal(decision.state, 'flow/review-pending');
  assert.equal(decision.reason, 'Dispatching code review.');
  assert.deepEqual(decision.dispatch, {
    key: 'codeReview',
    workflow: 'code-review.yml',
    inputs: undefined,
  });
  assert.ok(!decision.desiredLabels.includes('flow/manual-only'));
});

test('makeDecision lands needs-review PR on terminal manual-only without dispatching the finalizer', () => {
  // The finalizer decision for an unapproved manual-only PR is deterministic
  // (manual_only), so dispatching it would loop watchdog -> orchestrator ->
  // finalizer forever without ever merging.
  const decision = makePrFlowDecision({
    pr: {
      ...basePr,
      labels: ['needs-review', 'ai-review-passed', 'security-review-passed'],
      files: ['src/app/page.tsx'],
    },
    policy: {
      blocking_labels_present: ['needs-review'],
      manual_only: false,
      maintainerAssociations: ['OWNER'],
    },
    workerRuns: { codeReview: [] },
    config: testConfig,
    checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
  });

  assert.equal(decision.state, 'flow/manual-only');
  assert.equal(
    decision.reason,
    'Manual review required; use /approve or merge manually.',
  );
  assert.equal(decision.dispatch, null);
  assert.ok(decision.desiredLabels.includes('flow/manual-only'));
});

test('makeDecision clears a stale finalizer-dispatched label on a manual-only PR', () => {
  // PRs caught in the historical dispatch loop carry both labels; the terminal
  // decision must strip flow/finalizer-dispatched so state converges.
  const decision = makePrFlowDecision({
    pr: {
      ...basePr,
      labels: [
        'needs-review',
        'ai-review-passed',
        'security-review-passed',
        'flow/finalizer-dispatched',
        'flow/manual-only',
      ],
      files: ['src/app/page.tsx'],
    },
    policy: {
      blocking_labels_present: ['needs-review'],
      manual_only: false,
      maintainerAssociations: ['OWNER'],
    },
    workerRuns: { codeReview: [] },
    config: testConfig,
    checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
  });

  assert.equal(decision.state, 'flow/manual-only');
  assert.equal(decision.dispatch, null);
  assert.ok(decision.labelsToRemove.includes('flow/finalizer-dispatched'));
});

test('makeDecision still dispatches the finalizer for a maintainer-approved needs-review PR', () => {
  const decision = makePrFlowDecision({
    pr: {
      ...basePr,
      labels: [
        'needs-review',
        'ai-review-passed',
        'security-review-passed',
        'maintainer-approved',
      ],
      files: ['src/app/page.tsx'],
    },
    policy: {
      blocking_labels_present: ['needs-review'],
      manual_only: false,
      maintainer_approved: true,
      maintainerAssociations: ['OWNER'],
    },
    workerRuns: { codeReview: [] },
    config: testConfig,
    checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
  });

  assert.equal(decision.state, 'flow/finalizer-dispatched');
  assert.deepEqual(decision.dispatch, {
    key: 'finalizer',
    workflow: 'pr-finalizer.yml',
    inputs: undefined,
  });
  assert.ok(!decision.desiredLabels.includes('flow/manual-only'));
});

test('makeDecision keeps hard blockers as failures even with needs-review', () => {
  const decision = makePrFlowDecision({
    pr: {
      ...basePr,
      labels: ['needs-review', 'do-not-merge'],
      files: ['src/example.ts'],
    },
    policy: {
      blocking_labels_present: ['needs-review', 'do-not-merge'],
      manual_only: false,
      maintainerAssociations: ['OWNER'],
    },
    workerRuns: {},
    config: testConfig,
    checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
  });

  assert.equal(decision.state, 'flow/review-blocked');
  assert.match(decision.reason, /do-not-merge/);
});

test('makeDecision keeps ai-review-concerns blocking on a needs-review manual-only PR', () => {
  const decision = makePrFlowDecision({
    pr: {
      ...basePr,
      labels: ['needs-review', 'ai-review-concerns'],
      files: ['src/example.ts'],
    },
    policy: {
      blocking_labels_present: ['needs-review', 'ai-review-concerns'],
      manual_only: false,
      maintainerAssociations: ['OWNER'],
    },
    workerRuns: {},
    config: testConfig,
    checkStatus: { status: 'passed', failing: [], pending: [], missing: [] },
  });

  assert.equal(decision.state, 'flow/review-blocked');
  assert.match(decision.reason, /ai-review-concerns/);
  assert.equal(decision.dispatch, null);
});

test('buildFlowVisibility sets all workers N/A for terminal manual-only', () => {
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
      manual_only: false,
      blocking_labels_present: ['needs-review'],
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
  for (const worker of [
    'codeReview',
    'securityReview',
    'dependencyReview',
    'kiloReview',
    'prImprove',
    'finalizer',
  ]) {
    assert.equal(
      visibility.workers[worker].displayState,
      'N/A',
      `worker ${worker} should be N/A for manual-only PR`,
    );
  }
});

function finalizerRetryContext(pr, workerRuns, checkStatus) {
  const config = JSON.parse(
    require('node:fs').readFileSync(
      path.join(__dirname, '..', '..', '..', 'pr-flow.json'),
      'utf8',
    ),
  );
  return {
    pr,
    config,
    eventName: 'workflow_dispatch',
    event: {},
    checkStatus: checkStatus ?? {
      status: 'passed',
      failing: [],
      pending: [],
      missing: [],
    },
    workerRuns,
    externalReview: { state: 'skipped', reason: 'not required' },
  };
}

test('makeDecision retries the finalizer after a failed run instead of parking', () => {
  // An apply failure (e.g. merge token rejected) is environmental, not a
  // policy decision — it must re-enter the bounded retry lane.
  const decision = makePrFlowDecision(
    finalizerRetryContext(
      {
        ...basePr,
        isDraft: false,
        isCrossRepository: false,
        baseRefName: 'main',
        headRefName: 'feature',
        files: ['src/app/page.tsx'],
        labels: [
          'flow/finalizer-dispatched',
          'ai-review-passed',
          'security-review-passed',
        ],
      },
      { finalizer: [completedWorkerRun('failure')], codeReview: [] },
    ),
  );

  assert.equal(decision.state, 'flow/finalizer-dispatched');
  assert.equal(decision.dispatch?.key, 'finalizer');
  assert.match(
    decision.reason,
    /Retrying finalizer after a failed run \(attempt 1\/3\)/,
  );
});

test('finalizer failures drive three retries and then stop subsequent wakes on that head', () => {
  const pr = {
    ...basePr,
    isDraft: false,
    isCrossRepository: false,
    baseRefName: 'main',
    headRefName: 'feature',
    files: ['src/app/page.tsx'],
    labels: ['ai-review-passed', 'security-review-passed'],
  };
  const passLabels = [...pr.labels];
  const finalizer = [];
  const context = finalizerRetryContext(pr, { finalizer, codeReview: [] });
  const initial = makePrFlowDecision(context);
  assert.equal(initial.dispatch?.key, 'finalizer');

  // Failed run history is available even when the dispatch label was never
  // written. These runs represent successive finalizer-to-orchestrator wakes.
  for (let retry = 1; retry <= 3; retry++) {
    finalizer.push({
      ...completedWorkerRun('failure', `2026-07-01T09:0${retry}:00Z`),
      databaseId: 900 + retry,
    });
    const decision = makePrFlowDecision(context);
    assert.equal(decision.dispatch?.key, 'finalizer');
    assert.match(decision.reason, new RegExp(`attempt ${retry}/3`));
    assert.deepEqual(decision.desiredLabels, ['flow/finalizer-dispatched']);
  }

  const latest = {
    ...completedWorkerRun('failure', '2026-07-01T09:04:00Z'),
    databaseId: 904,
    url: 'https://example.test/run/904',
  };
  finalizer.push(latest);
  const decision = makePrFlowDecision(context);

  assert.equal(decision.state, 'flow/manual-only');
  assert.equal(decision.dispatch, null);
  assert.match(decision.reason, /retry limit/i);
  const visibility = buildFlowVisibility({ ...context, decision });
  assert.equal(visibility.aggregate.state, 'success');
  assert.match(visibility.aggregate.description, /Manual merge required/);
  assert.equal(visibility.workers.finalizer.state, 'failure');
  assert.equal(visibility.workers.finalizer.targetUrl, latest.url);
  assert.match(makeComment({ pr, decision, visibility }), /retry limit/i);
  assert.match(makeComment({ pr, decision, visibility }), /merge manually/);

  pr.labels = [...passLabels, ...decision.desiredLabels];
  assert.equal(makePrFlowDecision(context).dispatch, null);
  assert.equal(
    makePrFlowDecision({ ...context, pr: { ...pr, headSha: 'new-head' } })
      .dispatch?.key,
    'finalizer',
  );
});

test('makeDecision keeps a succeeded finalizer without merge terminal', () => {
  const decision = makePrFlowDecision(
    finalizerRetryContext(
      {
        ...basePr,
        isDraft: false,
        isCrossRepository: false,
        baseRefName: 'main',
        headRefName: 'feature',
        files: ['src/app/page.tsx'],
        labels: [
          'flow/finalizer-dispatched',
          'ai-review-passed',
          'security-review-passed',
        ],
      },
      { finalizer: [completedWorkerRun('success')], codeReview: [] },
    ),
  );

  assert.equal(decision.state, 'flow/finalizer-dispatched');
  assert.equal(decision.dispatch, null);
  assert.match(decision.reason, /completed without merging/);
});

test('finalizer retries ignore legacy counter labels and runs for other PRs or heads', () => {
  const decision = makePrFlowDecision(
    finalizerRetryContext(
      {
        ...basePr,
        isDraft: false,
        isCrossRepository: false,
        baseRefName: 'main',
        headRefName: 'feature',
        files: ['src/app/page.tsx'],
        labels: [
          'flow/finalizer-dispatched',
          'flow/finalizer-retry-3',
          'ai-review-passed',
          'security-review-passed',
        ],
      },
      {
        finalizer: [
          completedWorkerRun('failure'),
          {
            ...completedWorkerRun('failure'),
            displayTitle: 'PR #420 @ abc123',
          },
          {
            ...completedWorkerRun('failure'),
            displayTitle: 'PR #42 @ old-head',
          },
        ],
        codeReview: [],
      },
    ),
  );

  assert.equal(decision.state, 'flow/finalizer-dispatched');
  assert.equal(decision.dispatch?.key, 'finalizer');
  assert.ok(decision.labelsToRemove.includes('flow/finalizer-retry-3'));
  assert.match(decision.reason, /attempt 1\/3/);
});

test('Finalizer counts failures and timeouts, excluding cancelled and startup-failure runs', () => {
  const pr = {
    ...basePr,
    files: ['src/app/page.tsx'],
    labels: [
      'flow/finalizer-dispatched',
      'ai-review-passed',
      'security-review-passed',
    ],
  };
  const finalizer = [
    'failure',
    'timed_out',
    'startup_failure',
    'cancelled',
  ].map((conclusion, index) => ({
    ...completedWorkerRun(conclusion, `2026-07-01T09:0${index}:00Z`),
    databaseId: 900 + index,
  }));
  const context = finalizerRetryContext(pr, { finalizer, codeReview: [] });
  const decision = makePrFlowDecision(context);
  assert.equal(decision.dispatch?.key, 'finalizer');
  assert.match(decision.reason, /attempt 2\/3/);
  assert.equal(
    buildFlowVisibility({ ...context, decision }).workers.finalizer.state,
    'failure',
  );

  finalizer.splice(0, 3);
  const cancelledOnly = makePrFlowDecision(context);
  assert.equal(cancelledOnly.dispatch?.key, 'finalizer');
  assert.doesNotMatch(cancelledOnly.reason, /attempt 0/);
});

for (const conclusion of ['cancelled', 'startup_failure']) {
  test(`Finalizer stops dispatching after eight ${conclusion} runs on one head`, () => {
    const pr = {
      ...basePr,
      files: ['src/app/page.tsx'],
      labels: ['ai-review-passed', 'security-review-passed'],
    };
    const finalizer = Array.from({ length: 7 }, (_, index) => ({
      ...completedWorkerRun(conclusion, `2026-07-01T09:0${index}:00Z`),
      databaseId: 900 + index,
    }));
    const context = finalizerRetryContext(pr, { finalizer, codeReview: [] });
    assert.equal(makePrFlowDecision(context).dispatch?.key, 'finalizer');

    finalizer.push({
      ...completedWorkerRun(conclusion, '2026-07-01T09:07:00Z'),
      databaseId: 907,
    });
    const decision = makePrFlowDecision(context);
    assert.equal(decision.state, 'flow/manual-only');
    assert.equal(decision.dispatch, null);
    assert.match(decision.reason, /run limit \(8\)/);
    const visibility = buildFlowVisibility({ ...context, decision });
    assert.equal(visibility.aggregate.state, 'success');
    assert.match(visibility.workers.finalizer.description, /run limit \(8\)/);
  });
}

test('legacy Finalizer lookup joins head and recent runs, preferring the fresh head snapshot', () => {
  const { config } = finalizerRetryContext(basePr);
  const calls = [];
  const stale = { ...completedWorkerRun(''), status: 'in_progress' };
  const baseRun = { ...completedWorkerRun('failure'), databaseId: 902 };
  const pr = { ...basePr, headSha: 'abc/123' };
  const headRun = {
    id: 900,
    status: 'completed',
    conclusion: 'failure',
    event: 'workflow_dispatch',
    display_title: 'PR #42 @ abc/123',
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-07-01T09:01:00Z',
    html_url: 'https://example.test/run/900',
  };
  const unavailableWorkerRuns = new Set();
  const runs = collectLegacyWorkerRuns(config, 'finalizer', pr, {
    unavailableWorkerRuns,
    getRepo: () => 'owner/repo',
    runCommand(command, args, options) {
      calls.push({ command, args, options });
      return JSON.stringify(
        args[0] === 'run'
          ? [stale, baseRun]
          : {
              total_count: 2,
              workflow_runs: [headRun, { ...headRun, id: 901 }],
            },
      );
    },
  });

  assert.deepEqual(
    runs.map((run) => run.databaseId),
    [900, 901, 902],
  );
  assert.deepEqual(runs[0], {
    databaseId: 900,
    status: 'completed',
    conclusion: 'failure',
    event: 'workflow_dispatch',
    displayTitle: headRun.display_title,
    createdAt: headRun.created_at,
    updatedAt: headRun.updated_at,
    url: headRun.html_url,
  });
  assert.deepEqual(runs[2], baseRun);
  assert.equal(calls[0].args[3], 'pr-finalizer.yml');
  assert.equal(
    calls[1].args[1],
    'repos/owner/repo/actions/workflows/pr-finalizer.yml/runs?head_sha=abc%2F123&per_page=50',
  );
  assert.equal(calls[1].args[2], '--jq');
  assert.match(calls[1].args[3], /\btotal_count\b.*\bid\b.*\bdisplay_title\b/);
  assert.equal(calls[1].options.allowFailure, false);
  assert.equal(unavailableWorkerRuns.size, 0);
});

test('legacy Finalizer lookup skips the head read for cross-repository PRs', () => {
  const pr = { ...basePr, isCrossRepository: true };
  const { config } = finalizerRetryContext(pr);
  const recent = [completedWorkerRun('failure')];
  const unavailableWorkerRuns = new Set();
  const runs = collectLegacyWorkerRuns(config, 'finalizer', pr, {
    unavailableWorkerRuns,
    getRepo: () => assert.fail('unexpected head lookup'),
    runCommand(command, args) {
      assert.equal(command, 'gh');
      assert.equal(args[0], 'run');
      return JSON.stringify(recent);
    },
  });
  assert.deepEqual(runs, recent);
  assert.equal(unavailableWorkerRuns.size, 0);
});

test('legacy Finalizer lookup returns recent runs on a head read error without a supplied set', () => {
  const { config } = finalizerRetryContext(basePr);
  const recent = [completedWorkerRun('failure')];
  const warnings = [];
  const runs = collectLegacyWorkerRuns(config, 'finalizer', basePr, {
    getRepo: () => 'owner/repo',
    warn: (message) => warnings.push(message),
    runCommand: (_command, args) => {
      if (args[0] === 'run') return JSON.stringify(recent);
      throw new Error('HTTP 403');
    },
  });
  assert.deepEqual(runs, recent);
  assert.match(warnings[0], /HTTP 403/);
  assert.deepEqual(collectLegacyWorkerRuns({}, 'finalizer', basePr), []);
});

test('legacy Finalizer history errors preserve recent runs and defer only Finalizer dispatch', () => {
  const pr = {
    ...basePr,
    files: ['src/app/page.tsx'],
    labels: [
      'flow/finalizer-dispatched',
      'ai-review-passed',
      'security-review-passed',
    ],
  };
  const recent = [completedWorkerRun('failure')];
  for (const headLookup of [
    () => {
      throw new Error('HTTP 403');
    },
    () => 'invalid JSON',
    () => '{"total_count":1,"workflow_runs":[{}]}',
    () => '{"total_count":51,"workflow_runs":[]}',
  ]) {
    const unavailableWorkerRuns = new Set();
    const warnings = [];
    const context = {
      ...finalizerRetryContext(pr, { codeReview: [] }),
      unavailableWorkerRuns,
      getWorkerRuns: (workerName) =>
        collectLegacyWorkerRuns(context.config, workerName, pr, {
          unavailableWorkerRuns,
          getRepo: () => 'owner/repo',
          warn: (message) => warnings.push(message),
          runCommand: (_command, args) =>
            args[0] === 'run' ? JSON.stringify(recent) : headLookup(),
        }),
    };

    const decision = makePrFlowDecision(context);
    assert.equal(decision.dispatch, null);
    assert.deepEqual(decision.desiredLabels, ['flow/finalizer-dispatched']);
    assert.deepEqual(context.workerRuns.finalizer, recent);
    assert.deepEqual([...unavailableWorkerRuns], ['finalizer']);
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /could not read finalizer history|history is truncated/i,
    );
    const visibility = buildFlowVisibility({ ...context, decision });
    assert.equal(visibility.workers.finalizer.state, 'pending');
    assert.equal(visibility.aggregate.state, 'pending');
    assert.match(
      makeComment({ pr, decision, visibility }),
      /history unavailable\. Dispatch deferred/i,
    );
    const prForWatchdog = {
      ...pr,
      headRefOid: pr.headSha,
      isDraft: false,
      labels: [],
    };
    const getStatuses = () => [
      { ...visibility.aggregate, created_at: '2026-07-01T09:00:00Z' },
    ];
    assert.deepEqual(
      selectStalePrs([prForWatchdog], {
        getStatuses,
        now: '2026-07-01T09:29:59Z',
      }),
      [],
    );
    const [stale] = selectStalePrs([prForWatchdog], {
      getStatuses,
      now: '2026-07-01T09:30:00Z',
    });
    assert.deepEqual(stale.recoveryReasons, ['stale-ready-pending']);
    const recovered = makePrFlowDecision({
      ...context,
      unavailableWorkerRuns: new Set(),
    });
    assert.equal(recovered.dispatch?.key, 'finalizer');
    assert.match(recovered.reason, /attempt 1\/3/);

    const reviewDecision = makePrFlowDecision({
      ...context,
      pr: { ...pr, labels: [] },
    });
    assert.equal(reviewDecision.dispatch?.key, 'codeReview');
  }
});

test('cross-repository PR cannot dispatch a privileged worker', () => {
  const decision = makePrFlowDecision(
    finalizerRetryContext(
      {
        ...basePr,
        isDraft: false,
        isCrossRepository: true,
        headRefName: 'claude-auto-fix-ci-external',
        baseRefName: 'main',
      },
      {},
    ),
  );

  assert.equal(decision.state, 'flow/manual-only');
  assert.equal(decision.dispatch, null);
});

test('cross-repository PR keeps failing required checks authoritative', () => {
  // The manual-only terminal state must not mask a red required check:
  // pr-flow/ready has to fail for a broken fork PR, not pass it to manual
  // review as success.
  const decision = makePrFlowDecision(
    finalizerRetryContext(
      {
        ...basePr,
        isDraft: false,
        isCrossRepository: true,
        headRefName: 'claude-auto-fix-ci-external',
        baseRefName: 'main',
      },
      {},
      {
        status: 'failed',
        failing: ['CI'],
        pending: [],
        missing: [],
      },
    ),
  );

  assert.equal(decision.state, 'flow/checks-failed');
  assert.equal(decision.dispatch, null);
});

test('cross-repository PR keeps blocking labels and review concerns authoritative', () => {
  const hardBlocked = makePrFlowDecision({
    ...finalizerRetryContext(
      {
        ...basePr,
        isDraft: false,
        isCrossRepository: true,
        headRefName: 'claude-auto-fix-ci-external',
        baseRefName: 'main',
        labels: ['do-not-merge'],
      },
      {},
    ),
    policy: { blocking_labels_present: ['do-not-merge'] },
  });
  assert.equal(hardBlocked.state, 'flow/review-blocked');
  assert.match(hardBlocked.reason, /do-not-merge/);

  const concernBlocked = makePrFlowDecision(
    finalizerRetryContext(
      {
        ...basePr,
        isDraft: false,
        isCrossRepository: true,
        headRefName: 'claude-auto-fix-ci-external',
        baseRefName: 'main',
        labels: ['ai-review-concerns'],
      },
      {},
    ),
  );
  assert.equal(concernBlocked.state, 'flow/review-blocked');
  assert.match(concernBlocked.reason, /ai-review-concerns/);
});

test('cross-repository manual-only state clears stale finalizer retry labels', () => {
  const decision = makePrFlowDecision(
    finalizerRetryContext(
      {
        ...basePr,
        isDraft: false,
        isCrossRepository: true,
        headRefName: 'claude-auto-fix-ci-external',
        baseRefName: 'main',
        labels: ['flow/finalizer-retry-1'],
      },
      {},
    ),
  );

  assert.equal(decision.state, 'flow/manual-only');
  assert.ok(decision.labelsToRemove.includes('flow/finalizer-retry-1'));
});

// A comment rendered for a given orchestrator run: workers without a run of
// their own link to the orchestrator run itself.
const runUrl = (runId) => `https://github.com/owner/repo/actions/runs/${runId}`;

function commentForRun(runId, { visibility = {}, decision = {} } = {}) {
  return makeComment({
    decision,
    visibility: {
      ...visibility,
      workers: {
        // Rows that fall back to the current orchestrator run link.
        dependencyReview: {
          displayState: 'N/A',
          description: 'N/A: Dependency review is not required for this PR.',
          targetUrl: runUrl(runId),
        },
        kiloReview: {
          displayState: 'N/A',
          description: 'Kilo review was skipped.',
          targetUrl: runUrl(runId),
        },
        prImprove: {
          displayState: 'N/A',
          description: 'N/A: PR Improve is not required for this PR.',
          targetUrl: runUrl(runId),
        },
        ...(visibility.workers ?? {}),
      },
    },
  });
}

test('stabilizeRunLinks makes two wakes with the same content compare equal', () => {
  const stored = commentForRun(111);
  const fresh = commentForRun(222);

  assert.notEqual(stored, fresh);
  assert.equal(stabilizeRunLinks(stored, fresh, runUrl(222)), stored);
});

test('stabilizeRunLinks keeps a changed worker-run link as a real change', () => {
  const stored = commentForRun(111);
  const fresh = commentForRun(222, {
    visibility: {
      workers: {
        codeReview: {
          displayState: 'pending',
          description: 'Waiting for code review signal.',
          targetUrl: 'https://example.test/code-review-rerun',
        },
      },
    },
  });

  const stabilized = stabilizeRunLinks(stored, fresh, runUrl(222));
  assert.notEqual(stabilized, stored);
  assert.match(
    stabilized,
    /\[run\]\(https:\/\/example\.test\/code-review-rerun\)/,
  );
});

test('stabilizeRunLinks keeps state, reason and description changes', () => {
  const stored = commentForRun(111);

  for (const changed of [
    commentForRun(222, { decision: { reason: 'Something else happened.' } }),
    commentForRun(222, { decision: { state: 'flow/review-blocked' } }),
    commentForRun(222, {
      visibility: {
        workers: {
          finalizer: {
            displayState: 'success',
            description: 'Finalizer finished.',
            targetUrl: 'https://example.test/finalizer',
          },
        },
      },
    }),
  ]) {
    assert.notEqual(stabilizeRunLinks(stored, changed, runUrl(222)), stored);
  }
});

test('stabilizeRunLinks treats a row that gains its first link as a change', () => {
  const stored = commentForRun(111, {
    visibility: {
      workers: {
        prImprove: {
          displayState: 'N/A',
          description: 'N/A: PR Improve is not required for this PR.',
          targetUrl: '',
        },
      },
    },
  });
  const fresh = commentForRun(222);

  assert.notEqual(stabilizeRunLinks(stored, fresh, runUrl(222)), stored);
});

test('stabilizeRunLinks is the identity without a current run url', () => {
  const stored = commentForRun(111);
  const fresh = commentForRun(222);

  assert.equal(stabilizeRunLinks(stored, fresh, ''), fresh);
});

test('upsertFlowComment asks the sticky helper to skip unchanged comments', () => {
  const previous = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  const received = [];

  try {
    upsertFlowComment({ number: 7 }, commentForRun(222), {
      upsert: (options) => received.push(options),
      currentRunUrl: runUrl(222),
    });
  } finally {
    if (previous === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = previous;
  }

  assert.equal(received.length, 1);
  assert.equal(received[0].skipIfUnchanged, true);
  assert.equal(received[0].prNumber, 7);
  assert.equal(received[0].marker, '<!-- pr-flow-orchestration -->');
  assert.equal(
    received[0].sameBody(commentForRun(111), commentForRun(222)),
    true,
  );
  assert.equal(
    received[0].sameBody(
      commentForRun(111).replace(/\n/g, '\r\n'),
      commentForRun(222),
    ),
    true,
    'a stored body returned with CRLF line endings is still the same body',
  );
  assert.equal(
    received[0].sameBody(
      commentForRun(111),
      commentForRun(222, { decision: { reason: 'Changed.' } }),
    ),
    false,
  );
});

// Runs the real orchestrator and sticky helper against a stubbed gh, as one
// wake with its own GITHUB_RUN_ID.
function wakeAgainstStoredComment(storedBody, nextBody, runId) {
  const childProcess = require('node:child_process');
  const original = childProcess.execFileSync;
  const modulePaths = [
    require.resolve('../lib/sticky-comment.cjs'),
    require.resolve('../orchestrate-pr-flow.cjs'),
  ];
  const calls = [];
  const saved = {
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
    GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
  };
  childProcess.execFileSync = (command, args) => {
    calls.push(args);
    return args.includes('--paginate')
      ? JSON.stringify([
          {
            id: 5,
            user: { login: 'github-actions[bot]' },
            body: storedBody,
          },
        ])
      : '{}';
  };
  for (const modulePath of modulePaths) delete require.cache[modulePath];
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_RUN_ID = String(runId);

  try {
    const flow = require('../orchestrate-pr-flow.cjs');
    flow.upsertFlowComment({ number: 7 }, nextBody);
  } finally {
    childProcess.execFileSync = original;
    for (const modulePath of modulePaths) delete require.cache[modulePath];
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return calls.map((args) => args.slice(0, 4));
}

test('a wake with unchanged content writes nothing to the sticky comment', () => {
  const calls = wakeAgainstStoredComment(
    commentForRun(111),
    commentForRun(222),
    222,
  );

  assert.deepEqual(calls, [
    ['api', 'repos/owner/repo/issues/7/comments', '--paginate'],
  ]);
});

test('a wake whose worker link changed replaces the sticky comment once', () => {
  const changed = commentForRun(222, {
    visibility: {
      workers: {
        codeReview: {
          displayState: 'success',
          description: 'Code review passed.',
          targetUrl: 'https://example.test/code-review-2',
        },
      },
    },
  });
  const calls = wakeAgainstStoredComment(commentForRun(111), changed, 222);

  assert.deepEqual(calls, [
    ['api', 'repos/owner/repo/issues/7/comments', '--paginate'],
    ['api', '-X', 'POST', 'repos/owner/repo/issues/7/comments'],
    ['api', '-X', 'DELETE', 'repos/owner/repo/issues/comments/5'],
  ]);
});

test('a wake with a changed decision reason replaces the sticky comment once', () => {
  const calls = wakeAgainstStoredComment(
    commentForRun(111),
    commentForRun(222, { decision: { reason: 'Waiting for something new.' } }),
    222,
  );

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].slice(1, 3), ['-X', 'POST']);
});

// Runs `fn` against a freshly loaded orchestrator whose commit read
// (`gh api repos/<owner/repo>/commits/<sha>`) answers through `onCommitRead`.
function withCommitRead(onCommitRead, fn) {
  const childProcess = require('node:child_process');
  const original = childProcess.execFileSync;
  const modulePath = require.resolve('../orchestrate-pr-flow.cjs');
  const saved = process.env.GITHUB_REPOSITORY;
  childProcess.execFileSync = (command, args) =>
    String(args?.[1] ?? '').includes('/commits/') ? onCommitRead() : '{}';
  delete require.cache[modulePath];
  process.env.GITHUB_REPOSITORY = 'owner/repo';

  try {
    fn(require(modulePath));
  } finally {
    childProcess.execFileSync = original;
    delete require.cache[modulePath];
    if (saved === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = saved;
  }
}

test('fetchHeadCommittedAt keeps an empty date for a failed commit read unless strict', () => {
  const sha = 'c'.repeat(40);
  const date = '2026-07-01T08:00:00Z';
  const failed = () => {
    throw Object.assign(new Error('gh: Not Found'), { stderr: '' });
  };

  withCommitRead(
    () => JSON.stringify({ commit: { committer: { date } } }),
    (flow) => assert.equal(flow.fetchHeadCommittedAt(sha), date),
  );
  // An unknown date only sends the worker-run lookup to the per-workflow
  // path, so the orchestrator keeps the fallback.
  withCommitRead(failed, (flow) =>
    assert.equal(flow.fetchHeadCommittedAt(sha), ''),
  );
  // A parity comparison must not read the failure as that legitimate case.
  withCommitRead(failed, (flow) =>
    assert.throws(
      () => flow.fetchHeadCommittedAt(sha, { strict: true }),
      /Not Found/,
    ),
  );
});

test('publishFlowStatuses uses the fresh GraphQL statuses and skips the REST read', () => {
  const posted = [];
  let restReads = 0;
  publishFlowStatuses({ ...basePr }, statusVisibility(), {
    currentRunUrl: RUN_URL,
    freshStatuses: [
      previousSuccess({
        context: 'pr-flow/ready',
        state: 'pending',
        description: 'Waiting.',
        target_url: OLD_RUN_URL,
      }),
      previousSuccess(),
      previousSuccess({
        context: 'pr-flow/kilo-review',
        description: 'N/A',
        target_url: OLD_RUN_URL,
      }),
    ],
    readStatuses: () => {
      restReads += 1;
      return [];
    },
    publishStatus: (_pr, status) => posted.push(status.context),
  });

  assert.equal(restReads, 0);
  assert.deepEqual(posted, ['pr-flow/ready']);
});

test('publishFlowStatuses reads REST when no fresh statuses were supplied', () => {
  for (const missing of [null, undefined, 'nope', {}]) {
    const reads = [];
    publishFlowStatuses({ ...basePr }, statusVisibility(), {
      currentRunUrl: RUN_URL,
      freshStatuses: missing,
      readStatuses: (sha) => {
        reads.push(sha);
        return [];
      },
      publishStatus: () => {},
    });
    assert.deepEqual(reads, [basePr.headSha], String(missing));
  }
});

test('publishFlowStatuses treats an empty fresh status list as "nothing posted yet"', () => {
  const posted = [];
  let restReads = 0;
  publishFlowStatuses({ ...basePr }, statusVisibility(), {
    currentRunUrl: RUN_URL,
    freshStatuses: [],
    readStatuses: () => {
      restReads += 1;
      return [];
    },
    publishStatus: (_pr, status) => posted.push(status.context),
  });

  assert.equal(restReads, 0);
  assert.equal(posted.length, 3);
});

test('upsertFlowComment hands the fresh comment list to the sticky helper', () => {
  const previous = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  const received = [];
  const fresh = [{ id: 5, user: { login: 'github-actions[bot]' }, body: 'x' }];

  try {
    upsertFlowComment({ number: 7 }, commentForRun(222), {
      upsert: (options) => received.push(options),
      currentRunUrl: runUrl(222),
      freshComments: fresh,
    });
    upsertFlowComment({ number: 7 }, commentForRun(222), {
      upsert: (options) => received.push(options),
      currentRunUrl: runUrl(222),
    });
    upsertFlowComment({ number: 7 }, commentForRun(222), {
      upsert: (options) => received.push(options),
      currentRunUrl: runUrl(222),
      freshComments: null,
    });
  } finally {
    if (previous === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = previous;
  }

  assert.equal(received[0].comments, fresh);
  // Without a fresh list the helper must read the comments itself.
  assert.equal('comments' in received[1], false);
  assert.equal('comments' in received[2], false);
});

test('publishVisibilityUpdates reads the comment list only after the status POSTs', () => {
  // Regression guard for the duplicate-comment race: the sticky-comment list
  // must be read after the status POSTs, never together with the status read.
  const order = [];
  const reads = [];
  const freshStatuses = [previousSuccess()];
  const freshComments = [{ id: 42 }];

  const result = publishVisibilityUpdates({ ...basePr }, statusVisibility(), {
    reviewSource: 'graphql',
    decision: { state: 'ready', reason: 'nothing to do' },
    readSnapshot: (_pr, options) => {
      reads.push([options.wantComments, options.wantStatuses]);
      order.push(options.wantStatuses ? 'read:statuses' : 'read:comments');
      return options.wantStatuses
        ? { comments: null, statuses: freshStatuses }
        : { comments: freshComments, statuses: null };
    },
    publishStatuses: (_pr, _visibility, options) => {
      order.push('post:statuses');
      assert.equal(options.freshStatuses, freshStatuses);
    },
    renderComment: () => 'rendered body',
    writeComment: (_pr, body, options) => {
      order.push('write:comment');
      assert.equal(body, 'rendered body');
      assert.equal(options.freshComments, freshComments);
    },
  });

  assert.deepEqual(order, [
    'read:statuses',
    'post:statuses',
    'read:comments',
    'write:comment',
  ]);
  // Each read asks only for the connection its consumer needs.
  assert.deepEqual(reads, [
    [false, true],
    [true, false],
  ]);
  assert.equal(result.fatalError, null);
});

test('publishVisibilityUpdates keeps the failure handling when the comment write fails', () => {
  const visibilityErrors = [];
  const errorVisibility = {
    orderedStatuses: [],
    aggregate: makeStatus({ context: 'pr-flow/aggregate', state: 'failure' }),
  };
  const aggregates = [];
  const built = [];

  const result = publishVisibilityUpdates({ ...basePr }, statusVisibility(), {
    reviewSource: 'graphql',
    decision: { state: 'ready', reason: 'nothing to do' },
    visibilityErrors,
    readSnapshot: () => ({ comments: null, statuses: null }),
    publishStatuses: () => {},
    renderComment: () => 'rendered body',
    writeComment: () => {
      throw new Error('gh exploded');
    },
    buildVisibility: (context) => {
      built.push(context);
      return errorVisibility;
    },
    publishAggregateStatus: (_pr, status) => aggregates.push(status),
  });

  assert.equal(result.visibility, errorVisibility);
  assert.equal(
    result.fatalError.message,
    'PR flow comment update failed: gh exploded',
  );
  assert.equal(built[0].visibilityErrors, visibilityErrors);
  assert.deepEqual(aggregates, [errorVisibility.aggregate]);
  assert.equal(visibilityErrors.length, 1);
});
