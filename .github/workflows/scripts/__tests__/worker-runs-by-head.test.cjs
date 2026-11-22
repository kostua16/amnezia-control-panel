/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createWorkerRunsLoader,
  fetchDispatchRuns,
  fetchRunsForHead,
  groupWorkerRuns,
  resolveWorkerRunsSource,
} = require('../lib/worker-runs-by-head.cjs');
const { summarizeWorkerRuns } = require('../orchestrate-pr-flow.cjs');

const HEAD = 'a'.repeat(40);
const BASE_TIP = 'b'.repeat(40);

const config = {
  workers: {
    codeReview: { workflow: 'code-review.yml' },
    antigravityCodeReview: { workflow: 'antigravity-code-review.yml' },
    dependencyReview: { workflow: 'dependency-review.yml' },
    kiloReview: { required: false, external: true },
  },
};

function restRun(overrides = {}) {
  return {
    id: 1,
    path: '.github/workflows/code-review.yml',
    head_sha: HEAD,
    display_title: `PR #7 @ ${HEAD}`,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-07-01T09:05:00Z',
    html_url: 'https://example.test/runs/1',
    ...overrides,
  };
}

function page(runs, total = runs.length) {
  return { runs, total };
}

function makeLoader(overrides = {}) {
  const calls = { head: 0, dispatch: 0, legacy: [], warnings: [] };
  const loader = createWorkerRunsLoader({
    config,
    pr: { number: 7, headSha: HEAD, isCrossRepository: false },
    getRepo: () => 'owner/repo',
    run: () => '',
    source: 'head',
    loadLegacy: (workerName) => {
      calls.legacy.push(workerName);
      return [{ databaseId: 'legacy', workerName }];
    },
    fetchHead: () => {
      calls.head += 1;
      return page([restRun()]);
    },
    fetchDispatch: () => {
      calls.dispatch += 1;
      return page([]);
    },
    warn: (message) => calls.warnings.push(message),
    ...overrides,
  });
  return { loader, calls };
}

test('resolveWorkerRunsSource defaults to head and honours the legacy rollback value', () => {
  const warnings = [];
  const warn = (message) => warnings.push(message);

  assert.equal(resolveWorkerRunsSource(undefined, warn), 'head');
  assert.equal(resolveWorkerRunsSource('', warn), 'head');
  assert.equal(resolveWorkerRunsSource('  HEAD ', warn), 'head');
  assert.equal(resolveWorkerRunsSource('legacy', warn), 'legacy');
  assert.equal(resolveWorkerRunsSource('Legacy', warn), 'legacy');
  assert.deepEqual(warnings, []);
});

test('resolveWorkerRunsSource treats an unknown value as legacy and warns once', () => {
  // A typo must never silently enable the newer lookup.
  const warnings = [];
  assert.equal(
    resolveWorkerRunsSource('heaad', (message) => warnings.push(message)),
    'legacy',
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unknown PR_FLOW_WORKER_RUNS_SOURCE "heaad"/);
});

test('groupWorkerRuns maps REST fields to the gh run list shape the orchestrator reads', () => {
  const grouped = groupWorkerRuns(
    [
      restRun({
        id: 11,
        status: 'in_progress',
        conclusion: null,
        html_url: 'https://example.test/runs/11',
      }),
    ],
    config,
  );

  assert.deepEqual(grouped.codeReview, [
    {
      databaseId: 11,
      status: 'in_progress',
      // gh run list reports an unfinished run's conclusion as an empty string.
      conclusion: '',
      event: 'workflow_dispatch',
      displayTitle: `PR #7 @ ${HEAD}`,
      createdAt: '2026-07-01T09:00:00Z',
      updatedAt: '2026-07-01T09:05:00Z',
      url: 'https://example.test/runs/11',
    },
  ]);
});

test('groupWorkerRuns never lets code-review.yml collide with antigravity-code-review.yml', () => {
  const grouped = groupWorkerRuns(
    [
      restRun({ id: 1, path: '.github/workflows/code-review.yml' }),
      restRun({ id: 2, path: '.github/workflows/antigravity-code-review.yml' }),
      restRun({ id: 3, path: '.github/workflows/deepseek-code-review.yml' }),
    ],
    config,
  );

  assert.deepEqual(
    grouped.codeReview.map((r) => r.databaseId),
    [1],
  );
  assert.deepEqual(
    grouped.antigravityCodeReview.map((r) => r.databaseId),
    [2],
  );
});

