/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hasCurrentReadyStatus,
  hasExpiredReadyPendingStatus,
  selectStalePrs,
  runWatchdog,
} = require('../watch-pr-flow.cjs');

const BASE_TEST_TIME = '2025-01-01T00:00:00Z';

test('selectStalePrs selects open non-draft PR missing pr-flow/ready', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Test PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const getStatuses = () => [
    { context: 'ci/travis', state: 'success', created_at: BASE_TEST_TIME },
  ];

  const selected = selectStalePrs(prs, {
    getStatuses,
    now: BASE_TEST_TIME,
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].number, 1);
  assert.deepEqual(selected[0].recoveryReasons, ['missing-ready-status']);
});

test('selectStalePrs selects PR whose pr-flow/ready has been pending past the timeout', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Stuck PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'pending', created_at: BASE_TEST_TIME },
  ];

  const selected = selectStalePrs(prs, {
    getStatuses,
    now: '2025-01-01T00:30:00Z',
  });

  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0].recoveryReasons, ['stale-ready-pending']);
});

test('selectStalePrs skips PR whose pr-flow/ready pending is fresh', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Waiting PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'pending', created_at: BASE_TEST_TIME },
  ];

  const selected = selectStalePrs(prs, {
    getStatuses,
    now: '2025-01-01T00:10:00Z',
  });

  assert.equal(selected.length, 0);
});

test('selectStalePrs honors a custom readyPendingTimeoutMinutes', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Waiting PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'pending', created_at: BASE_TEST_TIME },
  ];

  const selected = selectStalePrs(prs, {
    getStatuses,
    now: '2025-01-01T00:10:00Z',
    readyPendingTimeoutMinutes: 5,
  });

  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0].recoveryReasons, ['stale-ready-pending']);
});

test('hasExpiredReadyPendingStatus ignores non-pending ready statuses', (t) => {
  const statuses = [
    { context: 'pr-flow/ready', state: 'success', created_at: BASE_TEST_TIME },
  ];

  assert.equal(
    hasExpiredReadyPendingStatus(statuses, { now: '2025-01-01T02:00:00Z' }),
    false,
  );
});

test('hasExpiredReadyPendingStatus ignores pending ready without a timestamp', (t) => {
  // createStatusReader falls back to [{ context: 'pr-flow/ready' }] when the
  // status API is unreadable; that placeholder must never trigger a rescue.
  const statuses = [{ context: 'pr-flow/ready' }];

  assert.equal(
    hasExpiredReadyPendingStatus(statuses, { now: '2025-01-01T02:00:00Z' }),
    false,
  );
});

test('selectStalePrs skips PRs that have current pr-flow/ready', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Test PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'success', created_at: BASE_TEST_TIME },
  ];

  const selected = selectStalePrs(prs, {
    getStatuses,
    now: BASE_TEST_TIME,
  });

  assert.equal(selected.length, 0);
});

test('selectStalePrs skips draft PRs', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Test PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: true,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const getStatuses = () => [];

  const selected = selectStalePrs(prs, {
    getStatuses,
    now: BASE_TEST_TIME,
  });

  assert.equal(selected.length, 0);
});

test('selectStalePrs selects PR with stale draft label', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Test PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [{ name: 'flow/draft' }],
    },
  ];

  const getStatuses = () => [];

  const selected = selectStalePrs(prs, {
    getStatuses,
    now: BASE_TEST_TIME,
  });

  assert.equal(selected.length, 1);
  assert.ok(selected[0].recoveryReasons.includes('stale-draft'));
  assert.ok(selected[0].recoveryReasons.includes('missing-ready-status'));
});

test('selectStalePrs skips closed/merged PRs', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Test PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'CLOSED',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const getStatuses = () => [];

  const selected = selectStalePrs(prs, {
    getStatuses,
    now: BASE_TEST_TIME,
  });

  assert.equal(selected.length, 0);
});

