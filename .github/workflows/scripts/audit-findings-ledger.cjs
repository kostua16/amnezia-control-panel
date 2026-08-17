#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('fs');
const {
  collectManualFindings,
  fingerprintFinding,
  normalizeFinding,
  normalizeSeverity,
  parseJsonMaybe,
} = require('./upsert-audit-manual-findings.cjs');

const DEFAULT_LEDGER_PATH = '.planning/audit-backlog.json';
const LEDGER_VERSION = 1;
const ENTRY_STATUSES = ['open', 'manual', 'fixed'];
const FINGERPRINT_PATTERN = /^[0-9a-f]{16}$/;
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

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isParseableTimestamp(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

// Same contract as upsert-audit-manual-findings.normalizeSeverity: lowercase
// pass-through, empty → 'unspecified'. Do not collapse info/warning/urgent/
// deferred (or any other agent vocabulary) — the issue upsert stores those
// literals, and the ledger must agree.
function normalizeLedgerSeverity(value) {
  return normalizeSeverity(value);
}

function validateLedger(ledger) {
  const reasons = [];
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    return ['ledger root must be an object'];
  }
  if (ledger.version !== LEDGER_VERSION) {
    reasons.push(`version must be ${LEDGER_VERSION}`);
  }
  if (!Array.isArray(ledger.findings)) {
    reasons.push('findings must be an array');
    return reasons;
  }

  const seenFingerprints = new Set();
  ledger.findings.forEach((entry, index) => {
    const where = `findings[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      reasons.push(`${where} must be an object`);
      return;
    }

    if (
      typeof entry.fingerprint !== 'string' ||
      !FINGERPRINT_PATTERN.test(entry.fingerprint)
    ) {
      reasons.push(`${where}.fingerprint must be 16 lowercase hex chars`);
    } else if (seenFingerprints.has(entry.fingerprint)) {
      reasons.push(`${where}.fingerprint is duplicated`);
    } else {
      seenFingerprints.add(entry.fingerprint);
    }

    if (!ENTRY_STATUSES.includes(entry.status)) {
      reasons.push(
        `${where}.status must be one of: ${ENTRY_STATUSES.join(', ')}`,
      );
    }
    if (!isNonEmptyString(entry.severity)) {
      reasons.push(`${where}.severity must be a non-empty string`);
    }
    if (!isNonEmptyString(entry.summary)) {
      reasons.push(`${where}.summary must be a non-empty string`);
    }
    if (!isNonEmptyString(entry.details)) {
      reasons.push(`${where}.details must be a non-empty string`);
    }
    if (
      !Array.isArray(entry.files) ||
      entry.files.some((file) => !isNonEmptyString(file))
    ) {
      reasons.push(`${where}.files must be an array of non-empty strings`);
    }

    if (!isParseableTimestamp(entry.first_seen)) {
      reasons.push(`${where}.first_seen must be a parseable timestamp`);
    }
    if (!isParseableTimestamp(entry.last_seen)) {
      reasons.push(`${where}.last_seen must be a parseable timestamp`);
    } else if (
      isParseableTimestamp(entry.first_seen) &&
      Date.parse(entry.first_seen) > Date.parse(entry.last_seen)
    ) {
      reasons.push(`${where}.first_seen must not be after last_seen`);
    }
    if (!isNonEmptyString(entry.last_seen_run)) {
      reasons.push(`${where}.last_seen_run must be a non-empty string`);
    }

    if (
      isNonEmptyString(entry.summary) &&
      Array.isArray(entry.files) &&
      entry.fingerprint !==
        fingerprintFinding({ summary: entry.summary, files: entry.files })
    ) {
      reasons.push(`${where}.fingerprint does not match summary/files`);
    }

    if (entry.status === 'fixed') {
      if (!isNonEmptyString(entry.fixed_in_run)) {
        reasons.push(
          `${where}.fixed_in_run is required when status is 'fixed'`,
        );
      }
    } else if ('fixed_in_run' in entry) {
      reasons.push(
        `${where}.fixed_in_run must only be present when status is 'fixed'`,
      );
    }
  });

  return reasons;
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
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A corrupt ledger must never be silently reinitialized: failing loudly
    // surfaces via report-failure instead of wiping the audit history.
    throw new Error(`Ledger file is not valid JSON: ${filePath}`);
  }
  const reasons = validateLedger(parsed);
  // A structurally malformed ledger must fail loudly here instead of crashing
  // later steps (serialization, list-open rendering) far from the cause.
  if (reasons.length > 0) {
    throw new Error(
      `Ledger file has invalid structure: ${filePath}: ${reasons[0]}`,
    );
  }
  return parsed;
}

function makeEntry({ finding, status, firstSeen, now, runId }) {
  const entry = {
    fingerprint: fingerprintFinding(finding),
    status,
    severity: normalizeLedgerSeverity(finding.severity),
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
    // Refresh descriptive fields from the current report so a re-reported
    // finding reflects its latest severity/details instead of stale
    // first-seen metadata. Fingerprint and first_seen stay stable.
    existing.severity = normalizeLedgerSeverity(finding.severity);
    existing.summary = finding.summary;
    existing.details = finding.details;
    existing.files = finding.files;
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
  const validate = args.validate === 'true';
  const selectedModes = [append, listOpen, validate].filter(Boolean).length;
  if (selectedModes !== 1) {
    process.stderr.write(
      'Exactly one of --append, --list-open, or --validate is required.\n',
    );
    process.exitCode = 2;
    return;
  }
  const ledgerPath = args.ledger || DEFAULT_LEDGER_PATH;
  const runId =
    args.runId || process.env.RUN_ID || process.env.GITHUB_RUN_ID || 'local';

  try {
    if (validate) {
      // Read-only structural check: unlike append/list-open it must not fall
      // back to the empty-ledger init, which would mask a missing file.
      // Default: skip when absent so the shared validate-pr-gate (8+
      // non-audit callers) does not fail pre-seed checkouts. --require
      // keeps CI / audit fail-closed on a missing seed.
      const requireLedger = args.require === 'true';
      if (!fs.existsSync(ledgerPath)) {
        if (requireLedger) {
          process.stderr.write(`Ledger file not found: ${ledgerPath}\n`);
          process.exitCode = 1;
          return;
        }
        process.stdout.write(
          `Ledger file not present; skipping validation: ${ledgerPath}\n`,
        );
        return;
      }
      const ledger = loadLedger(ledgerPath);
      process.stdout.write(
        `Ledger valid: ${ledgerPath} (${ledger.findings.length} findings)\n`,
      );
      return;
    }

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
  normalizeLedgerSeverity,
  runCli,
  serializeLedger,
  validateLedger,
};

if (require.main === module) {
  runCli();
}
