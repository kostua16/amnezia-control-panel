/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  appendToLedger,
  collectFixedFindings,
  listOpenEntries,
  loadLedger,
  serializeLedger,
} = require('../audit-findings-ledger.cjs');

const SCRIPT_PATH = path.join(__dirname, '..', 'audit-findings-ledger.cjs');
const NOW_1 = '2026-08-15T10:00:00.000Z';
const NOW_2 = '2026-08-15T12:00:00.000Z';
const RUN_1 = 'run-111';
const RUN_2 = 'run-222';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'afl-test-'));
}

function makeFinding(overrides = {}) {
  return {
    findingId: 'F-01',
    severity: 'medium',
    summary: 'Unused helper exported from utils',
    details: 'The helper has no references.',
    files: ['src/lib/utils.ts'],
    ...overrides,
  };
}

function emptyLedger() {
  return { version: 1, findings: [] };
}

function writeLedgerFile(ledger) {
  const dir = makeTempDir();
  const filePath = path.join(dir, 'audit-backlog.json');
  fs.writeFileSync(filePath, serializeLedger(ledger));
  return filePath;
}

function runCliScript(args, envOverrides = {}) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, RUN_ID: RUN_1, ...envOverrides },
  });
}

test('append creates a new manual entry with first_seen equal to last_seen', () => {
  const result = appendToLedger({
    ledger: emptyLedger(),
    manualFindings: [makeFinding()],
    runId: RUN_1,
    now: NOW_1,
  });

  assert.equal(result.added, 1);
  assert.equal(result.updated, 0);
  assert.equal(result.changed, true);
  assert.equal(result.openCount, 1);

  const entry = result.ledger.findings[0];
  assert.equal(entry.status, 'manual');
  assert.equal(entry.first_seen, NOW_1);
  assert.equal(entry.last_seen, NOW_1);
  assert.equal(entry.last_seen_run, RUN_1);
  assert.equal('fixed_in_run' in entry, false);
});

test('re-reporting a finding with a different id dedupes into one entry', () => {
  const first = appendToLedger({
    ledger: emptyLedger(),
    manualFindings: [makeFinding({ findingId: 'F-01' })],
    runId: RUN_1,
    now: NOW_1,
  });
  const second = appendToLedger({
    ledger: first.ledger,
    manualFindings: [makeFinding({ findingId: 'F-03' })],
    runId: RUN_2,
    now: NOW_2,
  });

  assert.equal(second.ledger.findings.length, 1);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 1);
  assert.equal(second.ledger.findings[0].first_seen, NOW_1);
  assert.equal(second.ledger.findings[0].last_seen, NOW_2);
  assert.equal(second.ledger.findings[0].last_seen_run, RUN_2);
  assert.equal(second.ledger.findings[0].status, 'manual');
});

test('fixed findings become fixed entries and manual entries transition to fixed', () => {
  const first = appendToLedger({
    ledger: emptyLedger(),
    manualFindings: [makeFinding()],
    runId: RUN_1,
    now: NOW_1,
  });
  const second = appendToLedger({
    ledger: first.ledger,
    fixedFindings: [makeFinding()],
    manualFindings: [makeFinding({ summary: 'Other unfixed finding' })],
    runId: RUN_2,
    now: NOW_2,
  });

  const bySummary = new Map(
    second.ledger.findings.map((entry) => [entry.summary, entry]),
  );
  const fixed = bySummary.get(makeFinding().summary);
  assert.equal(fixed.status, 'fixed');
  assert.equal(fixed.fixed_in_run, RUN_2);
  assert.equal(fixed.first_seen, NOW_1);
  assert.equal(second.openCount, 1);
});

test('a fixed finding reported manual again regresses to open', () => {
  const fixed = appendToLedger({
    ledger: emptyLedger(),
    fixedFindings: [makeFinding()],
    runId: RUN_1,
    now: NOW_1,
  });
  const regressed = appendToLedger({
    ledger: fixed.ledger,
    manualFindings: [makeFinding()],
    runId: RUN_2,
    now: NOW_2,
  });

  const entry = regressed.ledger.findings[0];
  assert.equal(entry.status, 'open');
  assert.equal('fixed_in_run' in entry, false);
  assert.equal(entry.first_seen, NOW_1);
  assert.equal(entry.last_seen_run, RUN_2);
  assert.equal(regressed.openCount, 1);
});

