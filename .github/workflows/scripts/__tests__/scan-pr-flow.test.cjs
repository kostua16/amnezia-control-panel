/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { load } = require('js-yaml');
const { planSweep, scanPrFlow } = require('../scan-pr-flow.cjs');
const {
  evaluateCondition,
  renderTemplate,
} = require('./helpers/github-expression.cjs');

const head = 'a'.repeat(40);
const now = '2026-10-01T00:30:00.000Z';
const recovery = '7,22,37,52 * * * *';
const scanOnly = '2,12,17,27,32,42,47,57 * * * *';
const status = (
  state,
  created_at = '2026-10-01T00:00:00.000Z',
  context = 'pr-flow/ready',
) => ({
  context,
  state,
  created_at,
});
const observation = (overrides) => ({
  number: 1,
  state: 'OPEN',
  isDraft: false,
  headVerified: true,
  headRefOid: head,
  labels: [],
  statuses: [],
  observedRuns: [],
  ...overrides,
});
const node = (number, statuses = [], headRefOid = head) => ({
  number,
  state: 'OPEN',
  isDraft: false,
  headRefOid,
  labels: { nodes: [], pageInfo: { hasNextPage: false } },
  commits: {
    nodes: [
      {
        commit: {
          oid: headRefOid,
          statusCheckRollup: {
            contexts: {
              pageInfo: { hasNextPage: false },
              nodes: statuses.map(({ context, state, created_at }) => ({
                __typename: 'StatusContext',
                context,
                state: state.toUpperCase(),
                createdAt: created_at,
              })),
            },
          },
        },
      },
    ],
  },
});
const page = (nodes, hasNextPage = false, endCursor = null) => ({
  data: {
    rateLimit: {
      cost: 2,
      remaining: 48,
      limit: 50,
      resetAt: '2026-10-01T01:00:00Z',
    },
    repository: {
      pullRequests: { nodes, pageInfo: { hasNextPage, endCursor } },
    },
  },
});
const call = (options) =>
  scanPrFlow({
    mode: 'shadow',
    repository: 'org/repo',
    now,
    log() {},
    ...options,
  });

const readWorkflow = (file) =>
  load(readFileSync(join(__dirname, '../..', file), 'utf8'));

