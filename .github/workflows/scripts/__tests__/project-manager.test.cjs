/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  PR_PRODUCER_REGISTRY,
  buildPlan,
  decidePrAction,
  detectPrProducingWorkflows,
  registryCoverage,
  safeIssueForFix,
  selectRoute,
} = require('../project-manager.cjs');

const NOW = '2026-07-01T10:00:00.000Z';
const OLD_HEAD = '2026-07-01T04:00:00.000Z';
const READY_2H = '2026-07-01T08:00:00.000Z';
const READY_9H = '2026-07-01T01:00:00.000Z';

function pr(overrides = {}) {
  return {
    number: 42,
    title: 'feature',
    url: 'https://example.test/pull/42',
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    headRefName: 'feature',
    headRefOid: 'abc123',
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    labels: [],
    updatedAt: '2026-07-01T09:00:00.000Z',
    headCommittedAt: '2026-07-01T09:00:00.000Z',
    checkStatus: { status: 'pending' },
    ...overrides,
  };
}

function readyPr(overrides = {}) {
  return pr({
    labels: ['ai-review-passed', 'security-review-passed'],
    checkStatus: { status: 'passed' },
    ...overrides,
  });
}

function issue(overrides = {}) {
  return {
    number: 10,
    title: 'bug',
    state: 'OPEN',
    labels: [],
    updatedAt: '2026-07-01T09:00:00.000Z',
    body: '',
    comments: [],
    ...overrides,
  };
}

function actionTypes(plan) {
  return plan.actions.map((action) => action.type);
}

test('PM1: PR pressure selects latest 10 PRs', () => {
  const prs = Array.from({ length: 12 }, (_, index) =>
    pr({
      number: index + 1,
      updatedAt: `2026-07-01T09:${String(index).padStart(2, '0')}:00.000Z`,
    }),
  );
  const plan = buildPlan(
    { now: NOW, openPrCount: 12, openIssueCount: 0, openPullRequests: prs },
    { prLimit: 10, now: NOW },
  );

  assert.equal(plan.route, 'prs');
  assert.equal(plan.decisions.length, 10);
  assert.deepEqual(
    plan.decisions.map((decision) => decision.pr),
    [12, 11, 10, 9, 8, 7, 6, 5, 4, 3],
  );
});

test('PM2: issue pressure selects latest 10 standalone issues', () => {
  const issues = Array.from({ length: 12 }, (_, index) =>
    issue({
      number: index + 1,
      updatedAt: `2026-07-01T09:${String(index).padStart(2, '0')}:00.000Z`,
    }),
  );
  const plan = buildPlan(
    { now: NOW, openPrCount: 5, openIssueCount: 12, openIssues: issues },
    { issueLimit: 10, now: NOW },
  );

  assert.equal(plan.route, 'issues');
  assert.equal(plan.actions.length, 10);
  assert.deepEqual(
    plan.actions.map((action) => action.number),
    [12, 11, 10, 9, 8, 7, 6, 5, 4, 3],
  );
});

test('PM3: low pressure enters low-load route', () => {
  assert.equal(
    selectRoute({ openPrCount: 5, openIssueCount: 5 }, { route: 'auto' }),
    'low-load',
  );
});

test('PM4: stale current-head Code Review older than 5h posts /rebase', () => {
  const action = decidePrAction(
    pr({
      codeReview: { stale: true },
      headCommittedAt: OLD_HEAD,
      checkStatus: { status: 'passed' },
    }),
    { now: NOW },
  );

  assert.equal(action.actionKey, 'rebase');
  assert.equal(action.actions[0].body, '/rebase');
});

test('PM5: current-head no-op rebase suppresses repeat /rebase', () => {
  const action = decidePrAction(
    pr({
      codeReview: { stale: true },
      headCommittedAt: OLD_HEAD,
      checkStatus: { status: 'passed' },
      rebase: {
        latest: {
          body: 'Pushed: no (no changes after rebase)',
          conclusion: 'success',
        },
      },
    }),
    { now: NOW },
  );

  assert.notEqual(action?.actionKey, 'rebase');
});

