/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SCHEMA_VERSION,
  parseArgs,
  capLogText,
  recordKey,
  buildRecord,
  dedupeRecords,
  aggregate,
  fetchCompletedRuns,
  fetchRunJobs,
  collectCostTelemetry,
  renderRecordsJsonl,
  writeGithubOutput,
} = require('../aggregate-run-costs.cjs');

// ── fixtures ──────────────────────────────────────────────────────────

const RUN = {
  id: 1001,
  name: 'Monitor Amnezia Control Panel GitHub Runs',
  event: 'schedule',
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-08-15T09:56:00Z',
  updated_at: '2026-08-15T10:04:00Z',
  run_started_at: '2026-08-15T09:56:30Z',
};

const JOB = {
  id: 555001,
  name: 'Monitor GitHub Actions Runs',
  status: 'completed',
  conclusion: 'success',
  started_at: '2026-08-15T09:56:31Z',
  completed_at: '2026-08-15T10:03:58Z',
  run_attempt: 1,
};

function metricsLog(overrides = {}) {
  return [
    '2026-08-15T10:03:57.0000000Z\tSet up job',
    '2026-08-15T10:03:57.1000000Z\tRunning Claude Code via SDK',
    `2026-08-15T10:03:58.0000000Z\t{"subtype":"success","model":"${
      overrides.model || 'glm-5-turbo'
    }","duration_ms":${overrides.durationMs ?? 191400},"num_turns":${
      overrides.numTurns ?? 39
    },"total_cost_usd":${overrides.totalCostUsd ?? 3.0194},"is_error":false}`,
  ].join('\n');
}

// ── buildRecord: valid / partial / missing / malformed logs ──────────

test('buildRecord extracts a full normalized record from a valid job log', () => {
  const record = buildRecord({
    run: RUN,
    job: JOB,
    logText: metricsLog(),
    maxLogBytes: 512 * 1024,
  });
  assert.deepEqual(record, {
    schema_version: SCHEMA_VERSION,
    run_id: 1001,
    job_id: 555001,
    attempt: 1,
    workflow: 'Monitor Amnezia Control Panel GitHub Runs',
    model: 'glm-5-turbo',
    run_created_at: '2026-08-15T09:56:00Z',
    run_updated_at: '2026-08-15T10:04:00Z',
    job_started_at: '2026-08-15T09:56:31Z',
    job_completed_at: '2026-08-15T10:03:58Z',
    turns: 39,
    cost_usd: 3.0194,
    cost_per_turn: 0.0774,
    duration_sec: 191.4,
    outcome: 'success',
    source: 'job-log',
  });
});

test('buildRecord keeps partial metrics (turns only or cost only)', () => {
  const turnsOnly = buildRecord({
    run: RUN,
    job: JOB,
    logText: metricsLog({ totalCostUsd: 'null' }),
    maxLogBytes: 512 * 1024,
  });
  assert.equal(turnsOnly.turns, 39);
  assert.equal(turnsOnly.cost_usd, null);
  assert.equal(turnsOnly.cost_per_turn, null);

  const costOnly = buildRecord({
    run: RUN,
    job: JOB,
    logText: '{"total_cost_usd":0.42}',
    maxLogBytes: 512 * 1024,
  });
  assert.equal(costOnly.cost_usd, 0.42);
  assert.equal(costOnly.turns, null);
});

test('buildRecord returns null for logs without Claude metrics (missing jobs)', () => {
  const cases = [
    ['empty log', ''],
    ['unrelated job log', '##[group]Run fleet back-pressure gate\nok 1 - gate passed\n'],
    ['garbage non-JSON', 'xxx not json at all\n{"nope": true}\n'],
  ];
  for (const [name, logText] of cases) {
    assert.equal(
      buildRecord({ run: RUN, job: JOB, logText, maxLogBytes: 512 * 1024 }),
      null,
      `expected null for ${name}`,
    );
  }
});

test('buildRecord defaults a missing run_attempt to 1', () => {
  const record = buildRecord({
    run: RUN,
    job: { ...JOB, run_attempt: undefined },
    logText: metricsLog(),
    maxLogBytes: 512 * 1024,
  });
  assert.equal(record.attempt, 1);
});

// ── capLogText ────────────────────────────────────────────────────────

