#!/usr/bin/env node

/**
 * Runner health self-check — MNT-E08
 *
 * Queries GitHub Actions API for self-hosted runner status and recent
 * workflow-run queue latency.  Reports runner online-count, pool
 * saturation, and queue delays so capacity pressure is visible per
 * maintenance sweep.
 *
 * Usage:
 *   node runner-health-check.cjs --repo owner/repo [--since <duration>] \
 *       [--queue-threshold <seconds>] [--json]
 *
 * Flags:
 *   --repo             GitHub repo (default from env GH_REPO or github.repository)
 *   --since            Look-back window for queued runs (default: 6h)
 *   --queue-threshold  Queue latency alert threshold in seconds (default: 300)
 *   --json             Output machine-readable JSON
 *
 * Exits 0 always (observability tool).  Writes findings to stdout.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { execFileSync } = require('child_process');
// Reuse the repo's shared NDJSON parser: `gh api ... --jq '.runners[]'`
// (with --paginate) emits one JSON object per runner across pages, not a
// single array, so a bulk JSON.parse throws on the second object and
// silently collapsed every multi-runner repo to an empty pool report.
const { parseGhJsonLines } = require('./fleet-kpi-digest.cjs');

const DEFAULT_SINCE = '6h';
const DEFAULT_QUEUE_THRESHOLD = 300;

// Records gh invocation failures so the report can surface them. Without
// this, a failed gh call (403 on actions/runners, rate limit, missing CLI)
// returns [] and is indistinguishable from a genuinely clean, healthy pool
// — masking the exact outage this tool exists to catch.
const ghErrors = [];

// ── CLI helpers ──────────────────────────────────────────────

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? null : (process.argv[idx + 1] ?? null);
}

function runGh(args, options = {}) {
  try {
    return (
      execFileSync('gh', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GH_PAGER: 'cat' },
        ...options,
      }) ?? ''
    ).trim();
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString().trim() : '';
    ghErrors.push(
      `${args.join(' ')}${stderr ? ` -> ${stderr.split('\n')[0]}` : ''}`,
    );
    return null;
  }
}

// ── Parse duration ────────────────────────────────────────────

function parseSince(duration) {
  const match = duration.match(/^(\d+)([dhm])$/);
  if (!match) {
    // Surface bad input rather than silently substituting the default,
    // which would otherwise hide a typo from the operator.
    process.stderr.write(
      `Warning: invalid --since "${duration}", using default ${DEFAULT_SINCE}\n`,
    );
    return new Date(Date.now() - 6 * 3600000);
  }
  const n = parseInt(match[1], 10);
  const multipliers = { h: 3600000, d: 86400000, m: 60000 };
  return new Date(Date.now() - n * (multipliers[match[2]] || 3600000));
}

// ── Runner status ────────────────────────────────────────────

function getRunners(repo) {
  // parseGhJsonLines always returns an array, collecting one parsed object
  // per NDJSON line and warning to stderr on unparseable output.
  const data = parseGhJsonLines(
    runGh([
      'api',
      `repos/${repo}/actions/runners`,
      '-f',
      'per_page=100',
      '--paginate',
      '--jq',
      '.runners[] | {id, name, status, labels: [.labels[].name]}',
    ]),
  );

  return data.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status, // "online" | "offline"
    labels: r.labels || [],
  }));
}

function getRunnerPools(runners) {
  const pools = {};
  for (const r of runners) {
    // Skip "self-hosted" label — pool identity is the other labels
    const poolLabels = (r.labels || []).filter((l) => l !== 'self-hosted');
    const poolKey =
      poolLabels.length > 0 ? poolLabels.sort().join(',') : 'default';
    if (!pools[poolKey]) {
      pools[poolKey] = { labels: poolLabels, online: 0, offline: 0, total: 0 };
    }
    pools[poolKey].total++;
    if (r.status === 'online') pools[poolKey].online++;
    else pools[poolKey].offline++;
  }
  return pools;
}

// ── Queue latency ───────────────────────────────────────────

function getRecentRuns(repo, since) {
  // Bound the query server-side via --created so high-latency runs in a busy
  // window are not truncated by a client-side cap, then narrow to the precise
  // --since moment (the API filter is date-granular, not to the second).
  const cutoff = parseSince(since);
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  const out = runGh([
    'run',
    'list',
    '--repo',
    repo,
    '--created',
    `>=${cutoffDay}`,
    '--limit',
    '100',
    '--json',
    'run_started_at,created_at,status,conclusion,name,databaseId',
  ]);
  if (out === null) return [];
  let data;
  try {
    data = JSON.parse(out);
  } catch (error) {
    // A malformed `gh run list` body (proxy injection, truncated response)
    // would otherwise render as empty queue data with no banner — the same
    // healthy-looking masking runGh already guards against. Record it so the
    // parse failure surfaces alongside gh invocation errors.
    ghErrors.push(`run list --repo ${repo} (malformed JSON: ${error.message})`);
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.filter((run) => new Date(run.created_at) >= cutoff);
}

function computeQueueLatency(runs) {
  const now = Date.now();
  return (
    runs
      // Keep runs that have a created_at; a run still waiting for a runner
      // has run_started_at: null — that is exactly the acute capacity signal
      // to surface, so measure its wait as now - created_at instead of
      // dropping it.
      .filter((r) => r.created_at)
      .map((r) => {
        const startMs = r.run_started_at
          ? new Date(r.run_started_at).getTime()
          : now;
        return {
          name: r.name,
          runId: r.databaseId,
          queueSeconds: Math.round(
            (startMs - new Date(r.created_at).getTime()) / 1000,
          ),
          stillQueued: !r.run_started_at,
        };
      })
      .sort((a, b) => b.queueSeconds - a.queueSeconds)
  );
}

// ── Formatting ───────────────────────────────────────────────

function formatText(
  pools,
  queueLatencies,
  queueThreshold,
  sinceLabel,
  errors = [],
) {
  const lines = [
    `## Runner health self-check (MNT-E08)`,
    '',
    `> Look-back: ${sinceLabel} | Queue alert threshold: ${queueThreshold}s`,
    '',
  ];

  // A failed gh call looks like empty data; lead with the failure banner so
  // the operator never reads empty pools as a clean bill of health.
  if (errors.length > 0) {
    lines.push('### ⚠️ gh call failures — report may be incomplete');
    lines.push('');
    for (const e of errors) {
      lines.push(`- \`${e}\``);
    }
    lines.push('');
    lines.push(
      '> Runner/queue data below may be missing because a `gh` invocation ' +
        'failed. Do not treat empty sections as healthy until gh succeeds.',
    );
    lines.push('');
  }

  // Runner pools
  const totalOnline = Object.values(pools).reduce((s, p) => s + p.online, 0);
  const totalOffline = Object.values(pools).reduce((s, p) => s + p.offline, 0);

  lines.push('### Runner pools');
  lines.push('');
  lines.push('| Pool | Online | Offline | Total |');
  lines.push('|------|--------|---------|-------|');
  for (const [key, pool] of Object.entries(pools)) {
    const label = pool.labels.length > 0 ? pool.labels.join(', ') : 'default';
    lines.push(
      `| ${label} | ${pool.online} | ${pool.offline} | ${pool.total} |`,
    );
  }
  lines.push(
    `| **Total** | **${totalOnline}** | **${totalOffline}** | **${totalOnline + totalOffline}** |`,
  );
  lines.push('');

  // Saturation check — all runners offline in any pool
  const saturatedPools = Object.entries(pools).filter(
    ([, pool]) => pool.total > 0 && pool.online === 0,
  );
  if (saturatedPools.length > 0) {
    lines.push('### ⚠️ Saturated pools (all runners offline)');
    lines.push('');
    for (const [key, pool] of saturatedPools) {
      const label = pool.labels.length > 0 ? pool.labels.join(', ') : 'default';
      lines.push(`- **${label}**: ${pool.total} runner(s), 0 online`);
    }
    lines.push('');
    lines.push(
      '> Saturated pools block all workflow execution. ' +
        'Investigate runner host health immediately.',
    );
    lines.push('');
  }

  // Queue latency
  lines.push('### Queue latency');
  lines.push('');
  if (queueLatencies.length === 0) {
    lines.push('_No queued runs in the look-back window._');
    lines.push('');
  } else {
    const maxLatency = queueLatencies[0].queueSeconds;
    const avgLatency = Math.round(
      queueLatencies.reduce((s, r) => s + r.queueSeconds, 0) /
        queueLatencies.length,
    );
    const alerting = queueLatencies.filter(
      (r) => r.queueSeconds >= queueThreshold,
    );
    const stillQueued = queueLatencies.filter((r) => r.stillQueued).length;

    const queuedNote =
      stillQueued > 0 ? ` (${stillQueued} still waiting for a runner)` : '';
    lines.push(
      `- Avg queue wait: **${avgLatency}s** | Max: **${maxLatency}s** (${queueLatencies.length} runs${queuedNote})`,
    );
    lines.push('');

    if (alerting.length > 0) {
      lines.push(`#### ⚠️ High-latency runs (≥${queueThreshold}s)`);
      lines.push('');
      lines.push('| Workflow | Run ID | Queue wait |');
      lines.push('|----------|--------|------------|');
      for (const r of alerting.slice(0, 10)) {
        const marker = r.stillQueued ? ' (queued)' : '';
        lines.push(`| ${r.name} | ${r.runId} | ${r.queueSeconds}s${marker} |`);
      }
      if (alerting.length > 10) {
        lines.push(`| ... and ${alerting.length - 10} more | | |`);
      }
      lines.push('');
      lines.push(
        '> High queue latency signals runner-capacity pressure. ' +
          'Consider scaling the pool or rescheduling non-critical workflows.',
      );
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────

function main() {
  const repo =
    getArg('--repo') ||
    process.env.GH_REPO ||
    process.env.GITHUB_REPOSITORY ||
    '';
  const since = getArg('--since') || DEFAULT_SINCE;
  const queueThreshold = parseInt(
    getArg('--queue-threshold') ?? String(DEFAULT_QUEUE_THRESHOLD),
    10,
  );
  const jsonMode = process.argv.includes('--json');

  if (!repo) {
    process.stderr.write(
      'Error: --repo or GH_REPO env required. Usage: node runner-health-check.cjs --repo owner/repo\n',
    );
    process.exit(1);
  }

  // Collect data
  const runners = getRunners(repo);
  const pools = getRunnerPools(runners);
  const recentRuns = getRecentRuns(repo, since);
  const queueLatencies = computeQueueLatency(recentRuns);

  if (jsonMode) {
    console.log(
      JSON.stringify(
        { runners, pools, queueLatencies, queueThreshold, ghErrors },
        null,
        2,
      ),
    );
  } else {
    console.log(
      formatText(pools, queueLatencies, queueThreshold, since, ghErrors),
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getRunnerPools,
  computeQueueLatency,
  parseSince,
  formatText,
};
