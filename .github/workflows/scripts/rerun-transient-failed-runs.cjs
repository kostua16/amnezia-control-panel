#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// MON-E04: Auto re-run for classified transient failures.

const { execFileSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');

const TRANSIENT_PATTERNS = [
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /HTTP 5\d{2}/i,
  /connection reset/i,
  /connection refused/i,
  /dial tcp/i,
  /i\/o timeout/i,
  /tls handshake timeout/i,
  /context deadline exceeded/i,
  /unexpected eof/i,
  /Failed sending HTTP request/i,
  /rate limit/i,
  /throttle/i,
  /service\s+(?:temporarily\s+)?overload/i,
];

function isTransientLog(logText) {
  return TRANSIENT_PATTERNS.some((re) => re.test(logText));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
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
      }),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function setOutput(name, value, outputPath) {
  if (!outputPath) return;
  appendFileSync(outputPath, `${name}=${value}\n`);
}

function fetchFailedLogs(runId, repo, ghRunner = runGh) {
  const args = ['run', 'view', String(runId), '--log-failed'];
  if (repo) args.push('--repo', repo);
  const result = ghRunner(args);
  return result.ok ? result.stdout : '';
}

function classifyRun(runId, repo, ghRunner = runGh) {
  const logs = fetchFailedLogs(runId, repo, ghRunner);
  if (!logs) return { transient: false, reason: 'log-unavailable' };
  if (isTransientLog(logs)) {
    return { transient: true, reason: 'transient-signature' };
  }
  return { transient: false, reason: 'non-transient' };
}

function rerunTransientFailedRuns(
  { repo, since, limit = 10, dryRun = false } = {},
  ghRunner = runGh,
) {
  const listArgs = [
    'run',
    'list',
    '--status',
    'failure',
    '--limit',
    String(limit),
  ];
  if (repo) listArgs.push('--repo', repo);
  if (since) listArgs.push('--created', `>=${since}`);
  listArgs.push(
    '--json',
    'databaseId,name,workflowName,status,conclusion,attempt,createdAt,headBranch,event',
  );

  const listResult = ghRunner(listArgs);
  if (!listResult.ok) {
    return { scanned: 0, rerun: [], skipped: [], error: 'run-list-failed' };
  }

  let runs;
  try {
    runs = JSON.parse(listResult.stdout);
  } catch {
    return {
      scanned: 0,
      rerun: [],
      skipped: [],
      error: 'run-list-invalid-json',
    };
  }

  const results = { scanned: runs.length, rerun: [], skipped: [] };
  for (const run of runs) {
    const runId = run.databaseId;
    const workflowName = run.workflowName || run.name || 'unknown';

    // GitHub exposes the latest run attempt as `attempt`. Once a run has been
    // retried, skip it on later monitor cycles to prevent retry loops.
    if (Number(run.attempt) > 1) {
      results.skipped.push({ runId, workflowName, reason: 'already-rerun' });
      continue;
    }

    const classification = classifyRun(runId, repo, ghRunner);
    if (!classification.transient) {
      results.skipped.push({
        runId,
        workflowName,
        reason: classification.reason,
      });
      continue;
    }

    if (dryRun) {
      results.rerun.push({
        runId,
        workflowName,
        reason: classification.reason,
      });
      continue;
    }

    const rerunArgs = ['run', 'rerun', String(runId), '--failed'];
    if (repo) rerunArgs.push('--repo', repo);
    const rerunResult = ghRunner(rerunArgs);
    // `gh run rerun` succeeds with empty stdout, so use its exit status.
    if (rerunResult.ok) {
      results.rerun.push({
        runId,
        workflowName,
        reason: classification.reason,
      });
    } else {
      results.skipped.push({ runId, workflowName, reason: 'rerun-failed' });
    }
  }

  return results;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo || process.env.GITHUB_REPOSITORY || '';
  const since = args.since || '';
  const limit = Number(args.limit) || 10;
  const dryRun = args.dryRun === 'true' || args.dryRun === true;
  const outputPath = args.githubOutput || process.env.GITHUB_OUTPUT || '';

  if (!since) {
    process.stderr.write(
      'Usage: rerun-transient-failed-runs.cjs --since <ISO> [--repo owner/repo] [--limit N] [--dry-run] [--github-output PATH]\n',
    );
    process.exit(1);
  }

  const results = rerunTransientFailedRuns({ repo, since, limit, dryRun });
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  setOutput('rerun_count', String(results.rerun.length), outputPath);
  setOutput(
    'rerun_ids',
    results.rerun.map((run) => run.runId).join(','),
    outputPath,
  );
  setOutput('summary', JSON.stringify(results), outputPath);
  if (results.error) process.exitCode = 1;
}

module.exports = {
  TRANSIENT_PATTERNS,
  isTransientLog,
  classifyRun,
  rerunTransientFailedRuns,
  runGh,
};

if (require.main === module) main();
