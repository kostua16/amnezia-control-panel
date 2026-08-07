#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

'use strict';

// Fleet KPI digest — MNT-E03
// Queries gh API for fleet automation activity in a time window and
// upserts a single tracking issue so output is reviewable at a glance.
//
// Usage:
//   fleet-kpi-digest.cjs --repo owner/repo [--window-hours 12] [--dry-run]
//
// The script is designed to be called from the maintenance workflow (or
// manually) and does NOT push or open PRs — it only reads via `gh api`
// and creates/updates one digest issue.

const { execFileSync } = require('child_process');
const { escapeTableCell } = require('./md-escape.cjs');

const DIGEST_TITLE_PREFIX = 'Fleet KPI Digest';
const DIGEST_LABELS = ['auto-fix', 'observability'];
const ISSUE_SEARCH_MARKER = `${DIGEST_TITLE_PREFIX} in:title`;

// Known fleet bot logins — PRs/issues from these count as fleet activity.
const FLEET_ACTORS = [
  'claude[bot]',
  'dependabot[bot]',
  'github-actions[bot]',
  'deepseek-automation[bot]',
];

function parseArgs(argv) {
  const args = {};
  let i = 2;
  while (i < argv.length) {
    const flag = argv[i];
    if (
      flag === '--repo' ||
      flag === '--window-hours' ||
      flag === '--github-output'
    ) {
      args[flag.slice(2)] = argv[i + 1] || '';
      i += 2;
    } else if (flag === '--dry-run') {
      args['dry-run'] = true;
      i += 1;
    } else {
      i++;
    }
  }
  return args;
}

function runGh(args, options = {}) {
  const stdio = ['ignore', 'pipe', 'pipe'];
  try {
    return (
      execFileSync('gh', args, {
        encoding: 'utf8',
        stdio,
        ...options,
      }) ?? ''
    ).trim();
  } catch (error) {
    if (options.allowFailure) return '';
    throw error;
  }
}

// `gh api`/`gh search` invoked with a streaming `--jq` (`.[] | {...}` or
// `.workflow_runs[] | {...}`) emit newline-delimited JSON objects — one per
// match, concatenated across `--paginate` pages — NOT a single JSON document.
// A single bulk JSON.parse therefore throws on the second object, which is why
// every multi-result query silently collapsed to its empty fallback. Parse each
// non-empty line instead so multi-result responses survive.
function parseGhJsonLines(output, fallback = []) {
  if (!output) return fallback;
  const items = [];
  const failures = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed));
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (failures.length > 0) {
    // Surface parse failures instead of silently reporting empty results;
    // unparseable output usually means gh returned an error page.
    process.stderr.write(
      `Warning: ${failures.length} unparseable JSON line(s) from gh (first: ${failures[0]})\n`,
    );
  }
  return items.length > 0 ? items : fallback;
}

function runGhJson(args, fallback = []) {
  const output = runGh(args, { allowFailure: true });
  return parseGhJsonLines(output, fallback);
}

function formatIsoLocal(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, '');
}

function windowBounds(hours) {
  const now = new Date();
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000);
  return { since: formatIsoLocal(since), until: formatIsoLocal(now), now };
}

function queryFleetPrs(repo, since, until) {
  // Search PRs updated in the window by fleet actors.
  const items = [];
  for (const actor of FLEET_ACTORS) {
    const results = runGhJson([
      'api',
      `-XGET`,
      `repos/${repo}/pulls`,
      `--method`,
      'GET',
      `-f`,
      `state=all`,
      `-f`,
      `sort=updated`,
      `-f`,
      `direction=desc`,
      `-f`,
      `per_page=50`,
      '--paginate',
      '--jq',
      // `head` filters by source branch ref, not author — fleet bots author
      // PRs from this repo, so filter by .user.login client-side instead.
      `.[] | select(.user.login == "${actor}") | {number, title, state, merged_at, created_at, updated_at, user: .user.login, head_ref: .head.ref}`,
    ]);
    for (const pr of results) {
      const updated = pr.updated_at || pr.created_at || '';
      if (updated >= since && updated < until) {
        items.push(pr);
      }
    }
  }
  return items;
}

