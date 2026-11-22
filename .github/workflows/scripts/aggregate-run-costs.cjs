#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

'use strict';

// MON-E06: Per-run cost/turn telemetry aggregation.
//
// Queries a bounded window of completed runs of one workflow (default
// consumer: the hourly GitHub-runs monitor), fetches capped job logs, and
// reuses parseClaudeExecution() to extract Claude cost/turn metrics per
// job attempt. Records are normalized, deduped by run/job/attempt, and
// emitted as versioned JSONL plus an aggregate summary (fleet, per
// workflow, per model). The monitor workflow uploads both as a retained
// artifact so fleet budgets can be tuned from complete data — cost is
// otherwise only visible in failure issues.
//
// Usage:
//   aggregate-run-costs.cjs --repo owner/repo --workflow-file wf.yml \
//     [--since ISO | --window-hours 168] [--exclude-run-id N] \
//     [--agent-job-name 'Monitor GitHub Actions Runs'] \
//     [--max-runs 200] [--max-log-bytes 524288] \
//     [--records-file path] [--summary-file path] [--github-output path]
//
// Exit codes: 0 when a window was processed (partial gh failures are
// surfaced in stderr and summary.fetch_errors — partial data is still
// valuable), 1 when nothing could be scanned: the run listing itself
// failed, every run's jobs listing failed, or no job matched the agent job
// name — each would otherwise publish a green, empty artifact.

const { execFileSync } = require('node:child_process');
const { appendFileSync, writeFileSync } = require('node:fs');
const { parseClaudeExecution } = require('./parse-claude-execution.cjs');
const { parseGhJsonLines } = require('./fleet-kpi-digest.cjs');

const SCHEMA_VERSION = 1;
const DEFAULT_WINDOW_HOURS = 168;
// The hourly cron produces ~168 completed runs inside the default 7-day
// window; the cap must cover that or the scan silently shrinks the window
// it claims to report on.
const DEFAULT_MAX_RUNS = 200;
// Only jobs with this name run Claude and carry cost metrics; gate and
// reporting jobs are structurally metricless and their logs are never
// fetched.
const DEFAULT_AGENT_JOB_NAME = 'Monitor GitHub Actions Runs';
const DEFAULT_MAX_LOG_BYTES = 512 * 1024;
const DEFAULT_PER_PAGE = 100;
const MAX_FETCH_ERRORS = 50;
// Canonical UTC ISO-8601, exactly as Date#toISOString() emits it (with or
// without the millisecond part). Window math compares parsed epochs, but
// the canonical form is still required so the value can be forwarded to
// GitHub's `created` qualifier without re-parsing surprises.
const CANONICAL_SINCE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// Shape alone accepts impossible dates ('2026-13-45T99:99:99Z'). Round-trip
// through Date so only real timestamps in the canonical form pass.
function isCanonicalSince(value) {
  if (!value || !CANONICAL_SINCE_PATTERN.test(value)) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  const iso = new Date(ms).toISOString(); // always millisecond precision
  return iso === value || iso === `${value.slice(0, -1)}.000Z`;
}

// GitHub's `created` qualifier expects the second-precision timestamps its
// API emits. Floor the window start so the server-side bound stays
// inclusive; the client-side epoch filter below trims to the exact cutoff.
function toGithubCreatedAt(ms) {
  return `${new Date(Math.floor(ms / 1000) * 1000)
    .toISOString()
    .slice(0, -5)}Z`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg
      .slice(2)
      .replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    args[key] =
      argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return args;
}