test('capLogText keeps the tail so end-of-log metrics survive the cap', () => {
  const filler = 'x'.repeat(64 * 1024);
  const logText = `${filler}\n${metricsLog()}`;
  const capped = capLogText(logText, 128 * 1024); // no cap triggered
  assert.ok(capped.includes('total_cost_usd'));

  const tight = capLogText(logText, 8 * 1024); // drops filler, keeps tail
  assert.ok(!tight.includes('xxxxxxxx'));
  assert.ok(tight.includes('total_cost_usd'));
  assert.ok(!tight.startsWith('x')); // split first line dropped
});

test('capLogText dropping the metrics region yields a missing job', () => {
  const logText = `${metricsLog()}\n${'y'.repeat(64 * 1024)}`;
  const record = buildRecord({
    run: RUN,
    job: JOB,
    logText,
    maxLogBytes: 8 * 1024, // tail cap keeps only filler
  });
  assert.equal(record, null);
});

// ── fetchCompletedRuns: NDJSON, window, exclusions, caps ─────────────

function runsRunner(pages, calls = []) {
  return (args) => {
    calls.push(args);
    return { ok: true, stdout: pages.join('\n') };
  };
}

test('fetchCompletedRuns parses paginated NDJSON and applies window filters', () => {
  const newer = { ...RUN, id: 1002, run_started_at: '2026-08-15T11:00:00Z' };
  const older = { ...RUN, id: 1000, run_started_at: '2026-08-14T00:00:00Z' };
  const noTimestamp = {
    ...RUN,
    id: 999,
    run_started_at: '',
    updated_at: '',
    created_at: '',
  };
  const calls = [];
  const { runs, errors } = fetchCompletedRuns(
    {
      repo: 'owner/repo',
      workflowFile: 'monitor.yml',
      since: '2026-08-15T00:00:00Z',
      excludeRunId: 1001,
      maxRuns: 10,
      perPage: 100,
    },
    runsRunner(
      [
        JSON.stringify(newer),
        'not json {',
        JSON.stringify(RUN), // excluded: current run id
        JSON.stringify(older), // excluded: before window
        JSON.stringify(noTimestamp), // excluded: no usable timestamp
        '{"id":"weird"}', // excluded: id not a number
      ],
      calls,
    ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(runs.map((r) => r.id), [1002]);
  assert.ok(calls[0].includes('status=completed'));
  assert.ok(calls[0].includes('--paginate'));
});

test('fetchCompletedRuns sorts newest first and caps at maxRuns', () => {
  const entries = [1, 2, 3, 4, 5].map((n) => ({
    ...RUN,
    id: n,
    run_started_at: `2026-08-15T0${n}:00:00Z`,
  }));
  const { runs } = fetchCompletedRuns(
    {
      repo: 'owner/repo',
      workflowFile: 'monitor.yml',
      since: '2026-08-15T00:00:00Z',
      maxRuns: 3,
      perPage: 100,
    },
    runsRunner(entries.map((e) => JSON.stringify(e))),
  );
  assert.deepEqual(runs.map((r) => r.id), [5, 4, 3]);
});

test('fetchRunJobs parses NDJSON and drops malformed job rows', () => {
  const { jobs } = fetchRunJobs(
    { repo: 'owner/repo', runId: 1001, perPage: 100 },
    () => ({
      ok: true,
      stdout: [
        JSON.stringify(JOB),
        '{broken',
        JSON.stringify({ ...JOB, id: 555002, run_attempt: 2 }),
      ].join('\n'),
    }),
  );
  assert.deepEqual(jobs.map((j) => j.id), [555001, 555002]);
});

// ── dedupe ────────────────────────────────────────────────────────────

test('dedupeRecords keeps the last record per run/job/attempt key', () => {
  const base = { run_id: 1, job_id: 2, attempt: 1, cost_usd: 1 };
  const dup = { ...base, cost_usd: 2 };
  const otherAttempt = { ...base, attempt: 2, cost_usd: 3 };
  const otherJob = { ...base, job_id: 9, cost_usd: 4 };
  const deduped = dedupeRecords([otherJob, base, otherAttempt, dup]);
  assert.equal(deduped.length, 3);
  assert.equal(
    deduped.find((r) => recordKey(r) === '1:2:1').cost_usd,
    2,
    'last occurrence wins',
  );
});

test('dedupeRecords output is stably sorted by run, job, attempt', () => {
  const records = [
    { run_id: 2, job_id: 1, attempt: 1 },
    { run_id: 1, job_id: 3, attempt: 1 },
    { run_id: 1, job_id: 3, attempt: 2 },
    { run_id: 1, job_id: 1, attempt: 1 },
  ];
  const shuffled = [...records].reverse();
  assert.deepEqual(
    dedupeRecords(shuffled).map(recordKey),
    dedupeRecords(records).map(recordKey),
  );
  assert.deepEqual(dedupeRecords(records).map(recordKey), [
    '1:1:1',
    '1:3:1',
    '1:3:2',
    '2:1:1',
  ]);
});

// ── aggregate math ────────────────────────────────────────────────────

function rec(overrides = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    run_id: overrides.run_id ?? 1,
    job_id: overrides.job_id ?? 1,
    attempt: 1,
    workflow: overrides.workflow ?? 'Monitor',
    model: overrides.model ?? 'glm-5-turbo',
    run_created_at: '',
    run_updated_at: '',
    job_started_at: '',
    job_completed_at: '',
    turns: overrides.turns ?? null,
    cost_usd: overrides.cost_usd ?? null,
    cost_per_turn: overrides.cost_per_turn ?? null,
    duration_sec: overrides.duration_sec ?? null,
    outcome: overrides.outcome ?? 'success',
    source: 'job-log',
  };
}

test('aggregate computes fleet totals, averages, and maxima', () => {
  const records = [
    rec({ run_id: 1, turns: 40, cost_usd: 4, cost_per_turn: 0.1, duration_sec: 200 }),
    rec({ run_id: 2, job_id: 2, turns: 20, cost_usd: 2, cost_per_turn: 0.1, duration_sec: 100, outcome: 'failure' }),
    rec({ run_id: 3, turns: 10, cost_usd: 1, cost_per_turn: 0.1, duration_sec: 50 }),
  ];
  const summary = aggregate(records, { runsScanned: 3, jobsScanned: 5, missingJobs: 2 });
  assert.equal(summary.fleet.records, 3);
  assert.equal(summary.fleet.runs, 3);
  assert.deepEqual(summary.fleet.turns, { count: 3, total: 70, avg: 23.3, max: 40 });
  assert.deepEqual(summary.fleet.cost_usd, { count: 3, total: 7, avg: 2.3333, max: 4 });
  assert.deepEqual(summary.fleet.duration_sec, { count: 3, total: 350, avg: 116.7, max: 200 });
  assert.deepEqual(summary.fleet.outcomes, { success: 2, failure: 1 });
  assert.equal(summary.missing_metrics_jobs, 2);
});

test('aggregate groups by workflow and model with unknown fallbacks', () => {
  const records = [
    rec({ workflow: 'Monitor', model: 'glm-5-turbo', turns: 10, cost_usd: 1 }),
    rec({ workflow: 'Monitor', model: '', turns: 10, cost_usd: 1 }),
    rec({ workflow: '', model: 'glm-5-turbo', turns: 10, cost_usd: 1 }),
  ];
  const summary = aggregate(records);
  assert.deepEqual(Object.keys(summary.by_workflow), ['Monitor', 'unknown']);
  assert.deepEqual(Object.keys(summary.by_model), ['glm-5-turbo', 'unknown']);
  assert.equal(summary.by_workflow.Monitor.records, 2);
  assert.equal(summary.by_workflow.unknown.records, 1);
  assert.equal(summary.by_model.unknown.records, 1);
});

test('aggregate treats zero values as samples, not missing', () => {
  const records = [rec({ turns: 0, cost_usd: 0, cost_per_turn: 0, duration_sec: 0 })];
  const summary = aggregate(records);
  assert.deepEqual(summary.fleet.cost_usd, { count: 1, total: 0, avg: 0, max: 0 });
  assert.deepEqual(summary.fleet.turns, { count: 1, total: 0, avg: 0, max: 0 });
});

test('aggregate with no records yields null stats and zero counts', () => {
  const summary = aggregate([]);
  assert.equal(summary.fleet.records, 0);
  assert.equal(summary.fleet.cost_usd.total, null);
  assert.deepEqual(summary.by_workflow, {});
  assert.deepEqual(summary.by_model, {});
});

test('aggregate output is stable under input shuffling', () => {
  const records = [
    rec({ run_id: 1, turns: 40, cost_usd: 4 }),
    rec({ run_id: 2, turns: 20, cost_usd: 2 }),
    rec({ run_id: 3, turns: 10, cost_usd: 1 }),
  ];
  const a = JSON.stringify(aggregate(records));
  const b = JSON.stringify(aggregate([...records].reverse()));
  assert.equal(a, b);
});

// ── collectCostTelemetry end-to-end over a fake gh runner ────────────

function fakeGh(script) {
  return (args) => {
    const joined = args.join(' ');
    const handler = script.find((entry) => joined.includes(entry.match));
    if (!handler) return { ok: false, stdout: '', error: `no script for ${joined}` };
    return handler.respond(args);
  };
}

test('collectCostTelemetry builds records, counts missing jobs, and surfaces fetch errors', () => {
  const gateJob = { ...JOB, id: 555900, name: 'Fleet back-pressure gate' };
  const runner = fakeGh([
    {
      match: 'actions/workflows/monitor.yml/runs',
      respond: () => ({
        ok: true,
        stdout: JSON.stringify({ ...RUN, id: 1001 }),
      }),
    },
    {
      match: '/actions/runs/1001/jobs',
      respond: () => ({
        ok: true,
        stdout: [JSON.stringify(JOB), JSON.stringify(gateJob)].join('\n'),
      }),
    },
    {
      match: 'jobs/555001/logs',
      respond: () => ({ ok: true, stdout: metricsLog() }),
    },
    {
      match: 'jobs/555900/logs',
      respond: () => ({ ok: true, stdout: '##[group]Run gate\nok 1\n' }),
    },
  ]);

  const result = collectCostTelemetry(
    {
      repo: 'owner/repo',
      workflowFile: 'monitor.yml',
      since: '2026-08-15T00:00:00Z',
      excludeRunId: 9999,
      maxRuns: 10,
    },
    runner,
  );

  assert.equal(result.error, null);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].run_id, 1001);
  assert.equal(result.summary.jobs_scanned, 2);
  assert.equal(result.summary.missing_metrics_jobs, 1); // gate job
  assert.deepEqual(result.summary.fetch_errors, []);
  assert.equal(result.summary.fleet.cost_usd.total, 3.0194);
  assert.equal(result.summary.window.workflow_file, 'monitor.yml');
});