test('a fingerprint reported in both lists resolves to fixed without crashing', () => {
  const result = appendToLedger({
    ledger: emptyLedger(),
    fixedFindings: [makeFinding()],
    manualFindings: [makeFinding()],
    runId: RUN_1,
    now: NOW_1,
  });

  assert.equal(result.ledger.findings.length, 1);
  assert.equal(result.ledger.findings[0].status, 'fixed');
  assert.equal(result.ledger.findings[0].fixed_in_run, RUN_1);
  assert.equal(result.openCount, 0);
});

test('file order does not change the fingerprint used for dedup', () => {
  const first = appendToLedger({
    ledger: emptyLedger(),
    manualFindings: [makeFinding({ files: ['src/lib/a.ts', 'src/lib/b.ts'] })],
    runId: RUN_1,
    now: NOW_1,
  });
  const second = appendToLedger({
    ledger: first.ledger,
    manualFindings: [makeFinding({ files: ['src/lib/b.ts', 'src/lib/a.ts'] })],
    runId: RUN_2,
    now: NOW_2,
  });

  assert.equal(second.ledger.findings.length, 1);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 1);
});

test('zero findings leave the ledger unchanged and unwritten', () => {
  const existing = appendToLedger({
    ledger: emptyLedger(),
    manualFindings: [makeFinding()],
    runId: RUN_1,
    now: NOW_1,
  });
  const untouched = appendToLedger({
    ledger: existing.ledger,
    fixedFindings: [],
    manualFindings: [],
    runId: RUN_2,
    now: NOW_2,
  });

  assert.equal(untouched.changed, false);
  assert.equal(untouched.added, 0);
  assert.equal(untouched.updated, 0);

  const dir = makeTempDir();
  const filePath = path.join(dir, 'audit-backlog.json');
  const output = path.join(dir, 'github-output.txt');
  fs.writeFileSync(filePath, serializeLedger(existing.ledger));
  const before = fs.readFileSync(filePath, 'utf8');

  const cli = runCliScript(['--append', '--ledger', filePath], {
    CLAUDE_STRUCTURED_OUTPUT: '',
    GITHUB_OUTPUT: output,
  });

  assert.equal(cli.status, 0);
  assert.equal(fs.readFileSync(filePath, 'utf8'), before);
  const outputs = fs.readFileSync(output, 'utf8');
  assert.match(outputs, /changed=false/);
  assert.match(outputs, /open_count=1/);
});

test('corrupt ledger JSON fails loudly instead of wiping history', () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, 'audit-backlog.json');
  fs.writeFileSync(filePath, '{ not json');

  assert.throws(() => loadLedger(filePath), /not valid JSON/);
  assert.throws(
    () => loadLedger(filePath),
    new RegExp(filePath.replace(/\\/g, '\\\\')),
  );

  const cli = runCliScript(['--append', '--ledger', filePath], {
    CLAUDE_STRUCTURED_OUTPUT: JSON.stringify({
      manual_findings: [makeFinding()],
    }),
  });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /not valid JSON/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{ not json');
});

test('collectFixedFindings reads both key spellings and drops malformed entries', () => {
  const snake = collectFixedFindings({
    structuredOutput: JSON.stringify({
      fixed_findings: [{ severity: 'low', summary: 'A', details: 'a' }],
    }),
  });
  const camel = collectFixedFindings({
    structuredOutput: JSON.stringify({
      fixedFindings: [{ severity: 'low', summary: 'B', details: 'b' }],
    }),
  });
  const empty = collectFixedFindings({ structuredOutput: 'not json' });

  assert.equal(snake.length, 1);
  assert.equal(camel.length, 1);
  assert.deepEqual(empty, []);
});