test('shadow listens for orchestrator completions, manual dispatch and the original cron slots', () => {
  const workflow = readWorkflow('pr-flow-watchdog.yml');
  const orchestrator = readWorkflow('pr-flow.yml');
  assert.deepEqual(workflow.on.workflow_run, {
    workflows: [orchestrator.name],
    types: ['completed'],
  });
  assert.ok(workflow.on.workflow_dispatch);
  assert.deepEqual(workflow.on.schedule, [
    { cron: recovery },
    { cron: scanOnly },
  ]);

  const { shadow } = workflow.jobs;
  assert.equal(
    shadow.if,
    [
      "vars.PR_FLOW_SWEEP_MODE == 'shadow' &&",
      "github.ref == format('refs/heads/{0}', github.event.repository.default_branch) &&",
      "(github.event_name == 'workflow_run' || github.event_name == 'workflow_dispatch' || github.event_name == 'schedule') &&",
      "(github.event_name != 'workflow_run' ||",
      "endsWith(format('{0}', github.event.workflow_run.id), '0') ||",
      "endsWith(format('{0}', github.event.workflow_run.id), '5'))",
    ].join(' '),
  );
  const shouldScan = (eventName, upstreamRun) =>
    evaluateCondition(shadow.if, {
      vars: { PR_FLOW_SWEEP_MODE: 'shadow' },
      github: {
        ref: 'refs/heads/main',
        event_name: eventName,
        event: { repository: { default_branch: 'main' }, ...upstreamRun },
      },
    });
  for (let digit = 0; digit < 10; digit += 1) {
    assert.equal(
      shouldScan('workflow_run', { workflow_run: { id: 12340 + digit } }),
      digit === 0 || digit === 5,
    );
  }
  assert.equal(shouldScan('schedule'), true);
  assert.equal(shouldScan('workflow_dispatch'), true);
  assert.deepEqual(shadow.permissions, {
    contents: 'read',
    'pull-requests': 'read',
    statuses: 'read',
    checks: 'read',
    actions: 'read',
  });
  const { group, 'cancel-in-progress': cancelInProgress } = shadow.concurrency;
  assert.equal(cancelInProgress, false);
  assert.equal(
    renderTemplate(group, { github: { event: {} } }),
    'pr-flow-sweep-shadow',
  );
  assert.equal(
    renderTemplate(group, { github: { event: { schedule: scanOnly } } }),
    'pr-flow-sweep-shadow',
  );
  for (const runId of [1, 2]) {
    assert.equal(
      renderTemplate(group, {
        github: {
          event: { schedule: workflow.on.schedule[0].cron },
          run_id: runId,
        },
      }),
      'pr-flow-sweep-shadow-recovery',
    );
  }
  assert.equal(workflow.concurrency, undefined);
  assert.equal(shadow.steps.length, 3);
  const [checkout, setup, scan] = shadow.steps;
  assert.match(checkout.uses, /^actions\/checkout@[0-9a-f]{40}$/);
  assert.deepEqual(checkout.with, {
    ref: '${{ github.sha }}',
    'persist-credentials': false,
  });
  assert.equal(setup.uses, './.github/actions/setup-environment');
  assert.equal(setup.if, undefined);
  assert.equal(scan.if, undefined);
  assert.deepEqual(scan.env, {
    GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
    PR_FLOW_SWEEP_MODE: '${{ vars.PR_FLOW_SWEEP_MODE }}',
    PR_FLOW_SWEEP_SCHEDULE: '${{ github.event.schedule }}',
  });
  assert.equal(scan.run, 'node .github/workflows/scripts/scan-pr-flow.cjs\n');
});

test('emits one machine-readable summary for an orchestrator completion', () => {
  const lines = [];
  call({
    triggerEvent: 'workflow_run',
    runGraphql: () => page([node(1, [status('pending')])]),
    execGh: assert.fail,
    log: (line) => lines.push(line),
  });
  assert.ok(lines.some((line) => line.startsWith('PR flow shadow ')));
  assert.deepEqual(
    lines.filter((line) => line.startsWith('SHADOW_SWEEP_SUMMARY ')),
    [
      `SHADOW_SWEEP_SUMMARY ${JSON.stringify({
        triggerEvent: 'workflow_run',
        status: 'ok',
        recoverySlot: false,
        cost: 2,
        remaining: 48,
        openPrs: 1,
        candidatePrs: 1,
        comparisonDiffs: null,
      })}`,
    ],
  );
});

test('uses the watchdog reasons and its exact 30-minute boundary', () => {
  const pending = status('pending');
  const failure = status('failure');
  const inputs = [
    observation({ labels: ['flow/draft'] }),
    observation({
      number: 2,
      statuses: [
        pending,
        status('pending', pending.created_at, 'pr-flow/kilo-review'),
      ],
    }),
    observation({
      number: 3,
      statuses: [status('pending', '2026-10-01T00:00:00.001Z')],
    }),
    observation({
      number: 4,
      labels: ['flow/finalizer-dispatched'],
      statuses: [failure],
    }),
    observation({ number: 5, statuses: [status('success')] }),
    observation({ number: 6, isDraft: true }),
    observation({ number: 7, state: 'CLOSED' }),
  ];
  const result = planSweep(inputs, {
    now,
    recoverySlot: true,
    getStatusHistory: (pr) =>
      Array(8).fill(pr.number === 4 ? failure : pending),
  });
  assert.deepEqual(
    result.candidates.map(({ number, reasons }) => [number, reasons]),
    [
      [1, ['stale-draft', 'missing-ready-status']],
      [2, ['expired-kilo-review', 'stale-ready-pending', 'ready-pending-loop']],
      [3, ['ready-pending-loop']],
      [4, ['stale-finalizer-failure', 'finalizer-failure-loop']],
    ],
  );
  assert.deepEqual(
    planSweep(inputs, { now, getStatusHistory: assert.fail }).candidates.map(
      ({ number }) => number,
    ),
    [1, 2, 4],
  );
});

