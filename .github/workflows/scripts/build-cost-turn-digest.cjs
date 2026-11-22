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
const { parseGhJsonLines } = require('./fleet-kpi-digest.cjs');

const DIGEST_TITLE_PREFIX = 'Weekly Cost/Turn Digest';
const DIGEST_LABELS = ['auto-fix', 'observability'];
const DIGEST_BODY_MARKER = 'weekly-cost-turn-digest';
// Search the body marker, not the title: failure-report issues also carry the
// digest title tokens and can push the marker-bearing digest past the search
// page, silently forking a second digest issue.
const ISSUE_SEARCH_MARKER = `"${DIGEST_BODY_MARKER}" in:body`;
// Rendered instead of $0.00 when no sampled agent run reported a cost field.
const COST_NOT_REPORTED_FLEET = 'not reported by provider';
const COST_NOT_REPORTED_ROW = 'not reported';

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
// Serial `gh` subprocesses are slow; bound them so a busy week cannot run
// the digest into its job timeout. Logs past the budget are surfaced as
// unread in the coverage notes, not silently dropped.
const MAX_LOG_DOWNLOADS = 400;
// An agent run is flagged when its average turns reach this share of the
// workflow's MAX_TURNS, or its average cost exceeds this many dollars.
const BUDGET_PRESSURE_RATIO = 0.8;
const HIGH_COST_PER_RUN_USD = 1;
// How many body-marker search hits to inspect; only digest issues carry the
// marker, so the page stays tiny in practice.
const ISSUE_CANDIDATE_LIMIT = 20;

const VALUE_FLAGS = new Set([
  'repo',
  'window-days',
  'max-runs',
  'workflows-dir',
  'actions-dir',
  'github-output',
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    // Keys keep their kebab-case spelling so `--window-days` is read as
    // `args['window-days']`; camel-casing here silently dropped every flag.
    // `--key=value` is split so GNU-style flags do not become a bogus key.
    const eq = argv[i].indexOf('=');
    if (eq >= 0) {
      args[argv[i].slice(2, eq)] = argv[i].slice(eq + 1);
      continue;
    }
    const key = argv[i].slice(2);
    if (VALUE_FLAGS.has(key)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`--${key} requires a value`);
      }
      args[key] = next;
      i += 1;
    } else {
      // Boolean flags are presence-based; a stray following token is never
      // swallowed as a value.
      args[key] = 'true';
    }
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
  // 410 Gone is how the API reports expired job logs; it means the log is
  // gone, not that the call failed.
  return (
    /\bHTTP 404\b/.test(output) ||
    /\bHTTP 410\b/.test(output) ||
    /"status"\s*:\s*"?404"?/.test(output) ||
    /"status"\s*:\s*"?410"?/.test(output) ||
    /Not Found/.test(output) ||
    /\bGone\b/.test(output)
  );
}

// A log larger than the exec buffer fails locally (ENOBUFS), not at the API;
// classifying it as an API failure would mislabel the digest as partial.
function isLogTooLarge(error) {
  return (
    error?.code === 'ENOBUFS' ||
    /ENOBUFS|maxBuffer/.test(String(error?.message || ''))
  );
}

function formatIso(date) {
  // The Actions runs filter takes search dates at second precision; sending
  // milliseconds can get the bound rejected or ignored.
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
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

function matchLogJsonField(text, field) {
  const match = String(text || '').match(
    new RegExp(
      `"${field}"\\s*:\\s*("[^"]*"|-?[0-9]+(?:\\.[0-9]+)?|true|false|null)`,
    ),
  );
  if (!match) return null;
  const raw = match[1];
  if (raw.startsWith('"')) return raw.slice(1, -1);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

// Agent steps retry and multi-step jobs emit several result blocks; only the
// last one reflects the job's final outcome, so cost/turn/error metrics are
// read from after the last `"type": "result"` line rather than the first
// match anywhere in the log.
function splitLastResultBlock(logText) {
  const lines = String(logText || '').split('\n');
  let anchor = -1;
  let matchStart = 0;
  let matchEnd = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/"type"\s*:\s*"result"/);
    if (match) {
      anchor = index;
      matchStart = match.index;
      matchEnd = matchStart + match[0].length;
    }
  }
  if (anchor === -1) {
    return { metricsText: logText || '', modelText: logText || '' };
  }
  // Compact stream-json records keep the metrics on the anchor line itself,
  // so that line is split at the match instead of being discarded whole.
  return {
    metricsText: [
      lines[anchor].slice(matchEnd),
      ...lines.slice(anchor + 1),
    ].join('\n'),
    modelText: [
      ...lines.slice(0, anchor),
      lines[anchor].slice(0, matchStart),
    ].join('\n'),
  };
}