function queryFleetIssues(repo, since) {
  // Search issues (non-PR) created or closed in the window.
  // No `until` bound: `created:>=`/`closed:>=` are naturally bounded by now.
  // `gh search issues --json` returns a top-level array and only accepts
  // camelCase field names (createdAt/author) — snake_case names make gh exit
  // non-zero, and `.items[]` errors because the response is an array, not an
  // object. Stream with `.[]` so the NDJSON parser in runGhJson collects rows.
  // Pass repo/state via gh flags and keep `is:issue` + the date window as
  // separate positional qualifiers: a single positional containing
  // `repo:X is:issue ...` is parsed as one quoted repo value and rejected, so
  // the issue section would otherwise always come back empty.
  const created = runGhJson([
    'search',
    'issues',
    '--repo',
    repo,
    '--state',
    'open',
    'is:issue',
    `created:>=${since}`,
    '--json',
    'number,title,state,createdAt,author',
    '--jq',
    '.[]',
    '--limit',
    '50',
  ]);
  const closed = runGhJson([
    'search',
    'issues',
    '--repo',
    repo,
    '--state',
    'closed',
    'is:issue',
    `closed:>=${since}`,
    '--json',
    'number,title,state,createdAt,closedAt,author',
    '--jq',
    '.[]',
    '--limit',
    '50',
  ]);
  const merged = new Set();
  const items = [];
  for (const issue of created) {
    items.push({ ...issue, event: 'opened' });
  }
  for (const issue of closed) {
    const key = issue.number;
    if (!merged.has(key)) {
      merged.add(key);
      items.push({ ...issue, event: 'closed' });
    }
  }
  return items;
}

function queryGateSkips(repo, since) {
  // Workflow runs with conclusion=skipped since the window start.
  const runs = runGhJson([
    'api',
    `repos/${repo}/actions/runs`,
    `-f`,
    `status=completed`,
    `-f`,
    `per_page=50`,
    '--paginate',
    '--jq',
    '.workflow_runs[] | select(.conclusion == "skipped") | {id, name, created_at, updated_at, conclusion}',
  ]);
  return runs.filter((r) => (r.updated_at || r.created_at || '') >= since);
}

function classifyPr(pr) {
  if (pr.state === 'closed' && pr.merged_at) return 'merged';
  if (pr.state === 'closed') return 'closed';
  return 'opened';
}

function renderDigestBody(data, windowLabel) {
  const lines = [
    `## ${DIGEST_TITLE_PREFIX} — ${windowLabel}`,
    '',
    `> Auto-generated by fleet KPI digest (MNT-E03)`,
    '',
  ];

  // PR summary
  const prByCategory = { opened: [], merged: [], closed: [] };
  for (const pr of data.prs) {
    prByCategory[classifyPr(pr)].push(pr);
  }
  lines.push('### Pull Requests (fleet)');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Opened | ${prByCategory.opened.length} |`);
  lines.push(`| Merged | ${prByCategory.merged.length} |`);
  lines.push(`| Closed (not merged) | ${prByCategory.closed.length} |`);
  lines.push('');

  if (data.prs.length > 0) {
    lines.push('| # | Title | Author | Status |');
    lines.push('|---|-------|--------|--------|');
    const sorted = [...data.prs].sort((a, b) => a.number - b.number);
    for (const pr of sorted) {
      const status = classifyPr(pr);
      const title = escapeTableCell(pr.title || '-');
      const author = escapeTableCell(pr.user || '-');
      lines.push(`| #${pr.number} | ${title} | ${author} | ${status} |`);
    }
    lines.push('');
  }

  // Issue summary
  const issuesOpened = data.issues.filter((i) => i.event === 'opened');
  const issuesClosed = data.issues.filter((i) => i.event === 'closed');
  lines.push('### Issues');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Opened | ${issuesOpened.length} |`);
  lines.push(`| Closed | ${issuesClosed.length} |`);
  lines.push('');

  if (data.issues.length > 0) {
    lines.push('| # | Title | Event |');
    lines.push('|---|-------|-------|');
    const sorted = [...data.issues].sort((a, b) => a.number - b.number);
    for (const issue of sorted) {
      const title = escapeTableCell(issue.title || '-');
      lines.push(`| #${issue.number} | ${title} | ${issue.event} |`);
    }
    lines.push('');
  }

  // Gate skips
  lines.push('### Gate Skips (conclusion=skipped)');
  lines.push('');
  if (data.gateSkips.length > 0) {
    lines.push('| Run ID | Workflow | Time |');
    lines.push('|--------|----------|------|');
    for (const run of data.gateSkips) {
      const time = run.updated_at || run.created_at || '-';
      lines.push(
        `| ${run.id} | ${escapeTableCell(run.name || '-')} | ${time} |`,
      );
    }
    lines.push('');
    lines.push(
      `**${data.gateSkips.length} workflow run(s) skipped in this window.**`,
    );
  } else {
    lines.push('_No gate skips in this window._');
  }
  lines.push('');

  return lines.join('\n');
}

