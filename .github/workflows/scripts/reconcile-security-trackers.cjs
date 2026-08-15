#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

'use strict';

// Reconcile dependency-security tracker issues against a fresh npm audit.
//
// A tracker is an issue that carries the `security` or `dependencies` label
// AND references at least one GHSA/CVE advisory id in its title or body.
// Trackers are classified and, when every referenced advisory id is absent
// from the audit report, marked `fixed` — never on label or title alone.
// Security-labelled issues WITHOUT an advisory marker are reported as
// `no-advisory-id` (they need human triage, not automated closure), and
// issues without either label are `unrelated` and ignored entirely.
//
// Usage:
//   reconcile-security-trackers.cjs --audit-file audit.json \
//     [--repo owner/repo] [--json]
//
// The audit file is `npm audit --json` output. Issues are read via `gh issue
// list` when --repo is given; without it the tool reconciles only the audit
// side (useful as a library). Exit codes: 0 = report produced (even when
// vulnerable trackers remain — the matrix is the output), 1 = bad input.

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const TRACKER_LABELS = ['security', 'dependencies'];
const GHSA_PATTERN = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/gi;
const CVE_PATTERN = /CVE-\d{4}-\d{4,}/gi;

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

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

// Canonical uppercase ids so a lowercase GHSA in prose matches the audit's
// uppercase form.
function extractAdvisoryIds(text) {
  const source = String(text || '');
  return {
    ghsa: uniqueSorted((source.match(GHSA_PATTERN) || []).map((id) => id.toUpperCase())),
    cve: uniqueSorted((source.match(CVE_PATTERN) || []).map((id) => id.toUpperCase())),
  };
}

function allIds(ids) {
  return [...ids.ghsa, ...ids.cve];
}

// npm audit's vulnerabilities[name].via[] entries are either advisory
// objects (with `url`/`title` carrying the GHSA/CVE) or plain strings naming
// a transitive package (no id) — only the objects carry ids.
function advisoryIdsFromAudit(auditJson) {
  const vulnerabilities = auditJson?.vulnerabilities || {};
  const found = [];
  for (const entry of Object.values(vulnerabilities)) {
    for (const via of entry.via || []) {
      if (typeof via !== 'object' || via === null) continue;
      const ids = extractAdvisoryIds(
        `${via.url || ''} ${via.title || ''} ${via.name || ''}`,
      );
      found.push(...allIds(ids));
    }
  }
  return uniqueSorted(found);
}

function hasTrackerLabel(labels) {
  // `gh --json labels` yields label objects ({id, name, ...}); tests and
  // library callers may pass plain strings — accept both.
  const names = new Set(
    (labels || []).map((label) =>
      label && typeof label === 'object' ? String(label.name || '') : String(label),
    ),
  );
  return TRACKER_LABELS.some((label) => names.has(label));
}

function classifyTracker(issue) {
  const ids = extractAdvisoryIds(
    `${issue.title || ''}\n${issue.body || ''}`,
  );
  const labeled = hasTrackerLabel(issue.labels);
  if (!labeled) return 'unrelated';
  if (allIds(ids).length === 0) return 'no-advisory-id';
  return 'security-tracker';
}

// `fixed` requires EVERY referenced id to be absent from the audit; a single
// still-present id keeps the tracker open with the matched ids listed.
function reconcileTrackers({ trackers, presentIds }) {
  const present = new Set(presentIds || []);
  const rows = [];
  for (const tracker of trackers) {
    const ids = allIds(
      extractAdvisoryIds(`${tracker.title || ''}\n${tracker.body || ''}`),
    );
    const matched = ids.filter((id) => present.has(id));
    rows.push({
      number: tracker.number,
      title: String(tracker.title || ''),
      state: String(tracker.state || ''),
      referenced_ids: ids,
      matched_ids: matched,
      verdict: matched.length === 0 ? 'fixed' : 'open-vulnerable',
    });
  }
  return rows.sort((a, b) => a.number - b.number);
}

function renderMatrix({ auditIds, rows, ignored }) {
  const lines = [
    '| Tracker | Referenced advisories | Still present | Verdict |',
    '|---------|----------------------|---------------|---------|',
  ];
  for (const row of rows) {
    const ids = row.referenced_ids.join(', ') || '—';
    const matched = row.matched_ids.join(', ') || '—';
    lines.push(
      `| #${row.number} (${row.state}) | ${ids} | ${matched} | ${row.verdict} |`,
    );
  }
  lines.push('');
  lines.push(
    `Audit advisories present: ${
      auditIds.length === 0 ? 'none (0 vulnerabilities)' : auditIds.join(', ')
    }`,
  );
  if (ignored['no-advisory-id'].length > 0) {
    lines.push(
      `No-advisory-id security issues (need human triage, not auto-closed): ${ignored[
        'no-advisory-id'
      ]
        .map((issue) => `#${issue.number}`)
        .join(', ')}`,
    );
  }
  return lines.join('\n');
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

// Fetch every open+closed issue carrying either tracker label; callers pass
// an injectable runner in tests.
function fetchCandidateIssues(repo, ghRunner = runGh) {
  const issues = [];
  for (const label of TRACKER_LABELS) {
    const result = ghRunner([
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'all',
      '--label',
      label,
      '--limit',
      '200',
      '--json',
      'number,title,state,labels,body',
      // `.[]` streams one compact object per line; without it gh emits a
      // whole JSON array a line parser cannot read. `gh issue list` has no
      // --paginate — the 200-issue limit bounds the sweep.
      '--jq',
      '.[]',
    ]);
    if (!result.ok) continue; // label with zero issues also returns ok
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        issues.push(JSON.parse(trimmed));
      } catch {
        // Skip unparseable lines rather than aborting the whole sweep.
      }
    }
  }
  const byNumber = new Map();
  for (const issue of issues) byNumber.set(issue.number, issue);
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

function loadAuditFile(auditPath) {
  if (!auditPath) return { error: 'missing --audit-file' };
  try {
    return { audit: JSON.parse(readFileSync(auditPath, 'utf8')) };
  } catch (error) {
    return { error: `unreadable audit file: ${error.message}` };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const loaded = loadAuditFile(args.auditFile);
  if (loaded.error) {
    process.stderr.write(`Error: ${loaded.error}\n`);
    process.exit(1);
  }

  const auditIds = advisoryIdsFromAudit(loaded.audit);
  const candidates = args.repo
    ? fetchCandidateIssues(args.repo)
    : [];

  const trackers = [];
  const ignored = { unrelated: [], 'no-advisory-id': [] };
  for (const issue of candidates) {
    const kind = classifyTracker(issue);
    if (kind === 'security-tracker') trackers.push(issue);
    else ignored[kind].push(issue);
  }

  const rows = reconcileTrackers({ trackers, presentIds: auditIds });
  const result = {
    audit_advisory_ids: auditIds,
    trackers: rows,
    ignored: {
      unrelated: ignored.unrelated.map((issue) => issue.number),
      'no-advisory-id': ignored['no-advisory-id'].map((issue) => issue.number),
    },
  };

  if (args.json === 'true') {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      `${renderMatrix({ auditIds, rows, ignored })}\n`,
    );
  }
}

module.exports = {
  TRACKER_LABELS,
  parseArgs,
  extractAdvisoryIds,
  advisoryIdsFromAudit,
  classifyTracker,
  reconcileTrackers,
  renderMatrix,
  fetchCandidateIssues,
};

if (require.main === module) {
  main();
}
