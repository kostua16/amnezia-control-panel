#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

'use strict';

// Weekly cost/turn digest — WHO-E05
// Aggregates Claude agent cost and turn metrics per workflow for a time window
// and upserts a single tracking issue, so MAX_TURNS budgets can be tuned from
// fleet-wide numbers instead of the per-run figures embedded in failure issues.
//
// Usage:
//   build-cost-turn-digest.cjs --repo owner/repo [--window-days 7]
//     [--max-runs 100] [--workflows-dir DIR] [--actions-dir DIR]
//     [--dry-run] [--github-output FILE]
//
// Metrics come from the job logs of workflows that run a Claude agent action
// and are read with the same parser those actions use to build
// `claude_metrics_json`. The script only reads via `gh api` and creates or
// updates one digest issue; it does not push or open PRs.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { escapeTableCell } = require('./md-escape.cjs');
const { parseClaudeExecution } = require('./parse-claude-execution.cjs');
const { parseGhJsonLines } = require('./fleet-kpi-digest.cjs');

const DIGEST_TITLE_PREFIX = 'Weekly Cost/Turn Digest';
const DIGEST_LABELS = ['auto-fix', 'observability'];
const ISSUE_SEARCH_MARKER = `${DIGEST_TITLE_PREFIX} in:title`;
const DIGEST_BODY_MARKER = 'weekly-cost-turn-digest';

// Local composite actions that export `claude_metrics_json`.
const CLAUDE_ACTION_NAMES = [
  'run-zai',
  'run-claude',
  'run-claude-params',
  'run-deepseek',
];
const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_MAX_RUNS = 100;
// SDK result metrics sit at the end of the agent step; parsing only the tail
// keeps multi-megabyte job logs cheap.
const MAX_LOG_TAIL_BYTES = 8 * 1024 * 1024;
const MAX_LOG_BUFFER_BYTES = 64 * 1024 * 1024;
// A workflow run rarely has more than a couple of agent jobs; the rest are
// gates and reports whose logs cannot hold agent metrics.
const MAX_JOBS_PER_RUN = 6;
// An agent run is flagged when its average turns reach this share of the
// workflow's MAX_TURNS, or its average cost exceeds this many dollars.
const BUDGET_PRESSURE_RATIO = 0.8;
const HIGH_COST_PER_RUN_USD = 1;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    // Keys keep their kebab-case spelling so `--window-days` is read as
    // `args['window-days']`; camel-casing here silently dropped every flag.
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] =
      next === undefined || next.startsWith('--') ? 'true' : argv[++i];
  }
  return args;
}

// Returns null when the command fails and `allowFailure` is set, so callers
// can tell a failed call from an empty response.
function runGh(args, options = {}) {
  try {
    const output = execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: MAX_LOG_BUFFER_BYTES,
    });
    const text = String(output ?? '');
    return options.raw ? text : text.trim();
  } catch (error) {
    if (!options.allowFailure) throw error;
    if (options.onError) options.onError(error);
    return null;
  }
}

function isNotFound(error) {
  const output = [error?.stderr, error?.stdout, error?.message]
    .filter(Boolean)
    .join('\n');
  return (
    /\bHTTP 404\b/.test(output) ||
    /"status"\s*:\s*"?404"?/.test(output) ||
    /Not Found/.test(output)
  );
}

function formatIso(date) {
  return date.toISOString();
}

function formatWindow(date) {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function windowBounds(days, now = new Date()) {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { since: formatIso(since), until: formatIso(now), now };
}

function tailBytes(text, maxBytes) {
  const value = String(text || '');
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length <= maxBytes) return value;
  const tail = buffer.subarray(buffer.length - maxBytes).toString('utf8');
  // Drop the first line: it may have been cut mid multi-byte character.
  const newline = tail.indexOf('\n');
  return newline >= 0 ? tail.slice(newline + 1) : tail;
}

function extractJobMetrics(logText) {
  const metrics = parseClaudeExecution({
    logText: tailBytes(logText, MAX_LOG_TAIL_BYTES),
  });
  if (metrics.totalCostUsd === null && metrics.numTurns === null) return null;
  return {
    costUsd: metrics.totalCostUsd ?? 0,
    turns: metrics.numTurns ?? 0,
    isError: metrics.isError === true,
    model: metrics.modelUsed || '',
  };
}