test('only complete, unambiguous current-head check evidence supports a shadow check rescue', () => {
  const requiredChecks = [{ workflow: 'CI', names: ['Test'] }];
  const run = {
    workflow: 'CI',
    suiteId: 'suite',
    databaseId: 5,
    attempt: 1,
    status: 'completed',
    event: 'pull_request',
  };
  const check = {
    name: 'Test',
    suiteId: 'suite',
    status: 'completed',
    conclusion: 'success',
    completedAt: '2026-10-01T00:28:00.000Z',
  };
  const ready = status('pending', '2026-10-01T00:27:00.000Z');
  const pr = observation({
    labels: ['flow/checks-pending'],
    statuses: [ready],
    checks: [check],
    observedRuns: [run],
    suitesComplete: true,
  });
  const reasons = (overrides = {}) =>
    planSweep([{ ...pr, ...overrides }], {
      now,
      requiredChecks,
    }).candidates.flatMap((item) => item.reasons);
  assert.deepEqual(reasons(), ['checks-completed-after-ready']);
  assert.deepEqual(
    reasons({ checks: [{ ...check, conclusion: 'cancelled' }] }),
    ['checks-completed-after-ready'],
  );
  for (const overrides of [
    { headVerified: false },
    { suitesComplete: false },
    { checks: null },
    { checks: [] },
    { observedRuns: [run, { ...run, attempt: 2 }] },
    { observedRuns: [{ ...run, attempt: 2 }] },
    { observedRuns: [{ ...run, event: 'push' }] },
    { observedRuns: [{ ...run, workflow: 'Other' }] },
    { checks: [{ ...check, suiteId: 'stale' }] },
    { checks: [{ ...check, completedAt: ready.created_at }] },
    { checks: [{ ...check, completedAt: '2026-10-01T00:28:00.001Z' }] },
    { statuses: [status('pending', '2026-10-01T00:29:00Z')] },
  ])
    assert.deepEqual(reasons(overrides), [], JSON.stringify(overrides));
});

test('off and unimplemented modes perform no work', () => {
  for (const mode of [
    '',
    undefined,
    'off',
    'SHADOW',
    'shdaow',
    'canary',
    'active',
  ]) {
    assert.deepEqual(
      call({
        mode,
        execGh: assert.fail,
        runGraphql: assert.fail,
        log: assert.fail,
      }),
      { status: 'off' },
    );
  }
});

test('enumerates and deduplicates pages, discards a moved head, and reports page cost', () => {
  const responses = [
    page([node(1), node(2)], true, 'next'),
    page([node(1), node(2, [], 'b'.repeat(40)), node(3)]),
  ];
  const calls = [];
  const lines = [];
  const summary = call({
    schedule: scanOnly,
    execGh: assert.fail,
    log: (line) => lines.push(line),
    runGraphql: (query, variables) => {
      assert.match(query, /^\s*query OpenPrFlow/);
      calls.push(variables.after);
      return responses.shift();
    },
  });
  assert.deepEqual(calls, [null, 'next']);
  assert.deepEqual(summary.movedHeads, [2]);
  assert.equal(summary.cost, 4);
  assert.equal(summary.restReads, 0);
  assert.equal(summary.comparison, null);
  assert.deepEqual(
    lines.filter((line) => line.startsWith('would wake ')),
    [1, 3].map(
      (n) => `would wake PR #${n} because missing-ready-status (head=${head})`,
    ),
  );
});