function findExistingIssue(repo) {
  try {
    const out = runGh(
      [
        'issue',
        'list',
        '--repo',
        repo,
        '--state',
        'open',
        '--search',
        ISSUE_SEARCH_MARKER,
        '--json',
        'number',
        '--jq',
        '.[0].number // empty',
      ],
      { allowFailure: true },
    );
    const num = parseInt(out, 10);
    return Number.isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:00 UTC`;
}

async function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo || process.env.GITHUB_REPOSITORY;
  if (!repo) {
    process.stderr.write('Error: --repo or GITHUB_REPOSITORY is required\n');
    process.exit(1);
  }

  const windowHours = parseInt(args['window-hours'] || '12', 10) || 12;
  const dryRun = args['dry-run'] === true;
  const { since, until, now } = windowBounds(windowHours);
  const windowLabel = `${formatDate(new Date(since))} – ${formatDate(now)}`;

  // Collect data
  const prs = queryFleetPrs(repo, since, until);
  const issues = queryFleetIssues(repo, since);
  const gateSkips = queryGateSkips(repo, since);

  const data = { prs, issues, gateSkips };
  const body = renderDigestBody(data, windowLabel);

  if (dryRun) {
    process.stdout.write(`=== DRY RUN — ${windowLabel} ===\n\n`);
    process.stdout.write(body);
    process.stdout.write('\n');
    process.exit(0);
  }

  // Upsert digest issue
  const title = `${DIGEST_TITLE_PREFIX} — ${formatDate(now)}`;
  const existing = findExistingIssue(repo);

  if (existing != null) {
    runGh(
      [
        'issue',
        'edit',
        String(existing),
        '--repo',
        repo,
        '--title',
        title,
        '--body-file',
        '-',
      ],
      { input: body },
    );
    process.stdout.write(
      `Refreshed digest issue #${existing} (${prs.length} PRs, ${issues.length} issues, ${gateSkips.length} gate skips).\n`,
    );
  } else {
    runGh(
      [
        'issue',
        'create',
        '--repo',
        repo,
        '--title',
        title,
        '--body',
        body,
        '--label',
        DIGEST_LABELS.join(','),
      ],
      { input: '' },
    );
    process.stdout.write(
      `Created digest issue (${prs.length} PRs, ${issues.length} issues, ${gateSkips.length} gate skips).\n`,
    );
  }

  // Emit structured outputs for the workflow
  const output = args['github-output'];
  if (output) {
    const fs = require('fs');
    const lines = [
      `pr_count=${prs.length}`,
      `issue_count=${issues.length}`,
      `gate_skip_count=${gateSkips.length}`,
    ];
    fs.appendFileSync(output, lines.join('\n') + '\n');
  }
}

module.exports = {
  parseArgs,
  classifyPr,
  windowBounds,
  renderDigestBody,
  parseGhJsonLines,
  FLEET_ACTORS,
  DIGEST_TITLE_PREFIX,
  DIGEST_LABELS,
  ISSUE_SEARCH_MARKER,
  formatDate,
};

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
  });
}