test('runWatchdog in dry-run mode returns selected PRs without dispatching', (t) => {
  let dispatchCallCount = 0;
  const mockDispatch = () => {
    dispatchCallCount += 1;
  };

  const prs = [
    {
      number: 1,
      title: 'Test PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const listPullRequests = () => prs;
  const getStatuses = () => [];

  const result = runWatchdog({
    dryRun: true,
    listPullRequests,
    dispatch: mockDispatch,
    getStatuses,
    now: BASE_TEST_TIME,
  });

  assert.equal(dispatchCallCount, 0);
  assert.equal(result.status, 'ok');
  assert.equal(result.dryRun, true);
  assert.equal(result.totalOpenPrs, 1);
  assert.equal(result.selected.length, 1);
  assert.equal(result.dispatched.length, 0);
});

test('runWatchdog dispatches orchestrator for selected PRs when not in dry-run', (t) => {
  let dispatchCallCount = 0;
  const mockDispatch = (pr) => {
    dispatchCallCount += 1;
    assert.equal(pr.number, 1);
  };

  const prs = [
    {
      number: 1,
      title: 'Test PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const listPullRequests = () => prs;
  const getStatuses = () => [];

  const result = runWatchdog({
    dryRun: false,
    listPullRequests,
    dispatch: mockDispatch,
    getStatuses,
    now: BASE_TEST_TIME,
  });

  assert.equal(dispatchCallCount, 1);
  assert.equal(result.status, 'ok');
  assert.equal(result.dryRun, false);
  assert.equal(result.totalOpenPrs, 1);
  assert.equal(result.selected.length, 1);
  assert.equal(result.dispatched.length, 1);
});

test('hasCurrentReadyStatus returns true when pr-flow/ready status exists', (t) => {
  const statuses = [
    { context: 'ci/travis', state: 'success' },
    { context: 'pr-flow/ready', state: 'success' },
  ];

  assert.equal(hasCurrentReadyStatus(statuses), true);
});

test('hasCurrentReadyStatus returns false when pr-flow/ready status missing', (t) => {
  const statuses = [{ context: 'ci/travis', state: 'success' }];

  assert.equal(hasCurrentReadyStatus(statuses), false);
});

test('hasCurrentReadyStatus handles statuses object with statuses array', (t) => {
  const statusesObj = {
    statuses: [{ context: 'pr-flow/ready', state: 'success' }],
  };

  assert.equal(hasCurrentReadyStatus(statusesObj), true);
});

test('selectStalePrs handles manual-only PRs (no pr-flow/ready status)', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Manual-only PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const getStatuses = () => [
    { context: 'ci/travis', state: 'success', created_at: BASE_TEST_TIME },
  ];

  const selected = selectStalePrs(prs, {
    getStatuses,
    now: BASE_TEST_TIME,
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].number, 1);
  assert.deepEqual(selected[0].recoveryReasons, ['missing-ready-status']);
});

test('selectStalePrs flags ready-pending-loop when status history shows repeated pending aggregates', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Looping PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'pending', created_at: BASE_TEST_TIME },
  ];
  const getStatusHistory = () =>
    Array.from({ length: 8 }, () => ({
      context: 'pr-flow/ready',
      state: 'pending',
    }));

  const selected = selectStalePrs(prs, {
    getStatuses,
    getStatusHistory,
    now: '2025-01-01T00:30:00Z',
  });

  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0].recoveryReasons, [
    'stale-ready-pending',
    'ready-pending-loop',
  ]);
});

test('selectStalePrs does not flag ready-pending-loop below the threshold', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Recovering PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'pending', created_at: BASE_TEST_TIME },
  ];
  const getStatusHistory = () => [
    { context: 'pr-flow/ready', state: 'pending' },
    { context: 'pr-flow/ready', state: 'success' },
    { context: 'pr-flow/kilo-review', state: 'pending' },
  ];

  const selected = selectStalePrs(prs, {
    getStatuses,
    getStatusHistory,
    now: '2025-01-01T00:30:00Z',
  });

  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0].recoveryReasons, ['stale-ready-pending']);
});

test('selectStalePrs flags ready-pending-loop even when the latest pr-flow/ready status is fresh', (t) => {
  // Each re-poke rewrites the pending aggregate with a fresh timestamp, so for
  // a real loop the latest pr-flow/ready is younger than the timeout when the
  // watchdog runs — the stale-ready-pending expiry branch is skipped. Loop
  // detection must run independently of that expiry or the stuck PR is only
  // re-poked, never escalated. This is the production shape (#753/#754).
  const prs = [
    {
      number: 1,
      title: 'Looping PR (fresh pending)',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const now = '2025-01-01T00:30:00Z';
  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'pending', created_at: now },
  ];
  const getStatusHistory = () =>
    Array.from({ length: 10 }, () => ({
      context: 'pr-flow/ready',
      state: 'pending',
    }));

  const selected = selectStalePrs(prs, {
    getStatuses,
    getStatusHistory,
    now,
  });

  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0].recoveryReasons, ['ready-pending-loop']);
});

