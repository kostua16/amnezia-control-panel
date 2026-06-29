/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hasCurrentReadyStatus,
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
