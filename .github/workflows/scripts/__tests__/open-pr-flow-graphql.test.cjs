/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const {
  fetchOpenPrFlowPage,
  normalizeFlowObservation,
} = require('../lib/open-pr-flow-graphql.cjs');

const head = 'a'.repeat(40);
const rollupPath = ['commits', 'nodes', 0, 'commit', 'statusCheckRollup'];
const connection = (nodes, hasNextPage = false) => ({
  nodes,
  pageInfo: { hasNextPage },
});
const node = (commit = { oid: head, statusCheckRollup: null }) => ({
  number: 1,
  state: 'OPEN',
  isDraft: false,
  headRefOid: head,
  labels: connection([]),
  reviews: { nodes: [], pageInfo: { hasPreviousPage: false } },
  commits: { nodes: [{ commit }] },
});
const status = (state, createdAt) => ({
  __typename: 'StatusContext',
  context: 'pr-flow/ready',
  state,
  createdAt,
});

test('verified null rollup is empty, but errored, missing and truncated rollups are unknown', () => {
  const empty = normalizeFlowObservation(node());
  assert.deepEqual(empty.statuses, []);
  assert.deepEqual(empty.checks, []);
  const denied = normalizeFlowObservation(node(), [{ path: rollupPath }]);
  assert.equal(denied.headVerified, true);
  assert.equal(denied.statuses, null);
  assert.equal(normalizeFlowObservation(node({ oid: head })).statuses, null);
  assert.equal(
    normalizeFlowObservation(
      node({
        oid: head,
        statusCheckRollup: { contexts: connection([], true) },
      }),
    ).statuses,
    null,
  );
});

test('normalizes the latest status creation time even when the state repeats and reviews are partial', () => {
  const pr = node({
    oid: head,
    statusCheckRollup: {
      contexts: connection([
        status('PENDING', '2026-10-01T00:01:00Z'),
        status('PENDING', '2026-10-01T00:02:00Z'),
      ]),
    },
  });
  pr.reviews.pageInfo.hasPreviousPage = true;
  pr.labels.pageInfo.hasNextPage = true;
  const observation = normalizeFlowObservation(pr, [
    { path: ['reviews', 'nodes', 0] },
  ]);
  assert.equal(observation.labels, null);
  assert.equal(observation.reviews, null);
  assert.equal(observation.statuses.length, 1);
  assert.equal(observation.statuses[0].state, 'pending');
  assert.equal(observation.statuses[0].created_at, '2026-10-01T00:02:00Z');
});

test('moved, missing or unreadable commit identities cannot verify a head', () => {
  for (const observation of [
    normalizeFlowObservation(
      node({ oid: 'b'.repeat(40), statusCheckRollup: null }),
    ),
    normalizeFlowObservation(node(null)),
    normalizeFlowObservation(node(), [{ path: ['commits', 'nodes', 0] }]),
  ]) {
    assert.equal(observation.headVerified, false);
    assert.equal(observation.statuses, null);
    assert.deepEqual(observation.observedRuns, []);
  }
});

test('bounded suites retain positive head-local workflow observations only', () => {
  const pr = node({
    oid: head,
    statusCheckRollup: null,
    checkSuites: connection(
      [
        {
          id: 'suite',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
          workflowRun: {
            databaseId: 42,
            runAttempt: 2,
            event: 'workflow_dispatch',
            workflow: { name: 'PR Finalizer' },
          },
        },
        { id: 'external', workflowRun: null },
      ],
      true,
    ),
  });
  const observation = normalizeFlowObservation(pr);
  assert.equal(observation.suitesComplete, false);
  assert.deepEqual(observation.observedRuns, [
    {
      suiteId: 'suite',
      databaseId: 42,
      workflow: 'PR Finalizer',
      attempt: 2,
      event: 'workflow_dispatch',
      status: 'completed',
      conclusion: 'failure',
    },
  ]);
});

test('fetches a bounded page and scopes partial errors to the matching PR', () => {
  const rateLimit = {
    cost: 2,
    remaining: 40,
    limit: 50,
    resetAt: '2026-10-01T01:00:00Z',
  };
  const result = fetchOpenPrFlowPage({
    owner: 'org',
    repo: 'repo',
    after: 'previous',
    runGraphql(query, variables) {
      assert.deepEqual(variables, {
        owner: 'org',
        name: 'repo',
        after: 'previous',
        first: 32,
      });
      for (const selection of [
        'rateLimit { cost remaining limit resetAt }',
        'labels(first: 32)',
        'reviews(last: 8)',
        'commits(last: 1)',
        'contexts(first: 64)',
        'checkSuites(first: 24)',
        '__typename',
      ]) {
        assert.ok(query.includes(selection), selection);
      }
      return {
        data: {
          rateLimit,
          repository: {
            pullRequests: {
              nodes: [node(), { ...node(), number: 2 }],
              pageInfo: { hasNextPage: true, endCursor: 'next' },
            },
          },
        },
        errors: [
          { path: ['repository', 'pullRequests', 'nodes', 0, ...rollupPath] },
        ],
      };
    },
  });
  assert.equal(result.pageInfo.endCursor, 'next');
  assert.deepEqual(result.rateLimit, rateLimit);
  assert.equal(result.observations[0].statuses, null);
  assert.deepEqual(result.observations[1].statuses, []);
});

test('rejects a whole-query error or missing PR connection', () => {
  const read = (response) =>
    fetchOpenPrFlowPage({
      owner: 'org',
      repo: 'repo',
      runGraphql: () => response,
    });
  assert.throws(() => read({ errors: [{ message: 'denied' }] }), /denied/);
  assert.throws(
    () => read({ data: { repository: null } }),
    /missing the open PR connection/,
  );
});