test('PM6: conflicting PR posts /rebase', () => {
  const action = decidePrAction(pr({ mergeable: 'CONFLICTING' }), {
    now: NOW,
  });

  assert.equal(action.actionKey, 'rebase');
  assert.equal(action.actions[0].body, '/rebase');
});

test('PM7: failed checks post /fix', () => {
  const action = decidePrAction(pr({ checkStatus: { status: 'failed' } }), {
    now: NOW,
  });

  assert.equal(action.actionKey, 'fix');
  assert.equal(action.actions[0].body, '/fix');
});

test('PM8: review blockers post /fix-review', () => {
  const action = decidePrAction(
    pr({
      labels: ['ai-review-concerns'],
      checkStatus: { status: 'passed' },
    }),
    { now: NOW },
  );

  assert.equal(action.actionKey, 'fix-review');
  assert.equal(action.actions[0].body, '/fix-review');
});

test('PM9: ready PR dispatches finalizer first', () => {
  const action = decidePrAction(readyPr(), { now: NOW });

  assert.equal(action.actionKey, 'finalizer');
  assert.equal(action.actions[0].workflow, 'pr-finalizer.yml');
});

test('PM10: ready PR open after 1h opens workflow issue and /fix', () => {
  const action = decidePrAction(
    readyPr({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/finalizer-dispatched',
      ],
      projectManagerState: { headSha: 'abc123', readySince: READY_2H },
    }),
    { now: NOW },
  );

  assert.equal(action.actionKey, 'direct-merge');
  assert.deepEqual(actionTypes(action), [
    'create-or-reuse-issue',
    'comment',
    'direct-merge-review-required',
    'upsert-pr-state',
  ]);
});

test('PM11: ready PR open after 1h direct-merges after review returns merge', () => {
  const action = decidePrAction(
    readyPr({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/finalizer-dispatched',
      ],
      projectManagerState: { headSha: 'abc123', readySince: READY_2H },
      projectManagerReview: { decision: 'merge', reason: 'safe' },
    }),
    { now: NOW },
  );

  assert.equal(action.actionKey, 'direct-merge');
  assert(actionTypes(action).includes('merge-pr'));
});

test('PM12: project-manager review hold blocks direct merge', () => {
  const action = decidePrAction(
    readyPr({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/finalizer-dispatched',
      ],
      projectManagerState: { headSha: 'abc123', readySince: READY_2H },
      projectManagerReview: { decision: 'hold', reason: 'risk' },
    }),
    { now: NOW },
  );

  assert.equal(action.actionKey, 'direct-merge');
  assert(!actionTypes(action).includes('merge-pr'));
});

test('PM13: manual-only PR with maintainer approval can direct-merge after review', () => {
  const action = decidePrAction(
    readyPr({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/manual-only',
        'maintainer-approved',
      ],
      projectManagerState: { headSha: 'abc123', readySince: READY_2H },
      projectManagerReview: { decision: 'merge', reason: 'approved' },
    }),
    { now: NOW },
  );

  assert.equal(action.actionKey, 'manual-direct-merge');
  assert(actionTypes(action).includes('merge-pr'));
});

test('PM14: manual-only PR with no rejection for 8h can direct-merge after review', () => {
  const action = decidePrAction(
    readyPr({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/manual-only',
      ],
      projectManagerState: { headSha: 'abc123', readySince: READY_9H },
      projectManagerReview: { decision: 'merge', reason: 'aged out' },
    }),
    { now: NOW },
  );

  assert.equal(action.actionKey, 'manual-direct-merge');
  assert(actionTypes(action).includes('merge-pr'));
});

test('PM15: manual-only PR with project-manager hold does not merge', () => {
  const action = decidePrAction(
    readyPr({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/manual-only',
      ],
      comments: [
        {
          body: 'project-manager: hold',
          author_association: 'OWNER',
        },
      ],
      projectManagerState: { headSha: 'abc123', readySince: READY_9H },
      projectManagerReview: { decision: 'merge' },
    }),
    { now: NOW },
  );

  assert.equal(action?.actionKey ?? 'none', 'none');
});

