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

const DEFAULT_SINCE = '6h';
const DEFAULT_QUEUE_THRESHOLD = 300;

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
  } catch {
    return null;
  }
}

function ghJson(...args) {
  const out = runGh(args);
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

// ── Parse duration ────────────────────────────────────────────

function parseSince(duration) {
  const match = duration.match(/^(\d+)([dhm])$/);
  if (!match) return new Date(Date.now() - 6 * 3600000);
  const n = parseInt(match[1], 10);
  const multipliers = { h: 3600000, d: 86400000, m: 60000 };
  return new Date(Date.now() - n * (multipliers[match[2]] || 3600000));
}

// ── Runner status ────────────────────────────────────────────

function getRunners(repo) {
  const data = ghJson(
    'api',
    `repos/${repo}/actions/runners`,
    '-f',
    'per_page=100',
    '--paginate',
    '--jq',
    '.runners[] | {id, name, status, labels: [.labels[].name]}',
  );
  if (!Array.isArray(data)) return [];

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
    const poolKey = poolLabels.length > 0 ? poolLabels.sort().join(',') : 'default';
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
  const data = ghJson(
    'run',
    'list',
    '--repo',
    repo,
    '--limit',
    '50',
    '--json',
    'run_started_at,created_at,status,conclusion,name,databaseId',
  );
  if (!Array.isArray(data)) return [];

  const cutoff = parseSince(since);
  return data.filter((run) => {
    const created = new Date(run.created_at);
    return created >= cutoff;
  });
}

function computeQueueLatency(runs) {
  return runs
    .filter((r) => r.created_at && r.run_started_at)
    .map((r) => ({
      name: r.name,
      runId: r.databaseId,
      queueSeconds: Math.round(
        (new Date(r.run_started_at) - new Date(r.created_at)) / 1000,
      ),
    }))
    .sort((a, b) => b.queueSeconds - a.queueSeconds);
}

// ── Formatting ───────────────────────────────────────────────

function formatText(pools, queueLatencies, queueThreshold, sinceLabel) {
  const lines = [
    `## Runner health self-check (MNT-E08)`,
    '',
    `> Look-back: ${sinceLabel} | Queue alert threshold: ${queueThreshold}s`,
    '',
  ];

  // Runner pools
  const totalOnline = Object.values(pools).reduce((s, p) => s + p.online, 0);
  const totalOffline = Object.values(pools).reduce((s, p) => s + p.offline, 0);

  lines.push('### Runner pools');
  lines.push('');
  lines.push('| Pool | Online | Offline | Total |');
  lines.push('|------|--------|---------|-------|');
  for (const [key, pool] of Object.entries(pools)) {
    const label = pool.labels.length > 0 ? pool.labels.join(', ') : 'default';
    lines.push(`| ${label} | ${pool.online} | ${pool.offline} | ${pool.total} |`);
  }
  lines.push(`| **Total** | **${totalOnline}** | **${totalOffline}** | **${totalOnline + totalOffline}** |`);
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
      queueLatencies.reduce((s, r) => s + r.queueSeconds, 0) / queueLatencies.length,
    );
    const alerting = queueLatencies.filter((r) => r.queueSeconds >= queueThreshold);

    lines.push(
      `- Avg queue wait: **${avgLatency}s** | Max: **${maxLatency}s** (${queueLatencies.length} runs)`,
    );
    lines.push('');

    if (alerting.length > 0) {
      lines.push(`#### ⚠️ High-latency runs (≥${queueThreshold}s)`);
      lines.push('');
      lines.push('| Workflow | Run ID | Queue wait |');
      lines.push('|----------|--------|------------|');
      for (const r of alerting.slice(0, 10)) {
        lines.push(`| ${r.name} | ${r.runId} | ${r.queueSeconds}s |`);
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
      JSON.stringify({ runners, pools, queueLatencies, queueThreshold }, null, 2),
    );
  } else {
    console.log(formatText(pools, queueLatencies, queueThreshold, since));
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