test('groupWorkerRuns strips an @ref suffix from the workflow path', () => {
  const grouped = groupWorkerRuns(
    [
      restRun({
        id: 5,
        path: '.github/workflows/dependency-review.yml@refs/heads/main',
      }),
    ],
    config,
  );

  assert.deepEqual(
    grouped.dependencyReview.map((r) => r.databaseId),
    [5],
  );
});

test('groupWorkerRuns dedupes runs seen by both reads and leaves workflow-less workers empty', () => {
  const duplicate = restRun({ id: 9 });
  const grouped = groupWorkerRuns([duplicate, { ...duplicate }], config);

  assert.equal(grouped.codeReview.length, 1);
  assert.deepEqual(grouped.kiloReview, []);
  assert.deepEqual(grouped.antigravityCodeReview, []);
});

test('fetchRunsForHead reads one page of the head trimmed server-side', () => {
  const calls = [];
  const result = fetchRunsForHead({
    repo: 'owner/repo',
    headSha: HEAD,
    run: (command, args, options) => {
      calls.push({ command, args, options });
      return JSON.stringify({ total_count: 1, workflow_runs: [restRun()] });
    },
  });

  assert.equal(result.total, 1);
  assert.equal(result.runs.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'gh');
  assert.equal(
    calls[0].args[1],
    `repos/owner/repo/actions/runs?head_sha=${HEAD}&per_page=100`,
  );
  // Without --jq a 100-run page is ~1 MB and overflows the execFileSync buffer.
  assert.equal(calls[0].args[2], '--jq');
  assert.match(calls[0].args[3], /display_title/);
  assert.equal(calls[0].options.retry, true);
});

test('fetchDispatchRuns reads the recent workflow_dispatch runs', () => {
  const calls = [];
  fetchDispatchRuns({
    repo: 'owner/repo',
    run: (command, args) => {
      calls.push(args);
      return JSON.stringify({ total_count: 400, workflow_runs: [] });
    },
  });

  assert.equal(
    calls[0][1],
    'repos/owner/repo/actions/runs?event=workflow_dispatch&per_page=100',
  );
});

test('fetchRunsForHead rejects an unexpected response shape', () => {
  for (const body of [
    '{}',
    '{"total_count":1}',
    '{"workflow_runs":[]}',
    '[]',
  ]) {
    assert.throws(
      () =>
        fetchRunsForHead({
          repo: 'owner/repo',
          headSha: HEAD,
          run: () => body,
        }),
      /unexpected workflow runs response shape/,
    );
  }
});

test('loader serves every worker from one head read and one dispatch read', () => {
  const { loader, calls } = makeLoader();

  assert.deepEqual(
    loader('codeReview').map((r) => r.databaseId),
    [1],
  );
  assert.deepEqual(loader('dependencyReview'), []);
  assert.deepEqual(loader('kiloReview'), []);
  assert.deepEqual(loader('notConfigured'), []);

  assert.equal(calls.head, 1);
  assert.equal(calls.dispatch, 1);
  assert.deepEqual(calls.legacy, []);
  assert.deepEqual(calls.warnings, []);
});

test('loader finds a base-ref dispatched run through the dispatch read', () => {
  // Dispatched on the base branch, so head_sha is the base tip; only the title
  // carries the PR number and head sha.
  const baseRefRun = restRun({
    id: 77,
    head_sha: BASE_TIP,
    display_title: `PR #7 @ ${HEAD}`,
    created_at: '2026-07-01T10:00:00Z',
  });
  const { loader } = makeLoader({
    fetchHead: () => page([restRun({ id: 1 })]),
    fetchDispatch: () => page([baseRefRun, restRun({ id: 1 })]),
  });

  const runs = loader('codeReview');
  assert.deepEqual(runs.map((r) => r.databaseId).sort(), [1, 77]);
  const summary = summarizeWorkerRuns({ codeReview: runs }, 'codeReview', {
    number: 7,
    headSha: HEAD,
  });
  assert.equal(summary.latest.databaseId, 77);
});