test('PM16: manual-only PR with CHANGES_REQUESTED does not merge', () => {
  const action = decidePrAction(
    readyPr({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/manual-only',
      ],
      reviews: [
        {
          state: 'CHANGES_REQUESTED',
          author_association: 'OWNER',
          commit_id: 'abc123',
        },
      ],
      projectManagerState: { headSha: 'abc123', readySince: READY_9H },
      projectManagerReview: { decision: 'merge' },
    }),
    { now: NOW },
  );

  assert.equal(action?.actionKey ?? 'none', 'none');
});

test('PM17: manual-only PR with renewed needs-review does not merge', () => {
  const action = decidePrAction(
    readyPr({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/manual-only',
        { name: 'needs-review', updatedAt: '2026-07-01T09:00:00.000Z' },
      ],
      projectManagerState: { headSha: 'abc123', readySince: READY_9H },
      projectManagerReview: { decision: 'merge' },
    }),
    { now: NOW },
  );

  assert.equal(action?.actionKey ?? 'none', 'none');
});

test('PM18: failed fix-review posts deduped @claude escalation', () => {
  const action = decidePrAction(
    pr({
      runs: {
        fixReview: {
          latest: {
            conclusion: 'failure',
            databaseId: 123,
            url: 'https://example.test/actions/runs/123',
          },
        },
      },
    }),
    { now: NOW },
  );

  assert.equal(action.actionKey, 'claude-escalation');
  assert.match(action.actions[0].body, /@claude fix this workflow failure/);
});

test('PM19: issue queue skips linked PR, active fix, and terminal labels', () => {
  assert.equal(safeIssueForFix(issue()), true);
  assert.equal(safeIssueForFix(issue({ body: 'Fixes #123' })), false);
  assert.equal(safeIssueForFix(issue({ activeFixRun: true })), false);
  assert.equal(safeIssueForFix(issue({ labels: ['fixed'] })), false);
});

test('PM20: low-load dispatches exactly one eligible PR-producing workflow', () => {
  const plan = buildPlan({
    openPrCount: 1,
    openIssueCount: 1,
    openPullRequests: [],
    openIssues: [],
    activeRuns: [],
  });

  assert.equal(plan.route, 'low-load');
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].type, 'dispatch-workflow');
});

test('PM20b: low-load rotates to the oldest cooldown-complete workflow', () => {
  const proactive = PR_PRODUCER_REGISTRY.filter(
    (entry) => entry.category === 'proactive',
  );
  const newer = proactive[0];
  const older = proactive[1];
  const workflowLastRuns = Object.fromEntries(
    proactive.map((entry) => [entry.workflow, '2026-01-05T00:00:00.000Z']),
  );
  const plan = buildPlan({
    openPrCount: 1,
    openIssueCount: 1,
    openPullRequests: [],
    openIssues: [],
    workflowLastRuns: {
      ...workflowLastRuns,
      [newer.workflow]: '2026-01-02T00:00:00.000Z',
      [older.workflow]: '2026-01-01T00:00:00.000Z',
    },
  });

  assert.equal(plan.actions[0].workflow, older.workflow);
});

test('PM21: low-load skips active or duplicate-pending PR-producing workflow', () => {
  const first = PR_PRODUCER_REGISTRY.find(
    (entry) => entry.category === 'proactive',
  );
  const plan = buildPlan({
    openPrCount: 1,
    openIssueCount: 1,
    openPullRequests: [
      {
        title: first.dedupe.titlePrefix,
      },
    ],
    openIssues: [],
    activeRuns: [
      {
        workflow: first.workflow,
        status: 'in_progress',
      },
    ],
  });

  assert.equal(plan.actions.length, 1);
  assert.notEqual(plan.actions[0].workflow, first.workflow);
});

test('PM22: registry coverage catches missing PR-producing workflows', () => {
  const workflowsDir = path.join(__dirname, '..', '..');
  const missing = registryCoverage(detectPrProducingWorkflows(workflowsDir));

  assert.deepEqual(missing, []);
});

test('PM23: dry-run plans mutations without executing them', () => {
  const plan = buildPlan({
    now: NOW,
    openPrCount: 6,
    openIssueCount: 0,
    openPullRequests: [pr({ checkStatus: { status: 'failed' } })],
  });

  assert.equal(plan.route, 'prs');
  assert.equal(plan.actions[0].type, 'comment');
  assert.equal(plan.actions[0].body, '/fix');
});