function claudeActionNames(actionFiles) {
  const names = new Set(CLAUDE_ACTION_NAMES);
  const pattern = /\.\/\.github\/actions\/([A-Za-z0-9_-]+)/g;
  // A composite action can wrap an agent action, so grow the set until no
  // wrapper references an action outside of it.
  let grew = true;
  while (grew) {
    grew = false;
    for (const file of actionFiles) {
      if (names.has(file.name)) continue;
      const used = [...String(file.content).matchAll(pattern)].map(
        (match) => match[1],
      );
      if (used.some((name) => names.has(name))) {
        names.add(file.name);
        grew = true;
      }
    }
  }
  return names;
}

function parseMaxTurns(content) {
  const match = String(content || '').match(
    /(?:MAX_TURNS|max-turns):\s*'?(\d+)'?/,
  );
  return match ? Number(match[1]) : null;
}

function workflowDisplayName(content, fallback) {
  const match = String(content || '').match(/^name:\s*(.+?)\s*$/m);
  if (!match) return fallback;
  return match[1].replace(/^['"]|['"]$/g, '').trim() || fallback;
}

function findClaudeWorkflows(workflowFiles, actionFiles) {
  const names = claudeActionNames(actionFiles);
  const pattern = /\.\/\.github\/actions\/([A-Za-z0-9_-]+)/g;
  const workflows = [];
  for (const file of workflowFiles) {
    const content = String(file.content || '');
    const used = [...content.matchAll(pattern)].map((match) => match[1]);
    if (!used.some((name) => names.has(name))) continue;
    workflows.push({
      file: file.name,
      name: workflowDisplayName(content, file.name),
      maxTurnsBudget: parseMaxTurns(content),
    });
  }
  return workflows.sort((a, b) => a.file.localeCompare(b.file));
}

function readYamlFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map((name) => ({
      name,
      content: fs.readFileSync(path.join(dir, name), 'utf8'),
    }));
}

function readActionFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name, 'action.yml'))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({
      name: path.basename(path.dirname(file)),
      content: fs.readFileSync(file, 'utf8'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function queryWorkflowRuns({ repo, file, since, until, limit }, runGhFn) {
  const endpoint = `repos/${repo}/actions/workflows/${file}/runs`;
  // -X GET is required: -f alone makes gh POST, and the runs endpoints
  // answer 404 to POST.
  const filters = [
    '-f',
    `created=${since}..${until}`,
    '-f',
    'status=completed',
  ];
  const count = runGhFn([
    'api',
    '-X',
    'GET',
    endpoint,
    ...filters,
    '-f',
    'per_page=1',
    '--jq',
    '.total_count',
  ]);
  const total = count ? Number(count) : NaN;
  // An unreadable count means the API call failed; never report it as zero.
  if (!Number.isFinite(total)) {
    throw new Error(`Could not read completed run count for ${file}`);
  }
  const output =
    total === 0
      ? ''
      : runGhFn([
          'api',
          '-X',
          'GET',
          endpoint,
          ...filters,
          '-f',
          `per_page=${limit}`,
          '--jq',
          '.workflow_runs[] | {id}',
        ]);
  return { total, items: parseGhJsonLines(output ?? '', []) };
}

function createStats() {
  return {
    agentJobs: 0,
    costUsd: 0,
    turns: 0,
    errors: 0,
    maxTurns: 0,
    models: {},
  };
}

function addRecord(stats, record) {
  stats.agentJobs += 1;
  stats.costUsd += record.costUsd;
  stats.turns += record.turns;
  stats.maxTurns = Math.max(stats.maxTurns, record.turns);
  if (record.isError) stats.errors += 1;
  const model = record.model || 'unknown';
  stats.models[model] = (stats.models[model] || 0) + 1;
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function round(value, digits = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function collectDigestData(options) {
  const { repo, since, until, maxRuns, runGhFn = runGh } = options;
  const workflows = findClaudeWorkflows(
    readYamlFiles(options.workflowsDir),
    readActionFiles(options.actionsDir),
  );
  if (workflows.length === 0) {
    throw new Error('No Claude-powered workflows found to digest');
  }

  // Sample the same number of newest runs from every workflow so one busy
  // workflow cannot use up the whole budget.
  const limit = Math.max(1, Math.floor(maxRuns / workflows.length));
  const totals = createStats();
  Object.assign(totals, {
    totalRuns: 0,
    sampledRuns: 0,
    missingJobs: 0,
    fetchErrors: 0,
  });
  const rows = [];

  for (const workflow of workflows) {
    const runs = queryWorkflowRuns(
      { repo, file: workflow.file, since, until, limit },
      runGhFn,
    );
    totals.totalRuns += runs.total;
    const stats = createStats();

    for (const run of runs.items) {
      const jobsOutput = runGhFn(
        [
          'api',
          '-X',
          'GET',
          `repos/${repo}/actions/runs/${run.id}/jobs`,
          '-f',
          'per_page=100',
          '--jq',
          '.jobs[] | {id, conclusion}',
        ],
        { allowFailure: true },
      );
      // A run whose jobs cannot be listed is not a sample; count it as a
      // failed fetch instead of a zero-cost run.
      if (jobsOutput === null) {
        totals.fetchErrors += 1;
        continue;
      }
      totals.sampledRuns += 1;
      const jobs = parseGhJsonLines(jobsOutput, [])
        .filter((job) => job.conclusion !== 'skipped')
        .slice(0, MAX_JOBS_PER_RUN);

      for (const job of jobs) {
        let notFound = false;
        let failed = false;
        const log = runGhFn(
          ['api', `repos/${repo}/actions/jobs/${job.id}/logs`],
          {
            allowFailure: true,
            raw: true,
            onError: (error) => {
              if (isNotFound(error)) notFound = true;
              else failed = true;
            },
          },
        );
        const record = log === null ? null : extractJobMetrics(log);
        if (record) {
          addRecord(stats, record);
          addRecord(totals, record);
        } else if (failed) {
          totals.fetchErrors += 1;
        } else {
          // No agent metrics in the log, or the log was purged: missing,
          // never zero-cost.
          totals.missingJobs += 1;
        }
        void notFound;
      }
    }

    rows.push({
      ...workflow,
      totalRuns: runs.total,
      sampledRuns: runs.items.length,
      ...stats,
      models: { ...stats.models },
      avgCostPerRun: round(divide(stats.costUsd, stats.agentJobs), 4),
      avgTurnsPerRun: round(divide(stats.turns, stats.agentJobs), 1),
      costPerTurn: round(divide(stats.costUsd, stats.turns), 4),
      estCostUsd: round(
        (divide(stats.costUsd, runs.items.length) ?? 0) * runs.total,
      ),
    });
  }

  rows.sort((a, b) => b.costUsd - a.costUsd || a.file.localeCompare(b.file));
  totals.estCostUsd = round(
    (divide(totals.costUsd, totals.sampledRuns) ?? 0) * totals.totalRuns,
  );

  return { workflows, totals, rows };
}

function formatUsd(value, digits = 2) {
  if (value === null || value === undefined) return '-';
  return `$${value.toFixed(digits)}`;
}

function formatPercent(part, whole) {
  return whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '-';
}

function formatModels(models) {
  const entries = Object.entries(models || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '-';
  return entries
    .map(([model, count]) => `${escapeTableCell(model)} ×${count}`)
    .join(', ');
}

function buildBudgetNotes(rows) {
  const notes = [];
  for (const row of rows) {
    if (row.agentJobs === 0) continue;
    const label = `\`${row.file}\``;
    if (
      row.maxTurnsBudget &&
      row.avgTurnsPerRun >= BUDGET_PRESSURE_RATIO * row.maxTurnsBudget
    ) {
      const share = Math.round((row.avgTurnsPerRun / row.maxTurnsBudget) * 100);
      const peak =
        row.maxTurns >= row.maxTurnsBudget
          ? `; peak ${row.maxTurns} hits the cap`
          : '';
      notes.push(
        `- **${label}**: avg ${row.avgTurnsPerRun} turns per agent run is ${share}% of MAX_TURNS (${row.maxTurnsBudget})${peak}.`,
      );
    }
    if (row.avgCostPerRun >= HIGH_COST_PER_RUN_USD) {
      notes.push(
        `- **${label}**: avg ${formatUsd(row.avgCostPerRun)} per agent run exceeds ${formatUsd(HIGH_COST_PER_RUN_USD)}/run.`,
      );
    }
  }
  return notes;
}

function renderDigestBody(data, windowLabel) {
  const { totals, rows, workflows } = data;
  const lines = [
    `<!-- ${DIGEST_BODY_MARKER} -->`,
    '',
    `## ${DIGEST_TITLE_PREFIX} — ${windowLabel}`,
    '',
    '> Auto-generated by the weekly cost/turn digest (WHO-E05). Cost and turn figures come from agent job logs, read with the `claude_metrics_json` parser.',
    '',
    '### Fleet',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Claude-powered workflows | ${workflows.length} |`,
    `| Agent workflow runs completed | ${totals.totalRuns} |`,
    `| Workflow runs sampled | ${totals.sampledRuns} (${formatPercent(totals.sampledRuns, totals.totalRuns)}) |`,
    `| Agent runs with metrics | ${totals.agentJobs} |`,
    `| Sampled cost | ${formatUsd(round(totals.costUsd))} |`,
    `| Estimated weekly cost | ${formatUsd(totals.estCostUsd)} |`,
    `| Avg cost / agent run | ${formatUsd(round(divide(totals.costUsd, totals.agentJobs), 4), 4)} |`,
    `| Avg turns / agent run | ${round(divide(totals.turns, totals.agentJobs), 1) ?? '-'} |`,
    `| Avg cost / turn | ${formatUsd(round(divide(totals.costUsd, totals.turns), 4), 4)} |`,
    `| Agent runs with \`is_error\` | ${totals.errors} |`,
    `| Models (agent runs) | ${formatModels(totals.models)} |`,
    '',
    'Averages are exact for the sampled runs. The weekly estimate scales the sampled cost per run by all completed runs.',
    '',
    '### Per workflow',
    '',
    '| Workflow | Runs | Sampled | Agent runs | Cost (sampled) | Est. weekly | Avg $/run | Avg turns | Peak turns | MAX_TURNS | $/turn | Errors |',
    '|----------|------|---------|------------|----------------|-------------|-----------|-----------|------------|-----------|-------|--------|',
  ];
  for (const row of rows) {
    lines.push(
      `| \`${escapeTableCell(row.file)}\` | ${row.totalRuns} | ${row.sampledRuns} | ${row.agentJobs} | ${formatUsd(round(row.costUsd))} | ${formatUsd(row.estCostUsd)} | ${formatUsd(row.avgCostPerRun, 4)} | ${row.avgTurnsPerRun ?? '-'} | ${row.maxTurns} | ${row.maxTurnsBudget ?? '-'} | ${formatUsd(row.costPerTurn, 4)} | ${row.errors} |`,
    );
  }
  lines.push('', '### Budget tuning notes', '');
  const notes = buildBudgetNotes(rows);
  if (notes.length === 0) {
    lines.push(
      `_No sampled agent run averages ${BUDGET_PRESSURE_RATIO * 100}% of its workflow's MAX_TURNS or ${formatUsd(HIGH_COST_PER_RUN_USD)} per run._`,
    );
  } else {
    lines.push(...notes);
  }
  const idle = rows.filter((row) => row.totalRuns === 0);
  lines.push('', '### Coverage', '');
  lines.push(
    `- Sampled up to ${Math.max(1, Math.floor(data.maxRuns / workflows.length))} newest completed runs per workflow.`,
  );
  if (idle.length > 0) {
    lines.push(
      `- ${idle.length} workflow(s) had no completed runs: ${idle.map((row) => `\`${row.file}\``).join(', ')}.`,
    );
  }
  lines.push(
    `- ${totals.missingJobs} job log(s) held no agent metrics or were no longer available; they are counted as missing, not as zero-cost.`,
  );
  if (totals.fetchErrors > 0) {
    lines.push(
      `- **${totals.fetchErrors} API call(s) failed; this digest is partial.**`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function findExistingIssue(repo, runGhFn = runGh) {
  const output = runGhFn(
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
  const number = parseInt(output ?? '', 10);
  return Number.isNaN(number) ? null : number;
}

function upsertDigestIssue({ repo, title, body }, runGhFn = runGh) {
  const existing = findExistingIssue(repo, runGhFn);
  // The title search is token-based and can match unrelated issues (such as
  // the backlog issue that requested this digest), so only an issue carrying
  // the digest marker may be edited.
  const existingBody =
    existing == null
      ? ''
      : runGhFn(
          [
            'issue',
            'view',
            String(existing),
            '--repo',
            repo,
            '--json',
            'body',
            '--jq',
            '.body',
          ],
          { allowFailure: true },
        );
  if (
    existing != null &&
    String(existingBody || '').includes(DIGEST_BODY_MARKER)
  ) {
    runGhFn([
      'issue',
      'edit',
      String(existing),
      '--repo',
      repo,
      '--title',
      title,
      '--body',
      body,
    ]);
    return { action: 'updated', number: existing };
  }
  runGhFn([
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
  ]);
  return { action: 'created', number: null };
}

function appendOutput(outputPath, lines) {
  const delimiter = `EOF-${process.pid}-${lines.length}`;
  fs.appendFileSync(
    outputPath,
    lines
      .map(([key, value]) => `${key}<<${delimiter}\n${value}\n${delimiter}\n`)
      .join(''),
  );
}

function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo || process.env.GITHUB_REPOSITORY;
  if (!repo) {
    process.stderr.write('Error: --repo or GITHUB_REPOSITORY is required\n');
    process.exit(1);
  }

  const windowDays =
    parseInt(args['window-days'] || '', 10) || DEFAULT_WINDOW_DAYS;
  const maxRuns = parseInt(args['max-runs'] || '', 10) || DEFAULT_MAX_RUNS;
  const { since, until, now } = windowBounds(windowDays);
  const windowLabel = `${formatWindow(new Date(since))} – ${formatWindow(now)}`;

  const data = collectDigestData({
    repo,
    since,
    until,
    maxRuns,
    workflowsDir: args['workflows-dir'] || path.join(__dirname, '..'),
    actionsDir:
      args['actions-dir'] || path.join(__dirname, '..', '..', 'actions'),
  });
  data.maxRuns = maxRuns;
  const body = renderDigestBody(data, windowLabel);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
  }

  if (args['dry-run'] === 'true') {
    process.stdout.write(`${body}\n`);
    return;
  }

  // Sampled runs without a single agent metric mean log extraction is
  // broken; never publish that as a zero-cost week.
  if (data.totals.sampledRuns > 0 && data.totals.agentJobs === 0) {
    throw new Error(
      `No agent metrics found in ${data.totals.sampledRuns} sampled run(s)`,
    );
  }

  const issue = upsertDigestIssue({
    repo,
    title: `${DIGEST_TITLE_PREFIX} — ${formatWindow(now)}`,
    body,
  });
  process.stdout.write(
    `${issue.action === 'updated' ? `Refreshed` : `Created`} digest issue` +
      `${issue.number != null ? ` #${issue.number}` : ''} ` +
      `(${data.totals.sampledRuns} of ${data.totals.totalRuns} runs sampled, ` +
      `${formatUsd(round(data.totals.costUsd))} sampled cost).\n`,
  );

  if (args['github-output']) {
    appendOutput(args['github-output'], [
      ['digest_issue_action', issue.action],
      ['digest_issue_number', issue.number ?? ''],
      ['run_count', data.totals.totalRuns],
      ['sampled_run_count', data.totals.sampledRuns],
      ['agent_run_count', data.totals.agentJobs],
      ['sampled_cost_usd', round(data.totals.costUsd, 4) ?? 0],
      ['est_weekly_cost_usd', data.totals.estCostUsd ?? 0],
      ['missing_metrics_jobs', data.totals.missingJobs],
      ['fetch_error_count', data.totals.fetchErrors],
    ]);
  }
}

module.exports = {
  BUDGET_PRESSURE_RATIO,
  CLAUDE_ACTION_NAMES,
  DEFAULT_MAX_RUNS,
  DEFAULT_WINDOW_DAYS,
  DIGEST_LABELS,
  DIGEST_TITLE_PREFIX,
  HIGH_COST_PER_RUN_USD,
  ISSUE_SEARCH_MARKER,
  buildBudgetNotes,
  claudeActionNames,
  collectDigestData,
  extractJobMetrics,
  findClaudeWorkflows,
  findExistingIssue,
  isNotFound,
  parseArgs,
  parseMaxTurns,
  queryWorkflowRuns,
  renderDigestBody,
  tailBytes,
  upsertDigestIssue,
  windowBounds,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Fatal: ${error.message}\n`);
    process.exit(1);
  }
}