test('rejects missing and repeated cursors before logging any wake', () => {
  for (const cursor of [null, 'repeat']) {
    const lines = [];
    const result = call({
      runGraphql: () => page([node(1)], true, cursor),
      execGh: assert.fail,
      log: (line) => lines.push(line),
    });
    assert.equal(result.status, 'unavailable');
    assert.match(result.error, /missing or repeated cursor/);
    assert.ok(lines.every((line) => !line.startsWith('would wake ')));
    assert.match(
      lines.at(-1),
      /^SHADOW_SWEEP_SUMMARY .*"status":"unavailable"/,
    );
  }
});

test('shrinks pathological pages, preserving the cursor and cost telemetry', () => {
  const sizes = [];
  const result = call({
    execGh: assert.fail,
    runGraphql: (_query, { first, after }) => {
      assert.equal(after, null);
      sizes.push(first);
      if (first === 32)
        return {
          ...page([]),
          errors: [
            { type: 'RESOURCE_LIMITED', message: 'Query could not complete' },
          ],
        };
      return page([node(1)]);
    },
  });
  assert.deepEqual(sizes, [32, 16]);
  assert.equal(result.cost, 4);
  assert.equal(result.candidatePrs, 1);
});

test('low GraphQL quota stops discovery before any recovery comparison reads', () => {
  const response = page([node(1)], true, 'next');
  response.data.rateLimit.remaining = 1;
  const result = call({
    schedule: recovery,
    execGh: assert.fail,
    runGraphql: () => response,
  });
  assert.equal(result.status, 'unavailable');
  assert.match(result.error, /budget is too low/);
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].remaining, 1);
});

test('keeps a complete result when the last GraphQL page leaves the quota low', () => {
  const response = page([node(1)]);
  response.data.rateLimit.remaining = 1;
  const result = call({ execGh: assert.fail, runGraphql: () => response });
  assert.equal(result.status, 'ok');
  assert.equal(result.candidatePrs, 1);
});

