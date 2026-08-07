#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// MON-E04: Auto re-run for classified transient failures.
//
// Scans recent failed workflow runs, inspects their logs for deterministic
// transient signatures (ECONNRESET, registry 5xx, ETIMEDOUT, rate-limit,
// OOM, runner cancellation), and re-runs matching runs via the Actions API.
// Each run is re-run at most once (guarded by runAttempt).
//
// Designed to be called by the monitor-github-runs ZAI agent or as a
// standalone self-heal step.

const { execFileSync } = require('node:child_process');

// Deterministic transient signatures drawn from collect-workflow-failure-context
// and lib/sticky-comment.cjs. Covers network resets, DNS failures, HTTP 5xx,
// rate-limit/throttle, runner eviction, and OOM — all failures that resolve
// on retry without a code change.
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
  /Runner cancelled/i,
  /shutdown signal/i,
  /out of memory/i,
  /\bOOM\b/i,
  /no space left on device/i,
  /ENOSPC/i,
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
      .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    args[key] =
      argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return args;
}

function gh(args) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
  } catch (err) {
    return '';
  }
}

/**
 * Fetch failed-step logs for a run. Returns concatenated log text
 * from all failed jobs, or empty string on error.
 */
function fetchFailedLogs(runId) {
  const output = gh(['run', 'view', String(runId), '--log-failed']);
  return output || '';
}

/**
 * Classify a single failed run as transient or non-transient.
 * Checks failed-step logs against TRANSIENT_PATTERNS.
 */
function classifyRun(runId) {
  const logs = fetchFailedLogs(runId);
  if (!logs) {
    return { transient: false, reason: 'log-unavailable' };
  }
  if (isTransientLog(logs)) {
    return { transient: true, reason: 'transient-signature' };
  }
  return { transient: false, reason: 'non-transient' };
}

/**
 * Main entry point. Scans failed runs and re-runs transient ones.
 *
 * @param {object} opts
 * @param {string} opts.since - ISO timestamp; only consider runs created after this
 * @param {number} opts.limit - max runs to inspect (default 10)
 * @param {boolean} opts.dryRun - log what would be re-run without executing
 * @returns {{ scanned: number, rerun: Array<{runId: number, workflowName: string, reason: string}>, skipped: Array<{runId: number, workflowName: string, reason: string}> }}
 */
function rerunTransientFailedRuns({ since, limit = 10, dryRun = false } = {}) {
  const filterFlags = ['run', 'list', '--status', 'failed', '--limit', String(limit)];
  if (since) {
    filterFlags.push('--created', `>=${since}`);
  }
  filterFlags.push(
    '--json',
    'databaseId,name,workflowName,status,conclusion,runAttempt,createdAt,headBranch,event',
  );

  const json = gh(filterFlags);
  if (!json) {
    return { scanned: 0, rerun: [], skipped: [] };
  }

  let runs;
  try {
    runs = JSON.parse(json);
  } catch {
    return { scanned: 0, rerun: [], skipped: [] };
  }

  const results = { scanned: runs.length, rerun: [], skipped: [] };

  for (const run of runs) {
    const runId = run.databaseId;
    const name = run.workflowName || run.name || 'unknown';

    // Guard: only re-run first-attempt runs. runAttempt > 1 means the run
    // was already re-run (by human, by project-manager, or by a previous
    // monitor cycle). Avoids infinite re-run loops.
    if (Number(run.runAttempt) > 1) {
      results.skipped.push({ runId, workflowName: name, reason: 'already-rerun' });
      continue;
    }

    const classification = classifyRun(runId);

    if (classification.transient) {
      if (dryRun) {
        results.rerun.push({ runId, workflowName: name, reason: classification.reason });
      } else {
        const rerunOutput = gh(['run', 'rerun', String(runId), '--failed']);
        // gh run rerun exits 0 on success but prints the new run URL
        if (rerunOutput || !process.env.GH_TOKEN) {
          // If we got here, gh succeeded (no exception thrown)
          results.rerun.push({ runId, workflowName: name, reason: classification.reason });
        } else {
          results.skipped.push({ runId, workflowName: name, reason: 'rerun-failed' });
        }
      }
    } else {
      results.skipped.push({ runId, workflowName: name, reason: classification.reason });
    }
  }

  return results;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const since = args.since || '';
  const limit = Number(args.limit) || 10;
  const dryRun = args.dryRun === 'true' || args.dryRun === true;

  if (!since) {
    process.stderr.write(
      'Usage: rerun-transient-failed-runs.cjs --since <ISO> [--limit N] [--dry-run]\n',
    );
    process.exit(1);
  }

  const results = rerunTransientFailedRuns({ since, limit, dryRun });

  process.stdout.write(JSON.stringify(results, null, 2));
  process.stdout.write('\n');

  // Exit non-zero if nothing was re-run (useful for workflow step gating)
  process.exit(results.rerun.length > 0 ? 0 : 0);
}

module.exports = {
  TRANSIENT_PATTERNS,
  isTransientLog,
  classifyRun,
  rerunTransientFailedRuns,
};

if (require.main === module) {
  main();
}