test('selectStalePrs stops flagging ready-pending-loop once the latest pr-flow/ready converges to success', (t) => {
  // Success escape: a converged PR keeps ≥8 pending pr-flow/ready entries in the
  // 100-status history window, but its latest ready status is success — the
  // orchestrator advanced it. Without the latest-pending gate the watchdog
  // would keep re-dispatching and re-escalating this resolved PR every cycle
  // until the pending statuses aged out of the window.
  const prs = [
    {
      number: 1,
      title: 'Converged PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'success', created_at: BASE_TEST_TIME },
  ];
  const getStatusHistory = () =>
    Array.from({ length: 10 }, () => ({
      context: 'pr-flow/ready',
      state: 'pending',
    }));

  const selected = selectStalePrs(prs, {
    getStatuses,
    getStatusHistory,
    now: '2025-01-01T00:30:00Z',
  });

  assert.equal(selected.length, 0);
});

test('runWatchdog escalates ready-pending-loop PRs with the pm-escalation label', (t) => {
  const escalations = [];
  const summary = runWatchdog({
    listPullRequests: () => [
      {
        number: 7,
        title: 'Looping PR',
        url: 'https://github.com/test/repo/pull/7',
        state: 'OPEN',
        isDraft: false,
        headRefOid: 'abc123',
        labels: [],
      },
    ],
    dispatch: () => {},
    getStatuses: () => [
      {
        context: 'pr-flow/ready',
        state: 'pending',
        created_at: '2025-01-01T00:00:00Z',
      },
    ],
    getStatusHistory: () =>
      Array.from({ length: 10 }, () => ({
        context: 'pr-flow/ready',
        state: 'pending',
      })),
    escalate: (pr) => {
      escalations.push(pr.number);
      return true;
    },
    now: '2025-01-01T01:00:00Z',
  });

  assert.deepEqual(escalations, [7]);
  assert.equal(summary.escalated.length, 1);
  assert.equal(summary.escalated[0].number, 7);
});

test('runWatchdog surfaces escalation failures instead of dropping the PR', (t) => {
  // When addEscalationLabel fails (e.g. pm-escalation is missing), the PR must
  // not vanish from the summary looking handled — it lands in escalationFailures
  // so the silent-no-op is visible.
  const summary = runWatchdog({
    listPullRequests: () => [
      {
        number: 9,
        title: 'Looping PR',
        url: 'https://github.com/test/repo/pull/9',
        state: 'OPEN',
        isDraft: false,
        headRefOid: 'abc123',
        labels: [],
      },
    ],
    dispatch: () => {},
    getStatuses: () => [
      {
        context: 'pr-flow/ready',
        state: 'pending',
        created_at: '2025-01-01T00:00:00Z',
      },
    ],
    getStatusHistory: () =>
      Array.from({ length: 10 }, () => ({
        context: 'pr-flow/ready',
        state: 'pending',
      })),
    escalate: () => false,
    now: '2025-01-01T01:00:00Z',
  });

  assert.equal(summary.escalated.length, 0);
  assert.equal(summary.escalationFailures.length, 1);
  assert.equal(summary.escalationFailures[0].number, 9);
});

test('selectStalePrs rescues a dispatched finalizer parked on a failure aggregate', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Failed finalizer apply',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: ['flow/finalizer-dispatched'],
    },
  ];

  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'failure', created_at: BASE_TEST_TIME },
  ];

  const selected = selectStalePrs(prs, {
    getStatuses,
    now: '2025-01-01T00:30:00Z',
  });

  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0].recoveryReasons, ['stale-finalizer-failure']);
});

test('selectStalePrs leaves failure aggregates without the finalizer label alone', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Checks-failed PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: ['flow/checks-failed'],
    },
  ];

  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'failure', created_at: BASE_TEST_TIME },
  ];

  const selected = selectStalePrs(prs, {
    getStatuses,
    now: '2025-01-01T00:30:00Z',
  });

  assert.equal(selected.length, 0);
});