function runGh(args) {
  try {
    return {
      ok: true,
      stdout: execFileSync('gh', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
        // Job logs stream whole into stdout; the 1 MB default would kill
        // the largest (most expensive) runs before capLogText() can bound
        // what is kept in memory.
        maxBuffer: 64 * 1024 * 1024,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: '',
      // gh writes its diagnostic (e.g. "gh: HTTP 404") to stderr; the
      // Error message alone is only "Command failed: gh api ...".
      error:
        error instanceof Error
          ? String(error.stderr || error.message)
          : String(error),
    };
  }
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Keep the TAIL of the log: the SDK result metrics (total_cost_usd,
// num_turns, duration_ms) are printed near the end of a job log, so a head
// cap would drop exactly the fields this aggregation exists to collect.
function capLogText(logText, maxBytes) {
  const text = String(logText || '');
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const buffer = Buffer.from(text, 'utf8');
  const tail = buffer.subarray(buffer.length - maxBytes).toString('utf8');
  const firstNewline = tail.indexOf('\n');
  return firstNewline >= 0 ? tail.slice(firstNewline + 1) : tail;
}

function runTimestamp(run) {
  return run.run_started_at || run.updated_at || run.created_at || '';
}

function fetchCompletedRuns(
  { repo, workflowFile, since, excludeRunId, maxRuns, perPage },
  ghRunner = runGh,
) {
  // An empty or non-canonical window must never report green: the filter
  // below forwards the value to GitHub and compares parsed epochs, so both
  // the canonical UTC form this script itself emits (the --since default
  // is toISOString()) and a real calendar date are required. A parse-only
  // check would also accept '2026/08/15',
  // 'Aug 15 2026', or '+02:00'-offset values that silently drop or
  // mis-include runs, and callers would surface runs_scanned: 0 as
  // success. Fail closed instead — collectCostTelemetry turns listing
  // errors into a hard failure (main() exits 1).
  if (!isCanonicalSince(since)) {
    return {
      runs: [],
      truncated: false,
      errors: [
        {
          scope: 'runs-list',
          detail: `invalid or missing --since window (${
            since ? `"${since}"` : 'none'
          }); expected canonical UTC ISO-8601 as emitted by toISOString(); refusing to scan an unbounded window`,
        },
      ],
    };
  }
  const errors = [];
  const result = ghRunner([
    'api',
    `repos/${repo}/actions/workflows/${workflowFile}/runs`,
    // -f fields imply POST unless the method is pinned; these endpoints are
    // GET-only and answer 404 to a POST.
    '--method',
    'GET',
    '-f',
    'status=completed',
    // Bound the listing server-side: with --paginate and no `created`
    // window, gh walks the workflow's entire history — growing without
    // bound and eventually blowing runGh's 30 s per-invocation timeout.
    // gh splits -f at the FIRST '=', so the double '=' is load-bearing:
    // it keeps the parameter `created` with a value of `>=…`. A single
    // '=' would send a bogus `created>` parameter that GitHub silently
    // ignores, re-opening the unbounded scan.
    '-f',
    `created=>=${toGithubCreatedAt(Date.parse(since))}`,
    '-f',
    `per_page=${perPage}`,
    '--paginate',
    '--jq',
    '.workflow_runs[] | {id, name, event, status, conclusion, created_at, updated_at, run_started_at}',
  ]);
  if (!result.ok) {
    return {
      runs: [],
      truncated: false,
      errors: [{ scope: 'runs-list', detail: result.error || 'gh api failed' }],
    };
  }
  // `--paginate` with a streaming --jq emits NDJSON; malformed lines are
  // already warned about inside parseGhJsonLines and dropped here. Compare
  // epochs, not strings: GitHub timestamps are second-precision while
  // --since may carry milliseconds, and the two string forms disagree on
  // ordering inside that 1 s boundary.
  const epochOf = (run) => Date.parse(runTimestamp(run));
  const sinceMs = Date.parse(since);
  const matched = parseGhJsonLines(result.stdout, []).filter((run) => {
    if (!run || typeof run.id !== 'number') return false;
    if (excludeRunId && Number(run.id) === Number(excludeRunId)) return false;
    const timestampMs = epochOf(run);
    return Number.isFinite(timestampMs) && timestampMs >= sinceMs;
  });
  return {
    runs: matched.sort((a, b) => epochOf(b) - epochOf(a)).slice(0, maxRuns),
    // Exact because it is computed before the slice: the caller must be
    // able to tell a full window from a maxRuns-trimmed one.
    truncated: matched.length > maxRuns,
    errors,
  };
}

function fetchRunJobs({ repo, runId, perPage }, ghRunner = runGh) {
  const result = ghRunner([
    'api',
    `repos/${repo}/actions/runs/${runId}/jobs`,
    '--method',
    'GET',
    '-f',
    `per_page=${perPage}`,
    // The endpoint defaults to filter=latest, hiding earlier re-run
    // attempts — usually the expensive failures. Records are keyed by
    // attempt, so list every attempt and let dedupe handle overlaps.
    '-f',
    'filter=all',
    '--paginate',
    '--jq',
    '.jobs[] | {id, name, status, conclusion, started_at, completed_at, run_attempt}',
  ]);
  if (!result.ok) {
    return {
      jobs: [],
      errors: [
        { scope: `run-${runId}-jobs`, detail: result.error || 'gh api failed' },
      ],
    };
  }
  const jobs = parseGhJsonLines(result.stdout, []).filter(
    (job) => job && typeof job.id === 'number',
  );
  return { jobs, errors: [] };
}

function fetchJobLogText({ repo, jobId }, ghRunner = runGh) {
  const result = ghRunner(['api', `repos/${repo}/actions/jobs/${jobId}/logs`]);
  if (result.ok) return { logText: result.stdout };
  // GitHub answers 404 for logs of skipped jobs and of runs cancelled
  // before log upload (log purged / never written). That is a normal
  // "no metrics available" condition, not a fetch failure.
  const missingLog = /HTTP 404/.test(result.error || '');
  return { error: result.error, missingLog };
}

function recordKey(record) {
  return `${record.run_id}:${record.job_id}:${record.attempt}`;
}

function buildRecord({ run, job, logText, maxLogBytes }) {
  const metrics = parseClaudeExecution({
    logText: capLogText(logText, maxLogBytes),
  });
  if (metrics.numTurns === null && metrics.totalCostUsd === null) {
    return null; // job log carries no Claude metrics (e.g. fleet-gate)
  }
  return {
    schema_version: SCHEMA_VERSION,
    run_id: Number(run.id),
    job_id: Number(job.id),
    attempt: Number.isFinite(Number(job.run_attempt))
      ? Number(job.run_attempt)
      : 1,
    workflow: String(run.name || ''),
    model: metrics.modelUsed || '',
    run_created_at: String(run.created_at || ''),
    run_updated_at: String(run.updated_at || ''),
    job_started_at: String(job.started_at || ''),
    job_completed_at: String(job.completed_at || ''),
    turns: metrics.numTurns,
    cost_usd: metrics.totalCostUsd,
    cost_per_turn: metrics.costPerTurn,
    duration_sec: metrics.durationSec,
    // The record describes this job attempt, not its parent run: a
    // successful Claude job inside an ultimately failed run is still
    // success data.
    outcome: String(job.conclusion || run.conclusion || ''),
    source: 'job-log',
  };
}

function dedupeRecords(records) {
  const byKey = new Map();
  for (const record of records) {
    if (!record) continue;
    byKey.set(recordKey(record), record); // last occurrence wins
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.run_id - b.run_id || a.job_id - b.job_id || a.attempt - b.attempt,
  );
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stats(values, digits) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) {
    return { count: 0, total: null, avg: null, max: null };
  }
  const total = usable.reduce((sum, value) => sum + value, 0);
  return {
    count: usable.length,
    total: round(total, digits),
    avg: round(total / usable.length, digits),
    max: round(Math.max(...usable), digits),
  };
}

function groupStats(records) {
  const outcomes = {};
  for (const record of records) {
    const key = record.outcome || 'unknown';
    outcomes[key] = (outcomes[key] || 0) + 1;
  }
  return {
    records: records.length,
    runs: new Set(records.map((record) => record.run_id)).size,
    turns: stats(
      records.map((r) => r.turns),
      1,
    ),
    cost_usd: stats(
      records.map((r) => r.cost_usd),
      4,
    ),
    cost_per_turn: stats(
      records.map((r) => r.cost_per_turn),
      4,
    ),
    duration_sec: stats(
      records.map((r) => r.duration_sec),
      1,
    ),
    outcomes,
  };
}

function aggregate(records, extras = {}) {
  const byWorkflow = {};
  for (const name of [
    ...new Set(records.map((r) => r.workflow || 'unknown')),
  ].sort()) {
    byWorkflow[name] = groupStats(
      records.filter((r) => (r.workflow || 'unknown') === name),
    );
  }
  const byModel = {};
  for (const model of [
    ...new Set(records.map((r) => r.model || 'unknown')),
  ].sort()) {
    byModel[model] = groupStats(
      records.filter((r) => (r.model || 'unknown') === model),
    );
  }
  return {
    schema_version: SCHEMA_VERSION,
    window: extras.window || null,
    runs_scanned: extras.runsScanned || 0,
    jobs_scanned: extras.jobsScanned || 0,
    records: records.length,
    missing_metrics_jobs: extras.missingJobs || 0,
    fetch_errors: extras.fetchErrors || [],
    fleet: groupStats(records),
    by_workflow: byWorkflow,
    by_model: byModel,
  };
}

function collectCostTelemetry(options = {}, ghRunner = runGh) {
  const {
    repo,
    workflowFile,
    since,
    excludeRunId,
    maxRuns = DEFAULT_MAX_RUNS,
    maxLogBytes = DEFAULT_MAX_LOG_BYTES,
    perPage = DEFAULT_PER_PAGE,
    agentJobName = DEFAULT_AGENT_JOB_NAME,
  } = options;

  const windowInfo = {
    since,
    workflow_file: workflowFile,
    exclude_run_id: excludeRunId,
    agent_job_name: agentJobName || null,
    // True when maxRuns cut the scan short of the requested --since;
    // effective_since is the oldest run timestamp actually scanned.
    truncated: false,
    effective_since: null,
  };

  const { runs, truncated, errors } = fetchCompletedRuns(
    { repo, workflowFile, since, excludeRunId, maxRuns, perPage },
    ghRunner,
  );
  windowInfo.truncated = truncated;
  if (errors.length > 0) {
    return {
      error: 'run-list-failed',
      records: [],
      summary: aggregate([], {
        window: windowInfo,
        fetchErrors: errors,
      }),
    };
  }

  const records = [];
  const fetchErrors = [...errors];
  let jobsScanned = 0;
  let missingJobs = 0;

  for (const run of runs) {
    const { jobs, errors: jobErrors } = fetchRunJobs(
      { repo, runId: run.id, perPage },
      ghRunner,
    );
    fetchErrors.push(...jobErrors);
    for (const job of jobs) {
      // Only the agent job carries Claude metrics. Fetching every gate and
      // report log would spend the job's whole time budget downloading
      // logs that can only ever count as missing_metrics_jobs.
      if (agentJobName && job.name !== agentJobName) continue;
      jobsScanned += 1;
      const fetched = fetchJobLogText({ repo, jobId: job.id }, ghRunner);
      if (fetched.error) {
        if (fetched.missingLog) {
          missingJobs += 1; // skipped/cancelled job — log legitimately absent
        } else {
          fetchErrors.push({
            scope: `job-${job.id}-log`,
            detail: fetched.error,
          });
        }
        continue;
      }
      const record = buildRecord({
        run,
        job,
        logText: fetched.logText,
        maxLogBytes,
      });
      if (record) records.push(record);
      else missingJobs += 1;
    }
  }

  const cappedErrors = fetchErrors.slice(0, MAX_FETCH_ERRORS);
  if (fetchErrors.length > MAX_FETCH_ERRORS) {
    cappedErrors.push({
      scope: 'fetch-errors',
      detail: `${fetchErrors.length - MAX_FETCH_ERRORS} more error(s) omitted`,
    });
  }

  // Runs were listed but zero jobs were scanned: either every jobs listing
  // failed (the agent-job filter cannot zero out a run whose jobs were
  // never listed) or the agent-job name matched nothing (job renamed,
  // matrix/prefix suffix, drifted --agent-job-name). Both would report a
  // green empty artifact — fail closed exactly like a run-listing failure,
  // independently of whether any listing errored.
  if (runs.length > 0 && jobsScanned === 0) {
    const jobsListFailed = fetchErrors.some((error) =>
      error.scope.endsWith('-jobs'),
    );
    return {
      error: jobsListFailed ? 'jobs-list-failed' : 'agent-job-missing',
      records: [],
      summary: aggregate([], {
        window: windowInfo,
        runsScanned: runs.length,
        fetchErrors: jobsListFailed
          ? cappedErrors
          : [
              ...cappedErrors,
              {
                scope: 'agent-job-missing',
                detail: `zero jobs matched the agent job name "${
                  agentJobName || '(unset)'
                }" across ${runs.length} run(s); the job name may have drifted`,
              },
            ],
      }),
    };
  }

  const deduped = dedupeRecords(records);
  windowInfo.effective_since = runs.length
    ? runTimestamp(runs[runs.length - 1])
    : null;
  return {
    error: null,
    records: deduped,
    summary: aggregate(deduped, {
      window: windowInfo,
      runsScanned: runs.length,
      jobsScanned,
      missingJobs,
      fetchErrors: cappedErrors,
    }),
  };
}

function renderRecordsJsonl(records) {
  if (records.length === 0) return '';
  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

function writeGithubOutput(outputPath, entries) {
  if (!outputPath) return;
  const lines = Object.entries(entries).map(
    ([key, value]) =>
      `${key}=${value === null || value === undefined ? '' : value}`,
  );
  appendFileSync(outputPath, `${lines.join('\n')}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo || process.env.GITHUB_REPOSITORY;
  const workflowFile = args.workflowFile || '';
  if (!repo || !workflowFile) {
    process.stderr.write('Error: --repo and --workflow-file are required\n');
    process.exit(1);
  }

  const since =
    args.since ||
    new Date(
      Date.now() -
        positiveInt(args.windowHours, DEFAULT_WINDOW_HOURS) * 3600_000,
    ).toISOString();

  const result = collectCostTelemetry({
    repo,
    workflowFile,
    since,
    excludeRunId: args.excludeRunId,
    maxRuns: positiveInt(args.maxRuns, DEFAULT_MAX_RUNS),
    maxLogBytes: positiveInt(args.maxLogBytes, DEFAULT_MAX_LOG_BYTES),
    agentJobName: args.agentJobName,
  });

  for (const fetchError of result.summary.fetch_errors) {
    process.stderr.write(
      `Warning: ${fetchError.scope}: ${fetchError.detail}\n`,
    );
  }

  if (args.recordsFile) {
    writeFileSync(args.recordsFile, renderRecordsJsonl(result.records));
  }
  const summaryJson = `${JSON.stringify(result.summary, null, 2)}\n`;
  if (args.summaryFile) {
    writeFileSync(args.summaryFile, summaryJson);
  }
  writeGithubOutput(args.githubOutput, {
    records_count: result.summary.records,
    runs_scanned: result.summary.runs_scanned,
    jobs_scanned: result.summary.jobs_scanned,
    missing_metrics_jobs: result.summary.missing_metrics_jobs,
    total_cost_usd: result.summary.fleet.cost_usd.total,
  });
  process.stdout.write(summaryJson);

  if (result.error) {
    process.stderr.write(`Error: ${result.error}\n`);
    process.exit(1);
  }
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_WINDOW_HOURS,
  DEFAULT_MAX_RUNS,
  DEFAULT_MAX_LOG_BYTES,
  parseArgs,
  runGh,
  capLogText,
  recordKey,
  buildRecord,
  dedupeRecords,
  stats,
  groupStats,
  aggregate,
  fetchCompletedRuns,
  fetchRunJobs,
  fetchJobLogText,
  collectCostTelemetry,
  renderRecordsJsonl,
  writeGithubOutput,
};

if (require.main === module) {
  main();
}
