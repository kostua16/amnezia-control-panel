#!/usr/bin/env node

/**
 * Schedule-drift detector — MNT-E02
 *
 * Compares each scheduled workflow's cron schedule against actual
 * `startedAt` timestamps from recent runs. Workflows whose
 * median drift exceeds DRIFT_THRESHOLD_HOURS are reported as
 * chronic-drift signals (runner-capacity pressure).
 *
 * Usage:
 *   node detect-schedule-drift.cjs [--repo owner/repo] [--since <duration>] \
 *       [--threshold-hours <n>] [--json]
 *
 * Flags:
 *   --repo            GitHub repo (default from env GH_REPO or github.repository)
 *   --since           Look-back window for runs (default: 7d)
 *   --threshold-hours Drift threshold in hours (default: 2)
 *   --json            Output machine-readable JSON
 *
 * Exits 0 always (observability tool).  Writes findings to stdout.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DRIFT_THRESHOLD_HOURS = 2;
const DEFAULT_SINCE = '7d';
const MAX_RUNS_PER_WORKFLOW = 10;

// ── CLI helpers ──────────────────────────────────────────────

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? null : (process.argv[idx + 1] ?? null);
}

function ghJson(...args) {
  try {
    const buf = execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GH_PAGER: 'cat' },
    });
    return JSON.parse(buf);
  } catch {
    return null;
  }
}

// ── Cron → expected-minute-of-day ────────────────────────────

/**
 * Parse a cron expression and return the set of valid minute-of-day
 * values (0–1439) it can fire at, considering only hour+minute fields.
 * Day-of-month/month/day-of-week fields are ignored — we compare
 * the minute-of-day component regardless of which day the run fired.
 *
 * Supports:
 *   - Fixed:   `17 6 * * 1` → {minute:17, hour:6} → 377
 *   - Range:   `0 star/6 star star star` → 0, 360, 720, 1080
 *   - List:    `7,22,37,52 * * * *` → 7, 22, 37, 52
 *   - Step:    every-15-min pattern → 0, 15, 30, 45
 */
function cronToMinuteSlots(cronStr) {
  const parts = cronStr.trim().split(/\s+/);
  if (parts.length < 5) return [];

  const minuteField = parts[0];
  const hourField = parts[1];
  const hours = expandField(hourField, 0, 23);
  const minutes = expandField(minuteField, 0, 59);

  const slots = new Set();
  for (const h of hours) {
    for (const m of minutes) {
      slots.add(h * 60 + m);
    }
  }
  return [...slots].sort((a, b) => a - b);
}

/**
 * Expand a single cron field into concrete integer values.
 * Handles: wildcard, step (e.g. every-N), single value, range, list.
 */
function expandField(field, min, max) {
  const values = new Set();
  for (const token of field.split(',')) {
    const stepMatch = token.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[1], 10);
      if (step <= 0) continue;
      for (let v = min; v <= max; v += step) values.add(v);
      continue;
    }
    const rangeStepMatch = token.match(/^(\d+)-(\d+)\/(\d+)$/);
    if (rangeStepMatch) {
      const lo = parseInt(rangeStepMatch[1], 10);
      const hi = parseInt(rangeStepMatch[2], 10);
      const step = parseInt(rangeStepMatch[3], 10);
      if (lo < min || hi > max || lo > hi || step <= 0) continue;
      for (let v = lo; v <= hi; v += step) values.add(v);
      continue;
    }
    const rangeMatch = token.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      if (lo < min || hi > max || lo > hi) continue;
      for (let v = lo; v <= hi; v++) values.add(v);
      continue;
    }
    if (token === '*') {
      for (let v = min; v <= max; v++) values.add(v);
      continue;
    }
    if (!/^\d+$/.test(token)) continue;
    const num = parseInt(token, 10);
    if (!Number.isNaN(num) && num >= min && num <= max) values.add(num);
  }
  return [...values].sort((a, b) => a - b);
}

/**
 * Given expected minute-of-day slots, return the minimum absolute
 * difference (in minutes) between any slot and the actual minute-of-day.
 */
function minDriftMinutes(slots, actualMod) {
  if (slots.length === 0) return null;
  let best = Infinity;
  for (const slot of slots) {
    // Handle wrap-around (e.g. slot 1380, actual 60)
    const diff = Math.min(
      Math.abs(slot - actualMod),
      1440 - Math.abs(slot - actualMod),
    );
    if (diff < best) best = diff;
  }
  return best === Infinity ? null : best;
}

// ── Parse workflow YAML for cron schedules ───────────────────

