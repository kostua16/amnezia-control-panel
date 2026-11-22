/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  BUDGET_PRESSURE_RATIO,
  assertAgentMetricsExtracted,
  DIGEST_LABELS,
  DIGEST_TITLE_PREFIX,
  ISSUE_SEARCH_MARKER,
  ISSUE_SEARCH_PAGE_SIZE,
  buildBudgetNotes,
  claudeActionNames,
  collectDigestData,
  extractJobMetrics,
  findClaudeWorkflows,
  isNotFound,
  parseArgs,
  parseMaxTurns,
  queryWorkflowRuns,
  renderDigestBody,
  tailBytes,
  upsertDigestIssue,
  windowBounds,
} = require('../build-cost-turn-digest.cjs');

const TS = '2026-11-22T08:50:00.0000000Z ';

function claudeLog({ turns, cost, isError = false, model = 'glm-5-turbo' }) {
  return [
    `${TS}"type": "system",`,
    `${TS}"model": "${model}",`,
    `${TS}"type": "result",`,
    `${TS}"is_error": ${isError},`,
    `${TS}"num_turns": ${turns},`,
    `${TS}"total_cost_usd": ${cost},`,
    `${TS}"duration_ms": 216800,`,
  ].join('\n');
}

// `gh api --jq` answers with JSON lines, the shape parseGhJsonLines expects.
const jsonl = (items) => items.map((item) => JSON.stringify(item)).join('\n');

// Fake `gh` runner: first route whose regex matches the joined argv answers.
function createFakeGh(routes) {
  const calls = [];
  const runGh = (args, options = {}) => {
    const key = args.join(' ');
    calls.push(key);
    const route = routes.find(([pattern]) => pattern.test(key));
    // Writes succeed; reads must be routed explicitly.
    if (!route && /^issue (edit|create) /.test(key)) return '';
    if (!route) {
      if (options.allowFailure) return null;
      throw new Error(`Unexpected gh call: ${key}`);
    }
    const respond = route[1];
    return typeof respond === 'function' ? respond(options) : respond;
  };
  return { runGh, calls };
}

function createFixtureDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-digest-'));
  const workflowsDir = path.join(root, 'workflows');
  const actionsDir = path.join(root, 'actions');
  fs.mkdirSync(workflowsDir);
  fs.mkdirSync(path.join(actionsDir, 'agent-wrapper'), { recursive: true });
  fs.mkdirSync(path.join(actionsDir, 'log-rate-limit'), { recursive: true });
  fs.writeFileSync(
    path.join(workflowsDir, 'fix-issue.yml'),
    [
      "name: 'Fix Issue'",
      'env:',
      '  MAX_TURNS: 25',
      'jobs:',
      '  fix:',
      '    steps:',
      '      - uses: ./.github/actions/run-zai',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(workflowsDir, 'wrapped.yml'),
    [
      'name: Wrapped',
      'jobs:',
      '  run:',
      '    steps:',
      '      - uses: ./.github/actions/agent-wrapper',
      '        with:',
      "          max-turns: '40'",
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(workflowsDir, 'plain.yml'),
    [
      'name: Plain',
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: ./.github/actions/log-rate-limit',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(actionsDir, 'agent-wrapper', 'action.yml'),
    "runs:\n  using: 'composite'\n  steps:\n    - uses: ./.github/actions/run-claude\n",
  );
  fs.writeFileSync(
    path.join(actionsDir, 'log-rate-limit', 'action.yml'),
    "runs:\n  using: 'composite'\n  steps:\n    - run: echo hi\n",
  );
  return { root, workflowsDir, actionsDir };
}

const fixture = createFixtureDir();

test('digest constants are stable', () => {
  assert.equal(DIGEST_TITLE_PREFIX, 'Weekly Cost/Turn Digest');
  assert.deepEqual(DIGEST_LABELS, ['auto-fix', 'observability']);
  assert.equal(ISSUE_SEARCH_MARKER, '"weekly-cost-turn-digest" in:body');
});

test('parseArgs reads flags and values', () => {
  const args = parseArgs([
    'node',
    'script',
    '--repo',
    'owner/repo',
    '--window-days',
    '3',
    '--dry-run',
    '--github-output',
    '/tmp/out',
  ]);
  assert.equal(args.repo, 'owner/repo');
  assert.equal(args['window-days'], '3');
  assert.equal(args['dry-run'], 'true');
  assert.equal(args['github-output'], '/tmp/out');
});

test('parseArgs splits --key=value and rejects valueless value flags', () => {
  const args = parseArgs([
    'node',
    'script',
    '--window-days=14',
    '--max-runs=5',
  ]);
  assert.equal(args['window-days'], '14');
  assert.equal(args['max-runs'], '5');
  assert.throws(
    () => parseArgs(['node', 'script', '--github-output']),
    /--github-output requires a value/,
  );
  // Boolean flags are presence-based and never swallow a stray token.
  const bools = parseArgs(['node', 'script', '--dry-run', 'stray']);
  assert.equal(bools['dry-run'], 'true');
  assert.equal(bools.stray, undefined);
});

test('windowBounds spans the requested days at second precision', () => {
  const now = new Date('2026-11-22T17:00:00.000Z');
  const bounds = windowBounds(7, now);
  assert.equal(bounds.since, '2026-11-15T17:00:00Z');
  assert.equal(bounds.until, '2026-11-22T17:00:00Z');
});

test('tailBytes keeps the tail and drops a cut first line', () => {
  assert.equal(tailBytes('short', 100), 'short');
  const tail = tailBytes('line-one\nline-two\nline-three', 18);
  assert.equal(tail, 'line-three');
});

test('extractJobMetrics reads cost, turns, error and model', () => {
  const record = extractJobMetrics(
    claudeLog({ turns: 33, cost: 2.8986, isError: true }),
  );
  assert.deepEqual(record, {
    costUsd: 2.8986,
    turns: 33,
    isError: true,
    model: 'glm-5-turbo',
  });
  assert.equal(extractJobMetrics('no agent output here'), null);
});

test('extractJobMetrics keeps turns-only records with unknown cost', () => {
  // Turns without an SDK cost are agent runs with unknown cost — not free
  // runs, and not a broken extraction either.
  assert.deepEqual(extractJobMetrics(claudeLog({ turns: 9, cost: null })), {
    costUsd: null,
    turns: 9,
    isError: false,
    model: 'glm-5-turbo',
  });
  // Without turns the record is not a usable agent result at all.
  assert.equal(extractJobMetrics(claudeLog({ turns: null, cost: 1 })), null);
});

test('extractJobMetrics reads compact single-line result records', () => {
  // stream-json/JSONL output keeps the whole result record on one line.
  const log = [
    '{"type":"system","model":"glm-5-turbo"}',
    '{"type":"result","is_error":false,"num_turns":9,"total_cost_usd":0.01}',
  ].join('\n');
  assert.deepEqual(extractJobMetrics(log), {
    costUsd: 0.01,
    turns: 9,
    isError: false,
    model: 'glm-5-turbo',
  });
  // The model may sit on the anchor line itself, before the result type.
  const inline =
    '{"model":"glm-5-turbo","type":"result","num_turns":4,"total_cost_usd":0.2}';
  assert.deepEqual(extractJobMetrics(inline), {
    costUsd: 0.2,
    turns: 4,
    isError: false,
    model: 'glm-5-turbo',
  });
  // JSON key order is not guaranteed: metrics may precede the type key and
  // the model may follow it on the same compact line.
  const reordered =
    '{"num_turns":9,"total_cost_usd":0.01,"type":"result","is_error":true,"model":"glm-5-turbo"}';
  assert.deepEqual(extractJobMetrics(reordered), {
    costUsd: 0.01,
    turns: 9,
    isError: true,
    model: 'glm-5-turbo',
  });
});

test('extractJobMetrics reads the last result block of retried jobs', () => {
  const log = [
    claudeLog({ turns: 5, cost: 1, isError: true }),
    claudeLog({ turns: 9, cost: 2, isError: false }),
  ].join('\n');
  assert.deepEqual(extractJobMetrics(log), {
    costUsd: 2,
    turns: 9,
    isError: false,
    model: 'glm-5-turbo',
  });
});

test('claudeActionNames grows through wrapping composite actions', () => {
  const names = claudeActionNames([
    { name: 'agent-wrapper', content: 'uses: ./.github/actions/run-claude' },
    { name: 'outer', content: 'uses: ./.github/actions/agent-wrapper' },
    { name: 'other', content: 'uses: ./.github/actions/unknown' },
  ]);
  assert.ok(names.has('agent-wrapper'));
  assert.ok(names.has('outer'));
  assert.ok(!names.has('other'));
});

test('parseMaxTurns reads env and action-input forms', () => {
  assert.equal(parseMaxTurns('env:\n  MAX_TURNS: 25\n'), 25);
  assert.equal(parseMaxTurns("with:\n  max-turns: '40'\n"), 40);
  assert.equal(parseMaxTurns('max-turns: ${{ env.MAX_TURNS }}'), null);
  // The step input wins over a bare env MAX_TURNS, resolving env refs.
  assert.equal(
    parseMaxTurns(
      [
        'env:',
        '  MAX_TURNS: 30',
        '  MAX_REVIEW_TURNS: 80',
        'jobs:',
        '  review:',
        '    with:',
        '      max-turns: ${{ env.MAX_REVIEW_TURNS }}',
      ].join('\n'),
    ),
    80,
  );
  // Conflicting per-step budgets are unknown, not a guess.
  assert.equal(
    parseMaxTurns("steps:\n  - max-turns: '20'\n  - max-turns: '40'\n"),
    null,
  );
});

test('findClaudeWorkflows detects direct and wrapped agent use', () => {
  const read = (dir, name) => ({
    name,
    content: fs.readFileSync(path.join(dir, name), 'utf8'),
  });
  const workflows = findClaudeWorkflows(
    [
      read(fixture.workflowsDir, 'fix-issue.yml'),
      read(fixture.workflowsDir, 'plain.yml'),
      read(fixture.workflowsDir, 'wrapped.yml'),
    ],
    [
      {
        name: 'agent-wrapper',
        content: fs.readFileSync(
          path.join(fixture.actionsDir, 'agent-wrapper', 'action.yml'),
          'utf8',
        ),
      },
    ],
  );
  assert.deepEqual(
    workflows.map((workflow) => workflow.file),
    ['fix-issue.yml', 'wrapped.yml'],
  );
  assert.equal(workflows[0].name, 'Fix Issue');
  assert.equal(workflows[0].maxTurnsBudget, 25);
  assert.equal(workflows[1].maxTurnsBudget, 40);
});

test('findClaudeWorkflows follows reusable workflow callers', () => {
  const read = (name) => ({
    name,
    content: fs.readFileSync(path.join(fixture.workflowsDir, name), 'utf8'),
  });
  const workflows = findClaudeWorkflows(
    [
      read('plain.yml'),
      read('wrapped.yml'),
      {
        name: 'fix-pr-like.yml',
        content: [
          'jobs:',
          '  auto-fix:',
          '    uses: ./.github/workflows/wrapped.yml',
          '',
        ].join('\n'),
      },
    ],
    [
      {
        name: 'agent-wrapper',
        content: fs.readFileSync(
          path.join(fixture.actionsDir, 'agent-wrapper', 'action.yml'),
          'utf8',
        ),
      },
    ],
  );
  assert.deepEqual(
    workflows.map((workflow) => workflow.file),
    ['fix-pr-like.yml', 'wrapped.yml'],
  );
  // The caller has no budget of its own; it inherits the callee's.
  assert.equal(workflows[0].maxTurnsBudget, 40);
});

test('queryWorkflowRuns uses GET, the window and completed status', () => {
  const { runGh, calls } = createFakeGh([
    [
      /^api -X GET repos\/o\/r\/actions\/workflows\/fix-issue\.yml\/runs .*per_page=1 --jq \.total_count$/,
      '3',
    ],
    [
      /^api -X GET repos\/o\/r\/actions\/workflows\/fix-issue\.yml\/runs .*per_page=2 --jq/,
      '{"id":1}\n{"id":2}\n',
    ],
  ]);
  const runs = queryWorkflowRuns(
    { repo: 'o/r', file: 'fix-issue.yml', since: 'A', until: 'B', limit: 2 },
    runGh,
  );
  assert.equal(runs.total, 3);
  assert.deepEqual(runs.items, [{ id: 1 }, { id: 2 }]);
  assert.ok(calls[0].includes('-f created=A..B -f status=completed'));
});

test('queryWorkflowRuns throws when the run count is unreadable', () => {
  const { runGh } = createFakeGh([[/\.total_count$/, '']]);
  assert.throws(
    () =>
      queryWorkflowRuns(
        { repo: 'o/r', file: 'x.yml', since: 'A', until: 'B', limit: 2 },
        runGh,
      ),
    /Could not read completed run count/,
  );
});

test('isNotFound recognises purged and expired logs only', () => {
  assert.equal(isNotFound(new Error('gh: Not Found (HTTP 404)')), true);
  assert.equal(isNotFound(new Error('gh: Gone (HTTP 410)')), true);
  assert.equal(isNotFound(new Error('HTTP 502 Bad Gateway')), false);
});

test('collectDigestData samples every workflow and aggregates metrics', () => {
  const { runGh, calls } = createFakeGh([
    [/workflows\/fix-issue\.yml\/runs .*per_page=1 /, '3'],
    [/workflows\/fix-issue\.yml\/runs .*per_page=2 /, '{"id":1}\n{"id":2}\n'],
    [/workflows\/wrapped\.yml\/runs .*per_page=1 /, '0'],
    [
      /^api -X GET repos\/o\/r\/actions\/runs\/1\/jobs/,
      '{"id":11,"conclusion":"success"}\n{"id":12,"conclusion":"skipped"}\n',
    ],
    [
      /^api -X GET repos\/o\/r\/actions\/runs\/2\/jobs/,
      '{"id":21,"conclusion":"failure"}\n',
    ],
    [
      /^api repos\/o\/r\/actions\/jobs\/11\/logs$/,
      claudeLog({ turns: 10, cost: 1 }),
    ],
    [
      /^api repos\/o\/r\/actions\/jobs\/21\/logs$/,
      claudeLog({ turns: 5, cost: 0.5, isError: true }),
    ],
  ]);
  const data = collectDigestData({
    repo: 'o/r',
    since: 'A',
    until: 'B',
    maxRuns: 4,
    workflowsDir: fixture.workflowsDir,
    actionsDir: fixture.actionsDir,
    runGhFn: runGh,
  });
  assert.equal(data.totals.totalRuns, 3);
  assert.equal(data.totals.sampledRuns, 2);
  assert.equal(data.totals.agentJobs, 2);
  assert.equal(data.totals.costUsd, 1.5);
  assert.equal(data.totals.turns, 15);
  assert.equal(data.totals.errors, 1);
  assert.equal(data.totals.missingJobs, 0);
  assert.equal(data.totals.estCostUsd, 2.25);
  const fixIssue = data.rows.find((row) => row.file === 'fix-issue.yml');
  assert.equal(fixIssue.totalRuns, 3);
  assert.equal(fixIssue.sampledRuns, 2);
  assert.equal(fixIssue.maxTurns, 10);
  assert.equal(fixIssue.avgTurnsPerRun, 7.5);
  assert.equal(fixIssue.estCostUsd, 2.25);
  // Skipped jobs are never downloaded; wrapped.yml has no runs to sample.
  assert.ok(!calls.some((call) => call.includes('jobs/12/logs')));
  assert.ok(
    !calls.some(
      (call) =>
        call.includes('runs?') === false &&
        /workflows\/wrapped\.yml\/runs .*per_page=2 /.test(call),
    ),
  );
});

test('collectDigestData counts only runs whose logs were read as sampled', () => {
  const { runGh } = createFakeGh([
    [/workflows\/fix-issue\.yml\/runs .*per_page=1 /, '3'],
    [/workflows\/fix-issue\.yml\/runs .*per_page=2 /, '{"id":1}\n{"id":2}\n'],
    [/workflows\/wrapped\.yml\/runs .*per_page=1 /, '0'],
    [
      /^api -X GET repos\/o\/r\/actions\/runs\/1\/jobs/,
      '{"id":11,"conclusion":"success"}\n',
    ],
    [
      /^api -X GET repos\/o\/r\/actions\/runs\/2\/jobs/,
      '{"id":21,"conclusion":"success"}\n',
    ],
    [
      /^api repos\/o\/r\/actions\/jobs\/11\/logs$/,
      claudeLog({ turns: 10, cost: 1 }),
    ],
  ]);
  const data = collectDigestData({
    repo: 'o/r',
    since: 'A',
    until: 'B',
    maxRuns: 4,
    workflowsDir: fixture.workflowsDir,
    actionsDir: fixture.actionsDir,
    runGhFn: runGh,
    maxLogDownloads: 1,
  });
  // Run 2's only log hit the download budget, so the run is not a sample and
  // must not dilute the coverage share or the weekly estimate.
  assert.equal(data.totals.sampledRuns, 1);
  assert.equal(data.totals.cappedLogDownloads, 1);
  assert.equal(data.totals.costUsd, 1);
  assert.equal(data.totals.estCostUsd, 3);
  const fixIssue = data.rows.find((row) => row.file === 'fix-issue.yml');
  assert.equal(fixIssue.sampledRuns, 1);
  assert.equal(fixIssue.estCostUsd, 3);
});

test('assertAgentMetricsExtracted fails only on a metrics-free digest', () => {
  // An honestly empty week publishes an empty digest.
  assertAgentMetricsExtracted({ totalRuns: 0, sampledRuns: 0, agentJobs: 0 });
  // A provider that reports no cost still produced agent runs.
  assertAgentMetricsExtracted({
    totalRuns: 5,
    sampledRuns: 5,
    agentJobs: 4,
    costUsd: 0,
    noCostJobs: 4,
  });
  assert.throws(
    () =>
      assertAgentMetricsExtracted({
        totalRuns: 5,
        sampledRuns: 5,
        agentJobs: 0,
        costUsd: 0,
      }),
    /No agent metrics extracted/,
  );
});

test('collectDigestData separates missing metrics from failed fetches', () => {
  const { runGh } = createFakeGh([
    [/workflows\/fix-issue\.yml\/runs .*per_page=1 /, '2'],
    [/workflows\/fix-issue\.yml\/runs .*per_page=2 /, '{"id":1}\n{"id":2}\n'],
    [/workflows\/wrapped\.yml\/runs .*per_page=1 /, '0'],
    [
      /^api -X GET repos\/o\/r\/actions\/runs\/1\/jobs/,
      '{"id":11,"conclusion":"success"}\n{"id":12,"conclusion":"success"}\n{"id":13,"conclusion":"success"}\n',
    ],
    [/^api -X GET repos\/o\/r\/actions\/runs\/2\/jobs/, () => 'unlisted'],
    [/^api repos\/o\/r\/actions\/jobs\/11\/logs$/, 'no agent metrics'],
    [
      /^api repos\/o\/r\/actions\/jobs\/12\/logs$/,
      (options) => {
        options.onError(new Error('HTTP 502 Bad Gateway'));
        return null;
      },
    ],
    [
      /^api repos\/o\/r\/actions\/jobs\/13\/logs$/,
      (options) => {
        options.onError(new Error('gh: Not Found (HTTP 404)'));
        return null;
      },
    ],
  ]);
  const data = collectDigestData({
    repo: 'o/r',
    since: 'A',
    until: 'B',
    maxRuns: 4,
    workflowsDir: fixture.workflowsDir,
    actionsDir: fixture.actionsDir,
    runGhFn: runGh,
  });
  assert.equal(data.totals.missingJobs, 2);
  assert.equal(data.totals.fetchErrors, 1);
});

test('buildBudgetNotes flags turn pressure and costly runs', () => {
  const row = {
    file: 'fix-issue.yml',
    agentJobs: 2,
    avgTurnsPerRun: 22,
    maxTurns: 25,
    maxTurnsBudget: 25,
    avgCostPerRun: 1.2,
  };
  const notes = buildBudgetNotes([
    row,
    {
      ...row,
      file: 'quiet.yml',
      avgTurnsPerRun: 4,
      maxTurns: 9,
      avgCostPerRun: 0.2,
    },
  ]);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /88% of MAX_TURNS \(25\); peak 25 hits the cap/);
  assert.match(notes[1], /exceeds \$1\.00\/run/);
  assert.deepEqual(buildBudgetNotes([{ ...row, agentJobs: 0 }]), []);
  assert.ok(BUDGET_PRESSURE_RATIO > 0 && BUDGET_PRESSURE_RATIO < 1);
});

test('renderDigestBody orders by cost and reports coverage', () => {
  const data = {
    maxRuns: 4,
    workflows: [{ file: 'a.yml' }, { file: 'b.yml' }],
    totals: {
      totalRuns: 40,
      sampledRuns: 4,
      agentJobs: 5,
      costUsd: 3,
      turns: 50,
      errors: 1,
      missingJobs: 2,
      fetchErrors: 1,
      estCostUsd: 30,
      models: { 'glm-5-turbo': 5 },
    },
    rows: [
      {
        file: 'b.yml',
        totalRuns: 40,
        sampledRuns: 4,
        agentJobs: 5,
        costUsd: 3,
        turns: 50,
        errors: 1,
        maxTurns: 9,
        models: {},
        avgCostPerRun: 0.6,
        avgTurnsPerRun: 10,
        costPerTurn: 0.06,
        estCostUsd: 30,
        maxTurnsBudget: 25,
      },
      {
        file: 'a.yml',
        totalRuns: 0,
        sampledRuns: 0,
        agentJobs: 0,
        costUsd: 0,
        turns: 0,
        errors: 0,
        maxTurns: 0,
        models: {},
        avgCostPerRun: null,
        avgTurnsPerRun: null,
        costPerTurn: null,
        estCostUsd: 0,
        maxTurnsBudget: null,
      },
    ],
  };
  const body = renderDigestBody(data, 'WINDOW');
  // The marker is what the upsert search keys on; losing it would silently
  // duplicate the digest issue every week.
  assert.match(body, /<!-- weekly-cost-turn-digest -->/);
  assert.match(body, /## Weekly Cost\/Turn Digest — WINDOW/);
  assert.match(body, /\| Estimated weekly cost \| \$30\.00 \|/);
  assert.match(body, /\| Workflow runs sampled \| 4 \(10%\) \|/);
  assert.match(body, /\| `b\.yml` \| 40 \| 4 \| 5 \| \$3\.00 \|/);
  assert.match(body, /1 workflow\(s\) had no completed runs: `a\.yml`/);
  assert.match(body, /2 job log\(s\) held no agent metrics/);
  assert.match(body, /1 API call\(s\) failed; this digest is partial/);
});

test('renderDigestBody marks a provider that reports no cost', () => {
  const body = renderDigestBody(
    {
      maxRuns: 4,
      workflows: [{ file: 'a.yml' }],
      totals: {
        totalRuns: 3,
        sampledRuns: 2,
        agentJobs: 2,
        costUsd: 0,
        noCostJobs: 2,
        turns: 10,
        errors: 0,
        missingJobs: 0,
        fetchErrors: 0,
        estCostUsd: 0,
        models: { 'glm-5-turbo': 2 },
      },
      rows: [
        {
          file: 'a.yml',
          totalRuns: 3,
          sampledRuns: 2,
          agentJobs: 2,
          costUsd: 0,
          noCostJobs: 2,
          turns: 10,
          errors: 0,
          maxTurns: 5,
          models: {},
          avgCostPerRun: 0,
          avgTurnsPerRun: 5,
          costPerTurn: 0,
          estCostUsd: 0,
          maxTurnsBudget: 25,
        },
      ],
    },
    'WINDOW',
  );
  // Unknown cost must read as unknown, never as a free week.
  assert.match(body, /\| Sampled cost \| not reported by provider \|/);
  assert.match(body, /\| Estimated weekly cost \| not reported by provider \|/);
  assert.match(body, /\| `a\.yml` \| 3 \| 2 \| 2 \| not reported \|/);
  assert.match(body, /No sampled agent run reported `total_cost_usd`/);
  assert.doesNotMatch(body, /\$0\.00/);
});

test('renderDigestBody marks a window with mixed cost coverage', () => {
  // Mixed providers: one agent run reported a cost, one did not. The sums
  // omit the no-cost run, so plain figures would understate the week.
  const body = renderDigestBody(
    {
      maxRuns: 4,
      workflows: [{ file: 'a.yml' }],
      totals: {
        totalRuns: 4,
        sampledRuns: 2,
        agentJobs: 2,
        costUsd: 1,
        noCostJobs: 1,
        turns: 10,
        errors: 0,
        missingJobs: 0,
        fetchErrors: 0,
        estCostUsd: 2,
        models: { 'glm-5-turbo': 2 },
      },
      rows: [
        {
          file: 'a.yml',
          totalRuns: 4,
          sampledRuns: 2,
          agentJobs: 2,
          costUsd: 1,
          noCostJobs: 1,
          turns: 10,
          errors: 0,
          maxTurns: 5,
          models: {},
          avgCostPerRun: 0.5,
          avgTurnsPerRun: 5,
          costPerTurn: 0.1,
          estCostUsd: 2,
          maxTurnsBudget: 25,
        },
      ],
    },
    'WINDOW',
  );
  assert.match(body, /\| Sampled cost \| ≥\$1\.00 \|/);
  assert.match(body, /\| Estimated weekly cost \| ≥\$2\.00 \|/);
  assert.match(body, /\| `a\.yml` \| 4 \| 2 \| 2 \| ≥\$1\.00 \|/);
  assert.match(body, /1 of 2 sampled agent runs reported no `total_cost_usd`/);
  assert.match(body, /this window's figures are lower bounds/);
  // Partial coverage is not the all-unknown case.
  assert.doesNotMatch(body, /not reported by provider/);
  assert.doesNotMatch(body, /not reported \|/);
});

test('upsertDigestIssue edits the open digest or creates a labelled one', () => {
  const existing = createFakeGh([
    [
      /^api -X GET search\/issues/,
      jsonl([{ number: 77, body: '<!-- weekly-cost-turn-digest -->' }]),
    ],
  ]);
  assert.deepEqual(
    upsertDigestIssue({ repo: 'o/r', title: 'T', body: 'B' }, existing.runGh),
    { action: 'updated', number: 77 },
  );
  assert.match(existing.calls.at(-1), /^issue edit 77 .*--title T --body B$/);

  const fresh = createFakeGh([[/^api -X GET search\/issues/, '']]);
  assert.deepEqual(
    upsertDigestIssue({ repo: 'o/r', title: 'T', body: 'B' }, fresh.runGh),
    { action: 'created', number: null },
  );
  assert.match(
    fresh.calls.at(-1),
    /^issue create --repo o\/r --title T --body B --label auto-fix,observability$/,
  );
});

test('upsertDigestIssue never edits a title match without the marker', () => {
  const hijacked = createFakeGh([
    [
      /^api -X GET search\/issues/,
      jsonl([
        { number: 76, body: 'backlog issue that requested the digest' },
        { number: 78, body: '[cost-digest] failure report body' },
      ]),
    ],
  ]);
  assert.deepEqual(
    upsertDigestIssue({ repo: 'o/r', title: 'T', body: 'B' }, hijacked.runGh),
    { action: 'created', number: null },
  );
  assert.ok(!hijacked.calls.some((call) => /^issue edit /.test(call)));
  assert.match(hijacked.calls.at(-1), /^issue create /);
});

test('upsertDigestIssue picks the marker-bearing hit wherever it ranks', () => {
  const mixed = createFakeGh([
    [
      /^api -X GET search\/issues/,
      jsonl([
        { number: 76, body: 'no marker here' },
        { number: 79, body: 'digest body <!-- weekly-cost-turn-digest -->' },
      ]),
    ],
  ]);
  assert.deepEqual(
    upsertDigestIssue({ repo: 'o/r', title: 'T', body: 'B' }, mixed.runGh),
    { action: 'updated', number: 79 },
  );
  assert.match(mixed.calls.at(-1), /^issue edit 79 /);
});

test('upsertDigestIssue scans every search page for the marker', () => {
  // Failure reports token-match the digest title and can fill the whole
  // first page; the marker-bearing digest must still be found behind them.
  const fillers = Array.from(
    { length: ISSUE_SEARCH_PAGE_SIZE },
    (_, index) => ({
      number: 1000 + index,
      body: 'failure report that token-matches the digest title',
    }),
  );
  const paged = createFakeGh([
    [/^api -X GET search\/issues .*page=1 /, jsonl(fillers)],
    [
      /^api -X GET search\/issues .*page=2 /,
      jsonl([{ number: 88, body: 'digest <!-- weekly-cost-turn-digest -->' }]),
    ],
  ]);
  assert.deepEqual(
    upsertDigestIssue({ repo: 'o/r', title: 'T', body: 'B' }, paged.runGh),
    { action: 'updated', number: 88 },
  );
  assert.ok(paged.calls.some((call) => call.includes('page=1 ')));
  assert.ok(paged.calls.some((call) => call.includes('page=2 ')));
  assert.match(paged.calls.at(-1), /^issue edit 88 /);
});

test('upsertDigestIssue refuses to create when the search fails', () => {
  // No route matches; allowFailure turns the failed search into null.
  const failing = createFakeGh([]);
  assert.throws(
    () =>
      upsertDigestIssue({ repo: 'o/r', title: 'T', body: 'B' }, failing.runGh),
    /Could not search for the existing digest issue/,
  );
  assert.ok(!failing.calls.some((call) => /^issue (create|edit) /.test(call)));
});

test('collectDigestData fails loudly when no workflow runs an agent', () => {
  const emptyDir = path.join(fixture.root, 'empty');
  fs.mkdirSync(emptyDir);
  assert.throws(
    () =>
      collectDigestData({
        repo: 'o/r',
        since: 'A',
        until: 'B',
        maxRuns: 4,
        workflowsDir: emptyDir,
        actionsDir: emptyDir,
        runGhFn: createFakeGh([]).runGh,
      }),
    /No Claude-powered workflows found/,
  );
});

test('cost-turn-digest workflow wires the script on a weekly schedule', () => {
  const yaml = fs.readFileSync(
    path.join(__dirname, '..', '..', 'cost-turn-digest.yml'),
    'utf8',
  );
  assert.match(yaml, /cron: '\d+ 6 \* \* 1'/);
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(
    yaml,
    /node \.github\/workflows\/scripts\/build-cost-turn-digest\.cjs/,
  );
});