test('collectCostTelemetry treats a purged (404) job log as missing metrics, not a fetch error', () => {
  const runner = fakeGh([
    {
      match: 'actions/workflows/monitor.yml/runs',
      respond: () => ({ ok: true, stdout: JSON.stringify(RUN) }),
    },
    {
      match: '/actions/runs/1001/jobs',
      respond: () => ({ ok: true, stdout: JSON.stringify(JOB) }),
    },
    {
      match: 'jobs/555001/logs',
      respond: () => ({
        ok: false,
        stdout: '',
        error: 'Command failed: gh api repos/owner/repo/actions/jobs/555001/logs\ngh: HTTP 404\n',
      }),
    },
  ]);

  const result = collectCostTelemetry(
    {
      repo: 'owner/repo',
      workflowFile: 'monitor.yml',
      since: '2026-08-15T00:00:00Z',
      maxRuns: 10,
    },
    runner,
  );

  assert.equal(result.error, null);
  assert.equal(result.summary.jobs_scanned, 1);
  assert.equal(result.summary.missing_metrics_jobs, 1);
  assert.deepEqual(result.summary.fetch_errors, []);
});

test('collectCostTelemetry reports a job-log fetch failure without dropping the run', () => {
  const runner = fakeGh([
    {
      match: 'actions/workflows/monitor.yml/runs',
      respond: () => ({ ok: true, stdout: JSON.stringify(RUN) }),
    },
    {
      match: '/actions/runs/1001/jobs',
      respond: () => ({ ok: true, stdout: JSON.stringify(JOB) }),
    },
    {
      match: 'jobs/555001/logs',
      respond: () => ({ ok: false, stdout: '', error: 'HTTP 502' }),
    },
  ]);

  const result = collectCostTelemetry(
    {
      repo: 'owner/repo',
      workflowFile: 'monitor.yml',
      since: '2026-08-15T00:00:00Z',
      maxRuns: 10,
    },
    runner,
  );

  assert.equal(result.error, null);
  assert.equal(result.records.length, 0);
  assert.equal(result.summary.jobs_scanned, 1);
  assert.deepEqual(result.summary.fetch_errors, [
    { scope: 'job-555001-log', detail: 'HTTP 502' },
  ]);
});

