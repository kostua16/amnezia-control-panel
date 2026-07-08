/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  PR_PRODUCER_REGISTRY,
  attachRepairRunsToPullRequest,
  buildPlan,
  decidePrAction,
  detectPrProducingWorkflows,
  parseFixReviewSummaryComment,
  parseRebaseSummaryComment,
  registryCoverage,
  safeIssueForFix,
  scheduleHealth,
  selectPrInspectionCandidates,
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

function comment(body, overrides = {}) {
  return {
    body,
    createdAt: '2026-07-01T09:30:00.000Z',
    updatedAt: '2026-07-01T09:30:00.000Z',
    author_association: 'OWNER',
    author: { type: 'User' },
    ...overrides,
  };
}

function rebaseSummary({ heading, head = 'abc123', run = 123, extra = [] }) {
  return comment(
    [
      '<!-- rebase-pr-summary -->',
      `## ${heading}`,
      '',
      `- Head SHA: \`${head}\``,
      `- Run: https://example.test/actions/runs/${run}`,
      '',
      ...extra,
      '<!-- updated: 2026-07-01T09:30:00.000Z -->',
    ].join('\n'),
  );
}

function fixReviewSummary({ heading, head = 'abc123', run = 123, extra = [] }) {
  return comment(
    [
      '<!-- fix-review-summary -->',
      `## FIX-REVIEW Report: ${heading}`,
      '',
      '- Command: `/fix-review`',
      `- Head SHA: \`${head}\``,
      `- Run: https://example.test/actions/runs/${run}`,
      '',
      ...extra,
      '<!-- updated: 2026-07-01T09:30:00.000Z -->',
    ].join('\n'),
  );
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

test('PM1b: PR pressure keeps older stateful PRs in the inspection set', () => {
  const prs = Array.from({ length: 12 }, (_, index) =>
    pr({
      number: index + 1,
      updatedAt: `2026-07-01T09:${String(index).padStart(2, '0')}:00.000Z`,
      labels: index === 0 ? ['flow/manual-only'] : [],
    }),
  );
  const candidates = selectPrInspectionCandidates(prs, 10);

  assert.deepEqual(
    candidates.map((candidate) => candidate.number),
    [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 1],
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

test('PM17b: manual-only PR with undated needs-review does not merge', () => {
  // gh pr view --json labels omits label timestamps in production, so an
  // undated needs-review must be treated as active and block direct merge.
  const action = decidePrAction(
    readyPr({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/manual-only',
        'needs-review',
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

test('PM18a: rebase summary parser separates failed, not-pushed, and no-op outcomes', () => {
  const failed = parseRebaseSummaryComment(
    rebaseSummary({ heading: 'Rebase failed', run: 501 }),
  );
  const notPushed = parseRebaseSummaryComment(
    rebaseSummary({
      heading: 'Validation failed - rebased branch not pushed',
      run: 502,
    }),
  );
  const noop = parseRebaseSummaryComment(
    rebaseSummary({
      heading: 'Rebase complete',
      run: 503,
      extra: ['- Pushed: no (no changes after rebase)'],
    }),
  );

  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.conclusion, 'failure');
  assert.equal(notPushed.outcome, 'validation_failed_not_pushed');
  assert.equal(notPushed.conclusion, 'failure');
  assert.equal(noop.outcome, 'noop');
  assert.equal(noop.noop, true);
});

test('PM18b: fix-review summary parser separates no-op, failures, and cancellation', () => {
  assert.equal(
    parseFixReviewSummaryComment(
      fixReviewSummary({ heading: 'No changes needed', run: 601 }),
    ).outcome,
    'noop',
  );
  assert.equal(
    parseFixReviewSummaryComment(
      fixReviewSummary({
        heading: 'Validation failed - fixes not pushed',
        run: 602,
      }),
    ).outcome,
    'validation_failed_not_pushed',
  );
  assert.equal(
    parseFixReviewSummaryComment(
      fixReviewSummary({ heading: 'Push rejected (push failed)', run: 603 }),
    ).outcome,
    'push_rejected',
  );
  assert.equal(
    parseFixReviewSummaryComment(
      fixReviewSummary({ heading: 'Review fix failed', run: 604 }),
    ).outcome,
    'failed',
  );
  assert.equal(
    parseFixReviewSummaryComment(
      fixReviewSummary({ heading: 'Review fix cancelled', run: 605 }),
    ).outcome,
    'cancelled',
  );
});

test('PM18c: live-shaped rebase failure escalates instead of repeating /rebase', () => {
  const plan = buildPlan(
    {
      now: NOW,
      openPrCount: 6,
      openIssueCount: 0,
      openPullRequests: [
        pr({
          number: 507,
          title: 'ci(workflows): audit automation-created PRs',
          codeReview: { stale: true },
          headCommittedAt: OLD_HEAD,
          checkStatus: { status: 'passed' },
          comments: [rebaseSummary({ heading: 'Rebase failed', run: 701 })],
        }),
      ],
      workflowRuns: [
        {
          workflow: 'rebase-pr.yml',
          databaseId: 701,
          displayTitle: 'ci(workflows): audit automation-created PRs',
          status: 'completed',
          conclusion: 'success',
          updatedAt: '2026-07-01T09:31:00.000Z',
          url: 'https://example.test/actions/runs/701',
        },
      ],
    },
    { now: NOW },
  );

  assert.equal(plan.decisions[0].action, 'claude-escalation');
  assert.match(plan.decisions[0].reason, /rebase-pr\.yml failed/);
  assert.equal(plan.actions[0].body.includes('@claude fix'), true);
  assert.equal(
    plan.actions.some((action) => action.body === '/rebase'),
    false,
  );
});

test('PM18d: validation-failed rebase summary escalates instead of repeating /rebase', () => {
  const hydrated = attachRepairRunsToPullRequest(
    pr({
      codeReview: { stale: true },
      headCommittedAt: OLD_HEAD,
      checkStatus: { status: 'passed' },
      comments: [
        rebaseSummary({
          heading: 'Validation failed - rebased branch not pushed',
          run: 702,
        }),
      ],
    }),
    [],
  );
  const action = decidePrAction(hydrated, { now: NOW });

  assert.equal(
    hydrated.runs.rebasePr.latest.outcome,
    'validation_failed_not_pushed',
  );
  assert.equal(action.actionKey, 'claude-escalation');
});

test('PM18e: live-shaped fix-review failure escalates instead of repeating /fix-review', () => {
  const plan = buildPlan(
    {
      now: NOW,
      openPrCount: 6,
      openIssueCount: 0,
      openPullRequests: [
        pr({
          number: 489,
          title: 'workflow repair',
          labels: ['ai-review-concerns'],
          checkStatus: { status: 'passed' },
          comments: [
            fixReviewSummary({
              heading: 'Validation failed - fixes not pushed',
              run: 801,
            }),
          ],
        }),
      ],
      workflowRuns: [],
    },
    { now: NOW },
  );

  assert.equal(plan.decisions[0].action, 'claude-escalation');
  assert.equal(
    plan.actions.some((action) => action.body === '/fix-review'),
    false,
  );
});

test('PM18f: active same-head fix-review run suppresses another /fix-review', () => {
  const plan = buildPlan(
    {
      now: NOW,
      openPrCount: 6,
      openIssueCount: 0,
      openPullRequests: [
        pr({
          title: 'review-blocked feature',
          labels: ['ai-review-concerns'],
          checkStatus: { status: 'passed' },
        }),
      ],
      workflowRuns: [
        {
          workflow: 'fix-review.yml',
          displayTitle: 'review-blocked feature',
          status: 'in_progress',
          conclusion: '',
          updatedAt: '2026-07-01T09:45:00.000Z',
        },
      ],
    },
    { now: NOW },
  );

  assert.equal(plan.decisions[0].action, 'none');
  assert.match(plan.decisions[0].reason, /already active/);
  assert.equal(plan.actions.length, 0);
});

test('PM18g: repeated cancelled fix-review runs escalate after threshold', () => {
  const plan = buildPlan(
    {
      now: NOW,
      openPrCount: 6,
      openIssueCount: 0,
      openPullRequests: [
        pr({
          title: 'cancelled review fix',
          labels: ['ai-review-concerns'],
          checkStatus: { status: 'passed' },
        }),
      ],
      workflowRuns: [
        {
          workflow: 'fix-review.yml',
          databaseId: 901,
          displayTitle: 'cancelled review fix',
          status: 'completed',
          conclusion: 'cancelled',
          updatedAt: '2026-07-01T09:00:00.000Z',
        },
        {
          workflow: 'fix-review.yml',
          databaseId: 902,
          displayTitle: 'cancelled review fix',
          status: 'completed',
          conclusion: 'cancelled',
          updatedAt: '2026-07-01T09:30:00.000Z',
        },
      ],
    },
    { now: NOW },
  );

  assert.equal(plan.decisions[0].action, 'claude-escalation');
});

test('PM18h: recent duplicate command comments suppress command reposts', () => {
  const action = decidePrAction(
    pr({
      mergeable: 'CONFLICTING',
      comments: [comment('/rebase')],
    }),
    { now: NOW },
  );

  assert.equal(action?.actionKey ?? 'none', 'none');
});

test('PM18i: project-manager summary reports pressure, escalations, and schedule gap', () => {
  const plan = buildPlan(
    {
      now: NOW,
      openPrCount: 6,
      openIssueCount: 0,
      openPullRequests: [
        pr({
          number: 560,
          title: 'deps rebase',
          codeReview: { stale: true },
          headCommittedAt: OLD_HEAD,
          checkStatus: { status: 'passed' },
          comments: [rebaseSummary({ heading: 'Rebase failed', run: 1001 })],
        }),
        readyPr({
          number: 561,
          updatedAt: '2026-07-01T08:00:00.000Z',
        }),
      ],
      workflowRuns: [
        {
          workflow: 'project-manager.yml',
          status: 'completed',
          conclusion: 'success',
          createdAt: '2026-07-01T08:00:00.000Z',
          updatedAt: '2026-07-01T08:10:00.000Z',
        },
        {
          workflow: 'project-manager.yml',
          status: 'completed',
          conclusion: 'success',
          createdAt: '2026-07-01T10:00:00.000Z',
          updatedAt: '2026-07-01T10:05:00.000Z',
        },
      ],
    },
    { now: NOW },
  );

  assert.equal(plan.summary.prsInspected, 2);
  assert.equal(plan.summary.priorFailedRepairs, 1);
  assert.equal(plan.summary.escalationsPlanned, 1);
  assert.equal(plan.summary.readyPrs, 1);
  assert.equal(plan.summary.projectManagerSchedule.latestGapHours, 2);
  assert.ok(plan.summary.nextLowLoadWorkflowIfPressureDrops);
});

test('PM18j: human workflow names still attach active repair runs', () => {
  const plan = buildPlan(
    {
      now: NOW,
      openPrCount: 6,
      openIssueCount: 0,
      openPullRequests: [
        pr({
          title: 'review-blocked feature',
          labels: ['ai-review-concerns'],
          checkStatus: { status: 'passed' },
        }),
      ],
      workflowRuns: [
        {
          workflowName: 'Fix Review',
          displayTitle: 'Fix Review PR #42 @ abc123',
          status: 'queued',
          conclusion: '',
          updatedAt: '2026-07-01T09:45:00.000Z',
        },
      ],
    },
    { now: NOW },
  );

  assert.equal(plan.decisions[0].action, 'none');
  assert.match(plan.decisions[0].reason, /already active/);
  assert.equal(plan.summary.activeRepairRuns['fix-review.yml'], 1);
});

test('PM18k: newer live run supersedes stale repair summary', () => {
  const hydrated = attachRepairRunsToPullRequest(
    pr({
      comments: [
        fixReviewSummary({
          heading: 'Validation failed - fixes not pushed',
          run: 1101,
        }),
      ],
    }),
    [
      {
        workflowName: 'Fix Review',
        databaseId: 1102,
        displayTitle: 'Fix Review PR #42 @ abc123',
        status: 'completed',
        conclusion: 'success',
        updatedAt: '2026-07-01T09:45:00.000Z',
        url: 'https://example.test/actions/runs/1102',
      },
    ],
  );

  assert.equal(hydrated.runs.fixReview.latest.databaseId, 1102);
  assert.equal(hydrated.runs.fixReview.latest.conclusion, 'success');
});

test('PM18l: flow checks-failed label falls back when rollup is unknown', () => {
  const action = decidePrAction(
    pr({
      labels: ['flow/checks-failed'],
      checkStatus: { status: 'unknown' },
    }),
    { now: NOW },
  );

  assert.equal(action.actionKey, 'fix');
  assert.equal(action.actions[0].body, '/fix');
});

test('PM18m: command comments without timestamps do not suppress forever', () => {
  const action = decidePrAction(
    pr({
      mergeable: 'CONFLICTING',
      comments: [comment('/rebase', { createdAt: '', updatedAt: '' })],
    }),
    { now: NOW },
  );

  assert.equal(action.actionKey, 'rebase');
  assert.equal(action.actions[0].body, '/rebase');
});

test('PM18n: schedule health canonicalizes workflow names and paths', () => {
  const health = scheduleHealth(
    {
      workflowRuns: [
        {
          workflowName: 'Project Manager',
          createdAt: '2026-07-01T08:00:00.000Z',
          updatedAt: '2026-07-01T08:05:00.000Z',
        },
        {
          path: '.github/workflows/project-manager.yml',
          createdAt: '2026-07-01T10:00:00.000Z',
          updatedAt: '2026-07-01T10:05:00.000Z',
        },
      ],
    },
    'project-manager.yml',
  );

  assert.equal(health.observedRuns, 2);
  assert.equal(health.latestGapHours, 2);
});

test('PM18o: summary exposes unknown checks and label fallbacks', () => {
  const plan = buildPlan(
    {
      now: NOW,
      openPrCount: 6,
      openIssueCount: 0,
      openPullRequests: [
        pr({
          number: 1201,
          labels: ['flow/checks-failed'],
          checkStatus: { status: 'unknown' },
        }),
        pr({
          number: 1202,
          checkStatus: { status: 'unknown' },
          updatedAt: '2026-07-01T08:00:00.000Z',
        }),
      ],
      workflowRuns: [
        {
          workflowName: 'Rebase PR',
          displayTitle: 'Rebase PR #999',
          status: 'in_progress',
          updatedAt: '2026-07-01T09:50:00.000Z',
        },
      ],
    },
    { now: NOW },
  );

  assert.equal(plan.summary.checksFailedLabelFallbacks, 1);
  assert.equal(plan.summary.unknownCheckStatus, 1);
  assert.equal(plan.summary.activeRepairRuns['rebase-pr.yml'], 1);
});

test('PM18p: newer non-success run does not mask a failed repair summary', () => {
  const hydrated = attachRepairRunsToPullRequest(
    pr({
      comments: [
        fixReviewSummary({
          heading: 'Validation failed - fixes not pushed',
          run: 1101,
        }),
      ],
    }),
    [
      {
        workflowName: 'Fix Review',
        databaseId: 1102,
        displayTitle: 'Fix Review PR #42 @ abc123',
        status: 'completed',
        conclusion: 'cancelled',
        updatedAt: '2026-07-01T09:45:00.000Z',
        url: 'https://example.test/actions/runs/1102',
      },
    ],
  );

  assert.equal(hydrated.runs.fixReview.latest.databaseId, '1101');
  assert.equal(hydrated.runs.fixReview.latest.conclusion, 'failure');
});

test('PM19: issue queue skips linked PR, active fix, and terminal labels', () => {
  assert.equal(safeIssueForFix(issue()), true);
  assert.equal(safeIssueForFix(issue({ body: 'Fixes #123' })), false);
  assert.equal(safeIssueForFix(issue({ activeFixRun: true })), false);
  assert.equal(safeIssueForFix(issue({ labels: ['fixed'] })), false);
});

test('PM19b: issue queue retries /fix after cooldown, capped at max attempts', () => {
  const now = '2026-07-01T12:00:00.000Z';
  const oldFix = { body: '/fix', createdAt: '2026-07-01T01:00:00.000Z' };
  const recentFix = { body: '/fix', createdAt: '2026-07-01T11:30:00.000Z' };
  assert.equal(safeIssueForFix(issue({ comments: [oldFix] }), { now }), true);
  assert.equal(
    safeIssueForFix(issue({ comments: [recentFix] }), { now }),
    false,
  );
  assert.equal(
    safeIssueForFix(issue({ comments: [{ body: '/fix' }] }), { now }),
    false,
  );
  assert.equal(
    safeIssueForFix(issue({ comments: [oldFix, oldFix, oldFix] }), { now }),
    false,
  );
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

test('PM24: stalled ready PR does not re-fire direct-merge within cooldown', () => {
  const action = decidePrAction(
    readyPr({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/finalizer-dispatched',
      ],
      projectManagerState: {
        headSha: 'abc123',
        readySince: READY_2H,
        cooldowns: { 'direct-merge': NOW },
      },
    }),
    { now: NOW },
  );

  assert.equal(action?.actionKey ?? 'none', 'none');
});

test('PM25: persisted directMergeReview decision is consulted without a live review', () => {
  const action = decidePrAction(
    readyPr({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/finalizer-dispatched',
      ],
      projectManagerState: {
        headSha: 'abc123',
        readySince: READY_2H,
        directMergeReview: { decision: 'merge', reason: 'safe' },
      },
    }),
    { now: NOW },
  );

  assert.equal(action.actionKey, 'direct-merge');
  assert(actionTypes(action).includes('merge-pr'));
});