test('retains usable GraphQL observations when gh exits with a partial response', () => {
  const response = page([node(1), node(2)]);
  response.errors = [
    {
      path: [
        'repository',
        'pullRequests',
        'nodes',
        0,
        'commits',
        'nodes',
        0,
        'commit',
        'statusCheckRollup',
      ],
    },
  ];
  const result = call({
    execGh() {
      throw Object.assign(new Error('gh exited nonzero'), {
        stdout: JSON.stringify(response),
      });
    },
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.candidatePrs, 1);
  assert.deepEqual(result.unknown, [{ number: 1, evidence: ['statuses'] }]);
});

test('recognizing a head-local finalizer run alone never drives a retry wake', () => {
  const pr = observation({
    labels: ['flow/finalizer-dispatched'],
    statuses: [status('success')],
    suitesComplete: false,
    observedRuns: [
      {
        workflow: 'PR Finalizer',
        databaseId: 5,
        status: 'completed',
        conclusion: 'failure',
      },
    ],
  });
  assert.deepEqual(
    planSweep([pr], { now, recoverySlot: true, getStatusHistory: assert.fail })
      .candidates,
    [],
  );
});

test('recovery comparison uses one history capture and performs only read calls even with dry_run=false', () => {
  const pending = status('pending');
  const argsSeen = [];
  const lines = [];
  const result = call({
    schedule: recovery,
    dryRun: false,
    log: (line) => lines.push(line),
    execGh(command, args, options) {
      assert.equal(command, 'gh');
      argsSeen.push(args.slice(0, 4));
      assert.ok(options.maxBuffer > 0 && options.timeout > 0);
      if (args[1] === 'graphql') {
        assert.match(args[3], /^query=\s*query OpenPrFlow/);
        assert.doesNotMatch(args[3], /\bmutation\b/);
        return JSON.stringify(page([node(1, [pending]), node(2, [pending])]));
      }
      assert.deepEqual(args.slice(0, 3), ['api', '--method', 'GET']);
      if (args[3] === `repos/org/repo/commits/${head}/statuses?per_page=100`)
        return JSON.stringify(Array(8).fill(pending));
      assert.equal(args[3], `repos/org/repo/commits/${head}/status`);
      return JSON.stringify({ statuses: [pending] });
    },
  });
  assert.equal(argsSeen.length, 3);
  assert.equal(result.restReads, 2);
  assert.deepEqual(result.comparison.differences, []);
  assert.deepEqual(result.comparison.unknown, []);
  assert.match(lines[1], /would wake PR #1 because ready-pending-loop/);
  assert.match(lines.at(-2), /"scope":"status-evidence-only"/);
});

test('retries transient REST errors once per endpoint and shares the result across the comparison', () => {
  const pending = status('pending');
  const attempts = new Map();
  const result = call({
    schedule: recovery,
    runGraphql: () => page([node(1, [pending]), node(2, [pending])]),
    execGh(_command, args) {
      const endpoint = args[3];
      const count = (attempts.get(endpoint) ?? 0) + 1;
      attempts.set(endpoint, count);
      if (count === 1) throw new Error('HTTP 503');
      return JSON.stringify(
        endpoint.endsWith('/status')
          ? { statuses: [pending] }
          : Array(8).fill(pending),
      );
    },
  });
  assert.deepEqual([...attempts.values()], [2, 2]);
  assert.equal(result.restReads, 4);
  assert.deepEqual(result.comparison.unknown, []);
  assert.deepEqual(result.comparison.differences, []);
});

test('stops REST reads when throttled and caches the unavailable result', () => {
  const pending = status('pending');
  const result = call({
    schedule: recovery,
    runGraphql: () => page([node(1, [pending]), node(2, [pending])]),
    execGh() {
      throw new Error('HTTP 429');
    },
  });
  assert.equal(result.restReads, 1);
  assert.equal(result.restThrottled, true);
  assert.deepEqual(result.comparison.unknown, [1, 2]);
});

test('reports real comparator differences and keeps unavailable history distinct from empty', () => {
  const pending = status('pending');
  const success = status('success');
  const common = {
    schedule: recovery,
    runGraphql: () => page([node(1, [pending])]),
  };
  const lines = [];
  const result = call({
    ...common,
    triggerEvent: 'schedule',
    log: (line) => lines.push(line),
    execGh: (_command, args) =>
      JSON.stringify(
        args[3].endsWith('/status') ? { statuses: [success] } : [],
      ),
  });
  assert.deepEqual(result.comparison.differences, [
    { number: 1, head, shadow: ['stale-ready-pending'], watchdog: [] },
  ]);
  const summary = JSON.parse(
    lines.at(-1).slice('SHADOW_SWEEP_SUMMARY '.length),
  );
  assert.equal(summary.triggerEvent, 'schedule');
  assert.deepEqual(summary.comparisonDiffs, {
    count: 1,
    entries: result.comparison.differences,
    truncated: false,
  });
  const unknown = call({
    ...common,
    execGh: () => {
      throw new Error('HTTP 403');
    },
  });
  assert.deepEqual(unknown.unknown, [{ number: 1, evidence: ['history'] }]);
  assert.deepEqual(unknown.comparison.unknown, [1]);
  assert.deepEqual(unknown.comparison.differences, []);
});

test('caps summary differences and retains the full structured comparison', () => {
  const pending = status('pending');
  const lines = [];
  call({
    schedule: recovery,
    runGraphql: () =>
      page([1, 2, 3, 4, 5, 6].map((number) => node(number, [pending]))),
    log: (line) => lines.push(line),
    execGh: (_command, args) =>
      JSON.stringify(
        args[3].endsWith('/status') ? { statuses: [status('success')] } : [],
      ),
  });

  const full = JSON.parse(lines.at(-2).slice('PR flow shadow '.length));
  assert.deepEqual(
    full.comparison.differences.map(({ number }) => number),
    [1, 2, 3, 4, 5, 6],
  );
  const summary = JSON.parse(
    lines.at(-1).slice('SHADOW_SWEEP_SUMMARY '.length),
  );
  assert.deepEqual(summary.comparisonDiffs, {
    count: 6,
    entries: full.comparison.differences.slice(0, 5),
    truncated: true,
  });
});