test('collectCostTelemetry fails closed when the run listing fails', () => {
  const result = collectCostTelemetry(
    {
      repo: 'owner/repo',
      workflowFile: 'monitor.yml',
      since: '2026-08-15T00:00:00Z',
      maxRuns: 10,
    },
    () => ({ ok: false, stdout: '', error: 'gh not authenticated' }),
  );
  assert.equal(result.error, 'run-list-failed');
  assert.equal(result.records.length, 0);
  assert.deepEqual(result.summary.fetch_errors, [
    { scope: 'runs-list', detail: 'gh not authenticated' },
  ]);
});

test('collectCostTelemetry dedupes the same job seen twice via pagination overlap', () => {
  const runner = fakeGh([
    {
      match: 'actions/workflows/monitor.yml/runs',
      respond: () => ({ ok: true, stdout: JSON.stringify(RUN) }),
    },
    {
      match: '/actions/runs/1001/jobs',
      respond: () => ({
        ok: true,
        stdout: [JSON.stringify(JOB), JSON.stringify(JOB)].join('\n'),
      }),
    },
    {
      match: 'jobs/555001/logs',
      respond: () => ({ ok: true, stdout: metricsLog() }),
    },
  ]);

  const result = collectCostTelemetry(
    {
      repo: 'owner/repo',
      workflowFile: 'monitor.yml',
      since: '2026-08-15T00:00:00Z',
      maxRuns: 10,
    },
    runner,
  );
  assert.equal(result.records.length, 1);
  assert.equal(result.summary.records, 1);
});