function extractJobMetrics(logText) {
  const tail = tailBytes(logText, MAX_LOG_TAIL_BYTES);
  const { metricsText, modelText } = splitLastResultBlock(tail);
  const costUsd = matchLogJsonField(metricsText, 'total_cost_usd');
  const turns = matchLogJsonField(metricsText, 'num_turns');
  // A final result without `num_turns` is not a usable agent record. Cost is
  // optional: a provider that omits `total_cost_usd` still counts as an agent
  // run with unknown cost, not as a broken extraction or a free week.
  if (typeof turns !== 'number') return null;
  return {
    costUsd: typeof costUsd === 'number' ? costUsd : null,
    turns,
    isError: matchLogJsonField(metricsText, 'is_error') === true,
    model: String(matchLogJsonField(modelText, 'model') ?? ''),
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

function resolveMaxTurnsValue(raw, content) {
  const literal = String(raw)
    .trim()
    .match(/^'?(\d+)'?$/);
  if (literal) return Number(literal[1]);
  const envRef = String(raw)
    .trim()
    .match(/\$\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/);
  if (!envRef) return null;
  const envLine = String(content).match(
    new RegExp(`^\\s*${envRef[1]}:\\s*'?(\\d+)'?\\s*$`, 'm'),
  );
  return envLine ? Number(envLine[1]) : null;
}

// The agent step's `with.max-turns` wins; a bare env MAX_TURNS is only a
// fallback for workflows whose steps do not pass one explicitly. A budget
// that cannot be resolved (or conflicting per-step budgets) reads as unknown
// rather than guessing a cap the agent never ran with.
function parseMaxTurns(content) {
  const text = String(content || '');
  const inputs = [...text.matchAll(/max-turns:\s*([^\n]+)/g)];
  if (inputs.length > 0) {
    const resolved = new Set();
    for (const match of inputs) {
      const value = resolveMaxTurnsValue(match[1], text);
      if (value !== null) resolved.add(value);
    }
    return resolved.size === 1 ? [...resolved][0] : null;
  }
  const envOnly = text.match(/^\s*MAX_TURNS:\s*'?(\d+)'?\s*$/m);
  return envOnly ? Number(envOnly[1]) : null;
}

function workflowDisplayName(content, fallback) {
  const match = String(content || '').match(/^name:\s*(.+?)\s*$/m);
  if (!match) return fallback;
  return match[1].replace(/^['"]|['"]$/g, '').trim() || fallback;
}

function findClaudeWorkflows(workflowFiles, actionFiles) {
  const agentActions = claudeActionNames(actionFiles);
  const actionPattern = /\.\/\.github\/actions\/([A-Za-z0-9_-]+)/g;
  const reusablePattern = /\.\/\.github\/workflows\/([A-Za-z0-9_.-]+\.ya?ml)/g;
  const byName = new Map(workflowFiles.map((file) => [file.name, file]));
  const usesAgentAction = (content) =>
    [...String(content || '').matchAll(actionPattern)].some((match) =>
      agentActions.has(match[1]),
    );
  const calledWorkflows = (content) =>
    [...String(content || '').matchAll(reusablePattern)].map(
      (match) => match[1],
    );
  const agentBearing = new Set(
    workflowFiles
      .filter((file) => usesAgentAction(file.content))
      .map((file) => file.name),
  );
  // A reusable workflow has no runs under its own file name; its agent jobs
  // appear in the caller's runs. Grow the set with callers of agent-bearing
  // workflows until no caller joins.
  let grew = true;
  while (grew) {
    grew = false;
    for (const file of workflowFiles) {
      if (agentBearing.has(file.name)) continue;
      if (
        calledWorkflows(file.content).some((name) => agentBearing.has(name))
      ) {
        agentBearing.add(file.name);
        grew = true;
      }
    }
  }
  // A caller has no budget of its own; inherit from the callee chain.
  const budgets = new Map();
  const budgetFor = (name, seen = new Set()) => {
    if (budgets.has(name)) return budgets.get(name);
    if (seen.has(name)) return null;
    seen.add(name);
    const file = byName.get(name);
    if (!file) return null;
    let value = parseMaxTurns(file.content);
    if (value === null) {
      for (const callee of calledWorkflows(file.content)) {
        if (!agentBearing.has(callee)) continue;
        value = budgetFor(callee, seen);
        if (value !== null) break;
      }
    }
    budgets.set(name, value);
    return value;
  };
  const workflows = [];
  for (const file of workflowFiles) {
    if (!agentBearing.has(file.name)) continue;
    workflows.push({
      file: file.name,
      name: workflowDisplayName(file.content, file.name),
      maxTurnsBudget: budgetFor(file.name),
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
          // The runs endpoint caps per_page at 100 and silently clamps a
          // larger value; clamp here so the sample size is what it claims.
          `per_page=${Math.min(100, limit)}`,
          '--jq',
          '.workflow_runs[] | {id}',
        ]);
  return { total, items: parseGhJsonLines(output ?? '', []) };
}

function createStats() {
  return {
    agentJobs: 0,
    costUsd: 0,
    noCostJobs: 0,
    turns: 0,
    errors: 0,
    maxTurns: 0,
    models: {},
  };
}

function addRecord(stats, record) {
  stats.agentJobs += 1;
  // Runs without a reported cost are tallied apart from costUsd so a provider
  // that omits `total_cost_usd` reads as unknown, never as free.
  if (record.costUsd === null) stats.noCostJobs += 1;
  else stats.costUsd += record.costUsd;
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
  const maxLogDownloads = options.maxLogDownloads ?? MAX_LOG_DOWNLOADS;
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
    cappedLogDownloads: 0,
  });
  const rows = [];
  let logDownloads = 0;

  for (const workflow of workflows) {
    const runs = queryWorkflowRuns(
      { repo, file: workflow.file, since, until, limit },
      runGhFn,
    );
    totals.totalRuns += runs.total;
    const stats = createStats();
    let rowSampledRuns = 0;

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
      const nonSkipped = parseGhJsonLines(jobsOutput, []).filter(
        (job) => job.conclusion !== 'skipped',
      );
      // Jobs past the per-run cap are dropped positionally; surface the
      // undercount instead of silently missing a late agent job.
      const droppedJobs = Math.max(0, nonSkipped.length - MAX_JOBS_PER_RUN);
      if (droppedJobs > 0) totals.missingJobs += droppedJobs;
      const jobs = nonSkipped.slice(0, MAX_JOBS_PER_RUN);

      // A run only counts as sampled once one of its logs was actually read;
      // runs dropped by the download budget would otherwise deflate the
      // sampled cost and inflate the coverage share.
      let readLogs = 0;
      for (const job of jobs) {
        if (logDownloads >= maxLogDownloads) {
          totals.cappedLogDownloads += 1;
          continue;
        }
        let failed = false;
        logDownloads += 1;
        const log = runGhFn(
          ['api', `repos/${repo}/actions/jobs/${job.id}/logs`],
          {
            allowFailure: true,
            raw: true,
            onError: (error) => {
              // Purged (404/410) and oversized logs are missing data, not
              // API failures.
              if (!isNotFound(error) && !isLogTooLarge(error)) failed = true;
            },
          },
        );
        if (log !== null) readLogs += 1;
        const record = log === null ? null : extractJobMetrics(log);
        if (record) {
          addRecord(stats, record);
          addRecord(totals, record);
        } else if (failed) {
          totals.fetchErrors += 1;
        } else {
          // No agent metrics in the log, or the log was purged or unreadable:
          // missing, never zero-cost.
          totals.missingJobs += 1;
        }
      }
      if (readLogs > 0) {
        totals.sampledRuns += 1;
        rowSampledRuns += 1;
      }
    }

    rows.push({
      ...workflow,
      totalRuns: runs.total,
      sampledRuns: rowSampledRuns,
      ...stats,
      models: { ...stats.models },
      avgCostPerRun: round(divide(stats.costUsd, stats.agentJobs), 4),
      avgTurnsPerRun: round(divide(stats.turns, stats.agentJobs), 1),
      costPerTurn: round(divide(stats.costUsd, stats.turns), 4),
      estCostUsd: round(
        (divide(stats.costUsd, rowSampledRuns) ?? 0) * runs.total,
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

// True when agent runs were sampled but none reported a cost field: the
// week's cost is unknown rather than zero, and must not render as $0.00.
function costNotReported(stats) {
  return (
    stats.agentJobs > 0 &&
    stats.costUsd === 0 &&
    stats.noCostJobs === stats.agentJobs
  );
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
  const costUnknown = costNotReported(totals);
  const fleetCost = (value, digits) =>
    costUnknown ? COST_NOT_REPORTED_FLEET : formatUsd(value, digits);
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
    `| Sampled cost | ${fleetCost(round(totals.costUsd))} |`,
    `| Estimated weekly cost | ${fleetCost(totals.estCostUsd)} |`,
    `| Avg cost / agent run | ${fleetCost(round(divide(totals.costUsd, totals.agentJobs), 4), 4)} |`,
    `| Avg turns / agent run | ${round(divide(totals.turns, totals.agentJobs), 1) ?? '-'} |`,
    `| Avg cost / turn | ${fleetCost(round(divide(totals.costUsd, totals.turns), 4), 4)} |`,
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
    const rowCostUnknown = costNotReported(row);
    const rowCost = (value, digits) =>
      rowCostUnknown ? COST_NOT_REPORTED_ROW : formatUsd(value, digits);
    lines.push(
      `| \`${escapeTableCell(row.file)}\` | ${row.totalRuns} | ${row.sampledRuns} | ${row.agentJobs} | ${rowCost(round(row.costUsd))} | ${rowCost(row.estCostUsd)} | ${rowCost(row.avgCostPerRun, 4)} | ${row.avgTurnsPerRun ?? '-'} | ${row.maxTurns} | ${row.maxTurnsBudget ?? '-'} | ${rowCost(row.costPerTurn, 4)} | ${row.errors} |`,
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
  // per_page is capped at 100 by the runs API; report the effective sample
  // size, not the requested one.
  const perWorkflowLimit = Math.min(
    100,
    Math.max(1, Math.floor(data.maxRuns / workflows.length)),
  );
  lines.push(
    `- Sampled up to ${perWorkflowLimit} newest completed runs per workflow.`,
  );
  if (idle.length > 0) {
    lines.push(
      `- ${idle.length} workflow(s) had no completed runs: ${idle.map((row) => `\`${row.file}\``).join(', ')}.`,
    );
  }
  lines.push(
    `- ${totals.missingJobs} job log(s) held no agent metrics or were no longer available; they are counted as missing, not as zero-cost.`,
  );
  if (costUnknown) {
    lines.push(
      `- No sampled agent run reported \`total_cost_usd\`; this provider's cost is unknown for the window.`,
    );
  }
  if (totals.cappedLogDownloads > 0) {
    lines.push(
      `- ${totals.cappedLogDownloads} job log(s) were not read; the serial log download budget (${MAX_LOG_DOWNLOADS}) was reached.`,
    );
  }
  if (totals.fetchErrors > 0) {
    lines.push(
      `- **${totals.fetchErrors} API call(s) failed; this digest is partial.**`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

// Returns the open issue number whose body carries the digest marker, or
// null when no candidate does. A failed or unreadable search throws instead
// of reading as "no digest exists", which would create a duplicate on the
// next run.
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
      'number,body',
      '--limit',
      String(ISSUE_CANDIDATE_LIMIT),
    ],
    { allowFailure: true },
  );
  if (output === null) {
    throw new Error('Could not search for the existing digest issue');
  }
  let issues = null;
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) issues = parsed;
  } catch {
    issues = null;
  }
  if (issues === null) {
    throw new Error('Could not read the digest issue search results');
  }
  // The body search can still surface unrelated hits (an issue quoting the
  // marker, a stale copy); only a body carrying the digest marker identifies
  // the issue this script owns, and the hit may rank anywhere in the list,
  // not first.
  const ours = issues.find((issue) =>
    String(issue?.body || '').includes(DIGEST_BODY_MARKER),
  );
  return ours ? Number(ours.number) : null;
}

function upsertDigestIssue({ repo, title, body }, runGhFn = runGh) {
  const existing = findExistingIssue(repo, runGhFn);
  if (existing != null) {
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

// Runs completed but no agent metrics extracted means log extraction is
// broken or every fetch failed; an honestly empty week (no runs) is the only
// empty digest that may be published. A week whose provider reports no cost
// is a rendering problem, not a fatal one.
function assertAgentMetricsExtracted(totals) {
  if (totals.totalRuns === 0) return;
  if (totals.agentJobs > 0) return;
  throw new Error(
    `No agent metrics extracted from ${totals.sampledRuns} sampled run(s) of ` +
      `${totals.totalRuns} completed run(s); refusing to publish a metrics-free digest`,
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

  // The guard runs before the dry-run return so a --dry-run smoke test is
  // self-diagnosing: a broken extractor exits non-zero instead of looking
  // green behind a printed $0.00 body.
  assertAgentMetricsExtracted(data.totals);

  // Dry run is presence-based and returns before any write (step summary or
  // issue), so a smoke test can never mutate the tracked digest issue.
  if (args['dry-run'] !== undefined) {
    process.stdout.write(`${body}\n`);
    return;
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
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
  assertAgentMetricsExtracted,
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