test('list-open prints open and manual entries severity-first, newest first', () => {
  const seeded = appendToLedger({
    ledger: emptyLedger(),
    manualFindings: [
      makeFinding({ severity: 'low', summary: 'low one' }),
      makeFinding({ severity: 'critical', summary: 'critical one' }),
      makeFinding({ severity: 'medium', summary: 'medium one' }),
    ],
    runId: RUN_1,
    now: NOW_1,
  });
  const refreshed = appendToLedger({
    ledger: seeded.ledger,
    manualFindings: [
      makeFinding({ severity: 'medium', summary: 'medium two' }),
    ],
    fixedFindings: [
      makeFinding({ severity: 'high', summary: 'fixed and hidden' }),
    ],
    runId: RUN_2,
    now: NOW_2,
  });

  const open = listOpenEntries(refreshed.ledger);
  assert.deepEqual(
    open.map((entry) => entry.summary),
    ['critical one', 'medium two', 'medium one', 'low one'],
  );
});

test('serialization is deterministic: sorted fingerprints, stable field order', () => {
  const result = appendToLedger({
    ledger: emptyLedger(),
    manualFindings: [
      makeFinding({ severity: 'low', summary: 'zzz later entry' }),
      makeFinding({ severity: 'high', summary: 'aaa earlier entry' }),
    ],
    fixedFindings: [makeFinding({ severity: 'high', summary: 'mmm fixed' })],
    runId: RUN_1,
    now: NOW_1,
  });

  const serialized = serializeLedger(result.ledger);
  assert.equal(serialized, serializeLedger(result.ledger));
  assert.ok(serialized.endsWith('\n'));

  const parsed = JSON.parse(serialized);
  assert.equal(parsed.version, 1);
  const fingerprints = parsed.findings.map((entry) => entry.fingerprint);
  assert.deepEqual(
    fingerprints,
    [...fingerprints].sort((a, b) => a.localeCompare(b)),
  );

  for (const entry of parsed.findings) {
    const keys = Object.keys(entry);
    if (entry.status === 'fixed') {
      assert.deepEqual(keys, [
        'fingerprint',
        'status',
        'severity',
        'summary',
        'details',
        'files',
        'first_seen',
        'last_seen',
        'last_seen_run',
        'fixed_in_run',
      ]);
    } else {
      assert.deepEqual(keys.slice(0, 9), [
        'fingerprint',
        'status',
        'severity',
        'summary',
        'details',
        'files',
        'first_seen',
        'last_seen',
        'last_seen_run',
      ]);
    }
  }
});

test('missing ledger initializes empty and CLI append writes the file', () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, 'audit-backlog.json');
  const output = path.join(dir, 'github-output.txt');

  assert.deepEqual(loadLedger(path.join(dir, 'missing.json')), {
    version: 1,
    findings: [],
  });

  const cli = runCliScript(['--append', '--ledger', filePath], {
    CLAUDE_STRUCTURED_OUTPUT: JSON.stringify({
      manual_findings: [
        {
          finding_id: 'F-01',
          severity: 'medium',
          summary: 'smoke finding',
          details: 'smoke',
          files: ['src/lib/a.ts'],
        },
      ],
    }),
    GITHUB_OUTPUT: output,
  });

  assert.equal(cli.status, 0, cli.stderr);
  const written = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(written.findings.length, 1);
  assert.equal(written.findings[0].status, 'manual');
  assert.equal(written.findings[0].last_seen_run, RUN_1);
  assert.match(fs.readFileSync(output, 'utf8'), /changed=true\nadded=1/);

  const second = runCliScript(['--append', '--ledger', filePath], {
    CLAUDE_STRUCTURED_OUTPUT: JSON.stringify({
      manual_findings: [
        {
          finding_id: 'F-99',
          severity: 'medium',
          summary: 'smoke finding',
          details: 'smoke',
          files: ['src/lib/a.ts'],
        },
      ],
    }),
    RUN_ID: RUN_2,
    GITHUB_OUTPUT: output,
  });
  assert.equal(second.status, 0, second.stderr);
  const afterSecond = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(afterSecond.findings.length, 1);
  assert.equal(afterSecond.findings[0].last_seen_run, RUN_2);

  const listed = runCliScript(['--list-open', '--ledger', filePath]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /\[medium\] manual \w{16} smoke finding/);
});

test('CLI rejects conflicting or missing modes', () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, 'audit-backlog.json');

  assert.equal(
    runCliScript(['--append', '--list-open', '--ledger', filePath]).status,
    2,
  );
  assert.equal(runCliScript(['--ledger', filePath]).status, 2);
  assert.equal(fs.existsSync(filePath), false);
});
