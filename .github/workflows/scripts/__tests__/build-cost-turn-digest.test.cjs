/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  BUDGET_PRESSURE_RATIO,
  DIGEST_LABELS,
  DIGEST_TITLE_PREFIX,
  ISSUE_SEARCH_MARKER,
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

// Fake `gh` runner: first route whose regex matches the joined argv answers.
function createFakeGh(routes) {
  const calls = [];
  const runGh = (args, options = {}) => {
    const key = args.join(' ');
    calls.push(key);
    const route = routes.find(([pattern]) => pattern.test(key));
    // Only an issue carrying the digest marker may be edited; writes succeed.
    if (!route && /^issue view 77 /.test(key)) {
      return '<!-- weekly-cost-turn-digest -->';
    }
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
  assert.equal(ISSUE_SEARCH_MARKER, 'Weekly Cost/Turn Digest in:title');
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

test('windowBounds spans the requested days', () => {
  const now = new Date('2026-11-22T17:00:00.000Z');
  const bounds = windowBounds(7, now);
  assert.equal(bounds.since, '2026-11-15T17:00:00.000Z');
  assert.equal(bounds.until, '2026-11-22T17:00:00.000Z');
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

test('isNotFound recognises purged logs only', () => {
  assert.equal(isNotFound(new Error('gh: Not Found (HTTP 404)')), true);
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

test('collectDigestData separates missing metrics from failed fetches', () => {
  let id = 0;
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
  assert.equal(id, 0);
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
  assert.match(body, /## Weekly Cost\/Turn Digest — WINDOW/);
  assert.match(body, /\| Estimated weekly cost \| \$30\.00 \|/);
  assert.match(body, /\| Workflow runs sampled \| 4 \(10%\) \|/);
  assert.match(body, /\| `b\.yml` \| 40 \| 4 \| 5 \| \$3\.00 \|/);
  assert.match(body, /1 workflow\(s\) had no completed runs: `a\.yml`/);
  assert.match(body, /2 job log\(s\) held no agent metrics/);
  assert.match(body, /1 API call\(s\) failed; this digest is partial/);
});

test('upsertDigestIssue edits the open digest or creates a labelled one', () => {
  const existing = createFakeGh([
    [/^issue list .*--search Weekly Cost\/Turn Digest in:title/, '77\n'],
  ]);
  assert.deepEqual(
    upsertDigestIssue({ repo: 'o/r', title: 'T', body: 'B' }, existing.runGh),
    { action: 'updated', number: 77 },
  );
  assert.match(existing.calls.at(-1), /^issue edit 77 .*--title T --body B$/);

  const fresh = createFakeGh([[/^issue list /, '']]);
  assert.deepEqual(
    upsertDigestIssue({ repo: 'o/r', title: 'T', body: 'B' }, fresh.runGh),
    { action: 'created', number: null },
  );
  assert.match(
    fresh.calls.at(-1),
    /^issue create --repo o\/r --title T --body B --label auto-fix,observability$/,
  );
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