function parseWorkflowCrons(workflowsDir) {
  // Lazy-load yaml to avoid hard dependency when not running in workflow
  let yaml;
  try {
    yaml = require('js-yaml');
  } catch {
    console.error('js-yaml is required. Install with: npm install js-yaml');
    process.exit(1);
  }

  const results = [];
  const files = fs
    .readdirSync(workflowsDir)
    .filter(
      (name) =>
        (name.endsWith('.yml') || name.endsWith('.yaml')) &&
        !name.startsWith('_'),
    );

  for (const file of files) {
    const filePath = path.join(workflowsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    let doc;
    try {
      doc = yaml.load(content);
    } catch {
      continue; // unparseable — skip
    }

    const crons = [];
    const triggers = doc.on;
    // Normalize to array: a workflow may declare a single schedule trigger
    // without wrapping it in a YAML list (schedule: { cron: ... }).
    if (triggers && triggers.schedule) {
      const entries = [].concat(triggers.schedule).filter(Boolean);
      for (const sched of entries) {
        if (sched.cron) crons.push(sched.cron);
      }
    }

    if (crons.length > 0) {
      const workflowName = doc.name || file.replace(/\.(yml|yaml)$/, '');
      results.push({ file, workflowName, crons });
    }
  }
  return results;
}

// ── Fetch recent runs for a workflow ─────────────────────────

function fetchRecentRuns(repo, workflowFile, since, ghJsonFn = ghJson) {
  const data = ghJsonFn(
    'run',
    'list',
    '--workflow',
    workflowFile,
    '--repo',
    repo,
    '--limit',
    String(MAX_RUNS_PER_WORKFLOW),
    '--event',
    'schedule',
    '--json',
    'startedAt,createdAt,status,conclusion,number,databaseId',
  );
  if (!Array.isArray(data)) return [];

  const cutoff = parseSince(since);
  return data.filter((run) => {
    const started = new Date(run.startedAt || run.createdAt);
    return started >= cutoff;
  });
}

function parseSince(duration) {
  const match = duration.match(/^(\d+)([dh])$/);
  if (!match) return new Date(Date.now() - 7 * 86400000);
  const n = parseInt(match[1], 10);
  const ms = match[2] === 'h' ? n * 3600000 : n * 86400000;
  return new Date(Date.now() - ms);
}

// ── Core analysis ────────────────────────────────────────────

function analyzeDrift(repo, workflowsDir, since, thresholdHours) {
  const workflowCrons = parseWorkflowCrons(workflowsDir);
  const findings = [];

  for (const wf of workflowCrons) {
    // Merge all crons into one slot set
    const allSlots = [];
    for (const cron of wf.crons) {
      allSlots.push(...cronToMinuteSlots(cron));
    }
    const uniqueSlots = [...new Set(allSlots)].sort((a, b) => a - b);

    if (uniqueSlots.length === 0) continue;

    const runs = fetchRecentRuns(repo, wf.file, since);
    if (runs.length === 0) continue;

    const drifts = [];
    for (const run of runs) {
      const startedAt = new Date(run.startedAt || run.createdAt);
      if (Number.isNaN(startedAt.getTime())) continue;

      // Minute-of-day in UTC
      const utcHours = startedAt.getUTCHours();
      const utcMinutes = startedAt.getUTCMinutes();
      const actualMod = utcHours * 60 + utcMinutes;

      const driftMin = minDriftMinutes(uniqueSlots, actualMod);
      if (driftMin !== null) {
        drifts.push({
          runNumber: run.number,
          startedAt: startedAt.toISOString(),
          driftMinutes: driftMin,
        });
      }
    }

    if (drifts.length === 0) continue;

    // Median drift
    const sorted = drifts.map((d) => d.driftMinutes).sort((a, b) => a - b);
    const median =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

    const maxDrift = sorted[sorted.length - 1];

    const isChronic = median / 60 >= thresholdHours;

    findings.push({
      workflow: wf.workflowName,
      file: wf.file,
      crons: wf.crons,
      runsAnalyzed: drifts.length,
      medianDriftMinutes: Math.round(median),
      maxDriftMinutes: maxDrift,
      chronic: isChronic,
      drifts,
    });
  }

  return findings;
}

// ── Formatting ───────────────────────────────────────────────

function formatText(findings, thresholdHours) {
  if (findings.length === 0) {
    return 'No scheduled workflows found or no schedule-triggered runs in the look-back window.';
  }

  const lines = [
    `## Schedule-drift report (threshold: ${thresholdHours}h median)`,
    '',
  ];

  const chronic = findings.filter((f) => f.chronic);
  const ok = findings.filter((f) => !f.chronic);

  if (chronic.length > 0) {
    lines.push(
      `### ⚠️ Chronic drift (${chronic.length} workflow${chronic.length > 1 ? 's' : ''})`,
    );
    lines.push('');
    for (const f of chronic) {
      const h = Math.floor(f.medianDriftMinutes / 60);
      const m = f.medianDriftMinutes % 60;
      lines.push(
        `- **${f.workflow}** (${f.file}): median drift ${h}h ${m}m ` +
          `(max ${Math.floor(f.maxDriftMinutes / 60)}h ${f.maxDriftMinutes % 60}m) ` +
          `across ${f.runsAnalyzed} runs — cron: \`${f.crons.join(', ')}\``,
      );
    }
    lines.push('');
    lines.push(
      '> Chronic drift signals runner-capacity pressure. ' +
        'Consider rescheduling affected workflows to idle slots or scaling runner pool.',
    );
    lines.push('');
  }

  if (ok.length > 0) {
    lines.push(
      `### ✅ Within tolerance (${ok.length} workflow${ok.length > 1 ? 's' : ''})`,
    );
    lines.push('');
    for (const f of ok) {
      const m = f.medianDriftMinutes;
      lines.push(
        `- **${f.workflow}**: median drift ${m}m (max ${f.maxDriftMinutes}m) — ${f.runsAnalyzed} runs`,
      );
    }
    lines.push('');
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
  const thresholdHours = parseInt(
    getArg('--threshold-hours') ?? String(DRIFT_THRESHOLD_HOURS),
    10,
  );
  const jsonMode = process.argv.includes('--json');

  if (!repo) {
    console.error(
      'Error: --repo or GH_REPO env required. Usage: node detect-schedule-drift.cjs --repo owner/repo',
    );
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const workflowsDir = path.join(repoRoot, '.github', 'workflows');

  const findings = analyzeDrift(repo, workflowsDir, since, thresholdHours);

  if (jsonMode) {
    console.log(JSON.stringify(findings, null, 2));
  } else {
    console.log(formatText(findings, thresholdHours));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  analyzeDrift,
  cronToMinuteSlots,
  expandField,
  fetchRecentRuns,
  minDriftMinutes,
  parseWorkflowCrons,
  parseSince,
};