test('selectStalePrs does not rescue a fresh finalizer failure aggregate', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Just-failed finalizer',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: ['flow/finalizer-dispatched'],
    },
  ];

  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'failure', created_at: BASE_TEST_TIME },
  ];

  const selected = selectStalePrs(prs, {
    getStatuses,
    now: '2025-01-01T00:10:00Z',
  });

  assert.equal(selected.length, 0);
});

test('selectStalePrs flags finalizer-failure-loop when failure aggregates exceed threshold', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Stuck finalizer',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: ['flow/finalizer-dispatched'],
    },
  ];

  const now = '2025-01-01T00:30:00Z';
  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'failure', created_at: BASE_TEST_TIME },
  ];
  const getStatusHistory = () =>
    Array.from({ length: 10 }, () => ({
      context: 'pr-flow/ready',
      state: 'failure',
    }));

  const selected = selectStalePrs(prs, {
    getStatuses,
    getStatusHistory,
    now,
  });

  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0].recoveryReasons, [
    'stale-finalizer-failure',
    'finalizer-failure-loop',
  ]);
});

test('selectStalePrs does not flag finalizer-failure-loop below the threshold', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Recovering finalizer',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: ['flow/finalizer-dispatched'],
    },
  ];

  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'failure', created_at: BASE_TEST_TIME },
  ];
  const getStatusHistory = () => [
    { context: 'pr-flow/ready', state: 'failure' },
    { context: 'pr-flow/ready', state: 'success' },
  ];

  const selected = selectStalePrs(prs, {
    getStatuses,
    getStatusHistory,
    now: '2025-01-01T00:30:00Z',
  });

  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0].recoveryReasons, ['stale-finalizer-failure']);
});

test('selectStalePrs stops flagging finalizer-failure-loop once the latest pr-flow/ready converges to success', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Converged finalizer',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: ['flow/finalizer-dispatched'],
    },
  ];

  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'success', created_at: BASE_TEST_TIME },
  ];
  const getStatusHistory = () =>
    Array.from({ length: 10 }, () => ({
      context: 'pr-flow/ready',
      state: 'failure',
    }));

  const selected = selectStalePrs(prs, {
    getStatuses,
    getStatusHistory,
    now: '2025-01-01T00:30:00Z',
  });

  assert.equal(selected.length, 0);
});

test('selectStalePrs does not flag finalizer-failure-loop for PRs without the finalizer-dispatched label', (t) => {
  const prs = [
    {
      number: 1,
      title: 'Checks-failed PR',
      url: 'https://github.com/test/repo/pull/1',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'abc123',
      labels: [],
    },
  ];

  const getStatuses = () => [
    { context: 'pr-flow/ready', state: 'failure', created_at: BASE_TEST_TIME },
  ];
  const getStatusHistory = () =>
    Array.from({ length: 10 }, () => ({
      context: 'pr-flow/ready',
      state: 'failure',
    }));

  const selected = selectStalePrs(prs, {
    getStatuses,
    getStatusHistory,
    now: '2025-01-01T00:30:00Z',
  });

  assert.equal(selected.length, 0);
});

test('runWatchdog escalates finalizer-failure-loop PRs with the pm-escalation label', (t) => {
  const escalations = [];
  const summary = runWatchdog({
    listPullRequests: () => [
      {
        number: 8,
        title: 'Stuck finalizer',
        url: 'https://github.com/test/repo/pull/8',
        state: 'OPEN',
        isDraft: false,
        headRefOid: 'abc123',
        labels: ['flow/finalizer-dispatched'],
      },
    ],
    dispatch: () => {},
    getStatuses: () => [
      {
        context: 'pr-flow/ready',
        state: 'failure',
        created_at: '2025-01-01T00:00:00Z',
      },
    ],
    getStatusHistory: () =>
      Array.from({ length: 10 }, () => ({
        context: 'pr-flow/ready',
        state: 'failure',
      })),
    escalate: (pr) => {
      escalations.push(pr.number);
      return true;
    },
    now: '2025-01-01T01:00:00Z',
  });

  assert.deepEqual(escalations, [8]);
  assert.equal(summary.escalated.length, 1);
  assert.equal(summary.escalated[0].number, 8);
});