// ── CLI-facing helpers ────────────────────────────────────────────────

test('parseArgs maps kebab-case flags to camelCase keys', () => {
  const args = parseArgs([
    '--repo',
    'owner/repo',
    '--workflow-file',
    'monitor.yml',
    '--exclude-run-id',
    '42',
    '--window-hours',
    '168',
  ]);
  assert.equal(args.repo, 'owner/repo');
  assert.equal(args.workflowFile, 'monitor.yml');
  assert.equal(args.excludeRunId, '42');
  assert.equal(args.windowHours, '168');
});

test('renderRecordsJsonl emits one JSON line per record with trailing newline', () => {
  const records = [rec({ run_id: 1 }), rec({ run_id: 2 })];
  const jsonl = renderRecordsJsonl(records);
  const lines = jsonl.split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
  assert.ok(jsonl.endsWith('\n'));
  assert.equal(renderRecordsJsonl([]), '');
});

test('writeGithubOutput writes key=value lines and blanks null values', () => {
  const dir = fs.mkdtempSync(path.join(__dirname, 'tmp-cost-out-'));
  const outputPath = path.join(dir, 'output.txt');
  try {
    writeGithubOutput(outputPath, {
      records_count: 3,
      total_cost_usd: null,
    });
    const contents = fs.readFileSync(outputPath, 'utf8');
    assert.equal(contents, 'records_count=3\ntotal_cost_usd=\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── workflow wiring contract ─────────────────────────────────────────

const WORKFLOW_PATH = path.join(
  __dirname,
  '..',
  '..',
  'monitor-amnezia-control-panel-github-runs.yml',
);

test('monitor workflow runs cost telemetry as a dedicated parallel job', () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');

  const jobIndex = workflow.indexOf('  cost-telemetry:');
  assert.ok(jobIndex >= 0, 'cost-telemetry job must exist');
  const jobBlock = workflow.slice(jobIndex, workflow.indexOf('  report-failure:'));

  assert.match(jobBlock, /needs: \[fleet-gate\]/);
  assert.match(jobBlock, /timeout-minutes: 10/);
  assert.match(jobBlock, /aggregate-run-costs\.cjs/);
  assert.match(
    jobBlock,
    /--exclude-run-id "\$\{\{ github\.run_id \}\}"/,
    'the current incomplete run must be excluded',
  );
  assert.match(jobBlock, /MONITOR_WORKFLOW_FILE/);
  assert.match(jobBlock, /--window-hours 168/);
  assert.doesNotMatch(
    jobBlock,
    /needs: \[fleet-gate, monitor-runs\]|needs: \[monitor-runs/,
    'telemetry must not sit behind the 25-minute agent job',
  );
});

test('monitor workflow uploads a named retained telemetry artifact', () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const jobIndex = workflow.indexOf('  cost-telemetry:');
  const jobBlock = workflow.slice(jobIndex, workflow.indexOf('  report-failure:'));

  assert.match(jobBlock, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.match(jobBlock, /name: monitor-cost-telemetry-\$\{\{ github\.run_id \}\}/);
  assert.match(jobBlock, /retention-days: 90/);
  assert.match(jobBlock, /if-no-files-found: error/);
  assert.match(jobBlock, /if: always\(\)/);
  assert.match(jobBlock, /Per-run cost telemetry \(MON-E06\)/);
  assert.match(jobBlock, /GITHUB_STEP_SUMMARY/);
});