test('loader keeps unrelated runs out of a worker once the title filter applies', () => {
  const { loader } = makeLoader({
    fetchDispatch: () =>
      page([
        restRun({
          id: 60,
          head_sha: BASE_TIP,
          display_title: `PR #8 @ ${'c'.repeat(40)}`,
        }),
      ]),
  });

  const summary = summarizeWorkerRuns(
    { codeReview: loader('codeReview') },
    'codeReview',
    { number: 7, headSha: HEAD },
  );
  assert.equal(summary.latest.databaseId, 1);
  assert.equal(summary.failedCount, 0);
});

test('loader falls back to the per-workflow lookup for a cross-repository PR', () => {
  const { loader, calls } = makeLoader({
    pr: { number: 7, headSha: HEAD, isCrossRepository: true },
  });

  assert.deepEqual(loader('codeReview'), [
    { databaseId: 'legacy', workerName: 'codeReview' },
  ]);
  loader('dependencyReview');

  assert.deepEqual(calls.legacy, ['codeReview', 'dependencyReview']);
  assert.equal(calls.head, 0);
  assert.equal(calls.dispatch, 0);
  // An expected fallback is not a problem worth a warning.
  assert.deepEqual(calls.warnings, []);
});

test('loader falls back when the head has more runs than one page returned', () => {
  const { loader, calls } = makeLoader({
    fetchHead: () => {
      calls.head += 1;
      return page([restRun()], 150);
    },
  });

  assert.equal(loader('codeReview')[0].databaseId, 'legacy');
  loader('finalizer');

  assert.deepEqual(calls.legacy, ['codeReview', 'finalizer']);
  assert.equal(calls.dispatch, 0);
  assert.equal(calls.warnings.length, 1);
  assert.match(calls.warnings[0], /exceed one page/);
});

test('loader falls back with exactly one warning when the head read throws', () => {
  const { loader, calls } = makeLoader({
    fetchHead: () => {
      throw new Error('HTTP 502');
    },
  });

  loader('codeReview');
  loader('antigravityCodeReview');
  loader('dependencyReview');

  assert.deepEqual(calls.legacy, [
    'codeReview',
    'antigravityCodeReview',
    'dependencyReview',
  ]);
  assert.equal(calls.warnings.length, 1);
  assert.match(calls.warnings[0], /HTTP 502/);
});

test('loader falls back when the dispatch read throws, not just the head read', () => {
  const { loader, calls } = makeLoader({
    fetchDispatch: () => {
      throw new Error('rate limited');
    },
  });

  assert.equal(loader('codeReview')[0].databaseId, 'legacy');
  assert.equal(calls.warnings.length, 1);
  assert.match(calls.warnings[0], /rate limited/);
});

test('loader falls back when a read returns a malformed payload', () => {
  const { loader, calls } = makeLoader({
    fetchHead: undefined,
    run: () => '{"unexpected":true}',
  });

  assert.equal(loader('codeReview')[0].databaseId, 'legacy');
  assert.equal(calls.warnings.length, 1);
  assert.match(calls.warnings[0], /unexpected workflow runs response shape/);
});

test('loader falls back when the repository slug cannot be resolved', () => {
  const { loader, calls } = makeLoader({
    getRepo: () => {
      throw new Error('GITHUB_REPOSITORY must be set to owner/repo.');
    },
  });

  assert.equal(loader('codeReview')[0].databaseId, 'legacy');
  assert.equal(calls.warnings.length, 1);
});

test('loader falls back without reading when the head sha is missing', () => {
  const { loader, calls } = makeLoader({
    pr: { number: 7, headSha: '', isCrossRepository: false },
  });

  assert.equal(loader('codeReview')[0].databaseId, 'legacy');
  assert.equal(calls.head, 0);
});

test('loader uses the per-workflow lookup for the legacy rollback value and any unknown value', () => {
  for (const source of ['legacy', 'bogus']) {
    const { loader, calls } = makeLoader({ source });

    assert.equal(loader('codeReview')[0].databaseId, 'legacy');
    assert.equal(calls.head, 0);
    assert.equal(calls.dispatch, 0);
    assert.deepEqual(calls.warnings, []);
  }
});
