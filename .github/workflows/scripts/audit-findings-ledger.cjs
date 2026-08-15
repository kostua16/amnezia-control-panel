#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('fs');
const {
  collectManualFindings,
  fingerprintFinding,
  normalizeFinding,
  parseJsonMaybe,
} = require('./upsert-audit-manual-findings.cjs');

const DEFAULT_LEDGER_PATH = '.planning/audit-backlog.json';
const LEDGER_VERSION = 1;
const SEVERITY_RANKS = { critical: 0, high: 1, medium: 2, low: 3 };
const ENTRY_FIELD_ORDER = [
  'fingerprint',
  'status',
  'severity',
  'summary',
  'details',
  'files',
  'first_seen',
  'last_seen',
  'last_seen_run',
];

function collectFixedFindings({ structuredOutput }) {
  const parsed = parseJsonMaybe(structuredOutput);
  if (!parsed || typeof parsed !== 'object') return [];
  for (const key of ['fixed_findings', 'fixedFindings']) {
    if (!Array.isArray(parsed[key])) continue;
    return parsed[key]
      .map((finding, index) => normalizeFinding(finding, index))
      .filter(Boolean);
  }
  return [];
}

function loadLedger(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { version: LEDGER_VERSION, findings: [] };
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.findings)
    ) {
      throw new Error('not a ledger object');
    }
    return parsed;
  } catch {
    // A corrupt ledger must never be silently reinitialized: failing loudly
    // surfaces via report-failure instead of wiping the audit history.
    throw new Error(`Ledger file is not valid JSON: ${filePath}`);
  }
}

function makeEntry({ finding, status, firstSeen, now, runId }) {
  const entry = {
    fingerprint: fingerprintFinding(finding),
    status,
    severity: finding.severity,
    summary: finding.summary,
    details: finding.details,
    files: finding.files,
    first_seen: firstSeen,
    last_seen: now,
    last_seen_run: runId,
  };
  if (status === 'fixed') entry.fixed_in_run = runId;
  return entry;
}

function appendToLedger({
  ledger,
  fixedFindings = [],
  manualFindings = [],
  runId,
  now,
}) {
  const entries = new Map();
  for (const entry of ledger.findings ?? []) {
    entries.set(entry.fingerprint, { ...entry });
  }

  let added = 0;
  let updated = 0;
  const fixedFingerprints = new Set(fixedFindings.map(fingerprintFinding));

  for (const finding of fixedFindings) {
    const fingerprint = fingerprintFinding(finding);
    const existing = entries.get(fingerprint);
    entries.set(
      fingerprint,
      makeEntry({
        finding,
        status: 'fixed',
        firstSeen: existing ? existing.first_seen : now,
        now,
        runId,
      }),
    );
    if (existing) updated += 1;
    else added += 1;
  }

  for (const finding of manualFindings) {
    const fingerprint = fingerprintFinding(finding);
    if (fixedFingerprints.has(fingerprint)) {
      process.stderr.write(
        `Warning: finding reported as both fixed and manual this run; keeping fixed: ${finding.summary}\n`,
      );
      continue;
    }
    const existing = entries.get(fingerprint);
    if (!existing) {
      entries.set(
        fingerprint,
        makeEntry({ finding, status: 'manual', firstSeen: now, now, runId }),
      );
      added += 1;
      continue;
    }
    // A previously fixed finding surfacing as manual again means the fix no
    // longer holds — reopen it instead of keeping a stale fixed status.
    if (existing.status === 'fixed') {
      existing.status = 'open';
      delete existing.fixed_in_run;
    }
    existing.last_seen = now;
    existing.last_seen_run = runId;
    updated += 1;
  }

  const findings = [...entries.values()];
  const openCount = findings.filter((entry) => entry.status !== 'fixed').length;
  return {
    ledger: { version: LEDGER_VERSION, findings },
    added,
    updated,
    openCount,
    changed: added + updated > 0,
  };
}

function orderEntry(entry) {
  const ordered = {};
  for (const key of ENTRY_FIELD_ORDER) ordered[key] = entry[key];
  if (entry.status === 'fixed') ordered.fixed_in_run = entry.fixed_in_run;
  return ordered;
}

function serializeLedger(ledger) {
  const findings = (ledger.findings ?? [])
    .map(orderEntry)
    .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  return `${JSON.stringify({ version: LEDGER_VERSION, findings }, null, 2)}\n`;
}

function severityRank(severity) {
  return SEVERITY_RANKS[severity] ?? 4;
}

function listOpenEntries(ledger) {
  return (ledger.findings ?? [])
    .filter((entry) => entry.status !== 'fixed')
    .sort((a, b) => {
      const bySeverity = severityRank(a.severity) - severityRank(b.severity);
      if (bySeverity !== 0) return bySeverity;
      if (a.last_seen === b.last_seen) return 0;
      return a.last_seen > b.last_seen ? -1 : 1;
    });
}

function renderOpenLine(entry) {
  return `[${entry.severity}] ${entry.status} ${entry.fingerprint} ${entry.summary} (files: ${entry.files.length}) last_seen_run=${entry.last_seen_run}`;
}

function appendGithubOutputs(outputPath, values) {
  if (!outputPath) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg
      .slice(2)
      .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    args[key] =
      argv[index + 1] && !argv[index + 1].startsWith('--')
        ? argv[++index]
        : 'true';
  }
  return args;
}

function runCli() {
  const args = parseArgs(process.argv.slice(2));
  const append = args.append === 'true';
  const listOpen = args.listOpen === 'true';
  if (append === listOpen) {
    process.stderr.write(
      'Exactly one of --append or --list-open is required.\n',
    );
    process.exitCode = 2;
    return;
  }
  const ledgerPath = args.ledger || DEFAULT_LEDGER_PATH;
  const runId =
    args.runId || process.env.RUN_ID || process.env.GITHUB_RUN_ID || 'local';

  try {
    const ledger = loadLedger(ledgerPath);
    if (listOpen) {
      for (const entry of listOpenEntries(ledger)) {
        process.stdout.write(`${renderOpenLine(entry)}\n`);
      }
      return;
    }

    const manualFindings = collectManualFindings({
      structuredOutput: process.env.CLAUDE_STRUCTURED_OUTPUT,
      textFallback: process.env.CLAUDE_LAST_OUTPUT,
    });
    const fixedFindings = collectFixedFindings({
      structuredOutput: process.env.CLAUDE_STRUCTURED_OUTPUT,
    });
    const result = appendToLedger({
      ledger,
      fixedFindings,
      manualFindings,
      runId,
      now: new Date().toISOString(),
    });
    // Only write when something changed: zero findings must not produce
    // empty-diff churn on the committed ledger file.
    if (result.changed) {
      fs.writeFileSync(ledgerPath, serializeLedger(result.ledger));
    }

    appendGithubOutputs(args.githubOutput || process.env.GITHUB_OUTPUT, {
      changed: String(result.changed),
      added: result.added,
      updated: result.updated,
      open_count: result.openCount,
    });
    process.stdout.write(
      `Findings ledger: added ${result.added}, updated ${result.updated}, open ${result.openCount}` +
        `${result.changed ? ' (written)' : ' (unchanged)'}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  appendToLedger,
  collectFixedFindings,
  loadLedger,
  listOpenEntries,
  runCli,
  serializeLedger,
};

if (require.main === module) {
  runCli();
}
