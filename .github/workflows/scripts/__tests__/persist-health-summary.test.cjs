/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { persistHealthSummary } = require('../persist-health-summary.cjs');

// ---------------------------------------------------------------------------
// Empty / null input → returns null, no file written
// ---------------------------------------------------------------------------
test('returns null for empty array', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = persistHealthSummary([], { outputDir: dir });
  assert.equal(result, null);
  const files = fs.readdirSync(dir);
  assert.deepEqual(files, []);
});

test('returns null for null input', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = persistHealthSummary(null, { outputDir: dir });
  assert.equal(result, null);
});

test('returns null for undefined input', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = persistHealthSummary(undefined, { outputDir: dir });
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// Normal array → writes JSONL with newline trailer
// ---------------------------------------------------------------------------
test('writes valid JSONL with newline trailer for single entry', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const data = [{ workflow: 'ci.yml', status: 'success', duration: 120 }];
  const result = persistHealthSummary(data, { outputDir: dir });
  assert.ok(result);
  assert.ok(result.startsWith(dir));
  assert.ok(result.endsWith('.jsonl'));

  const content = fs.readFileSync(result, 'utf-8');
  const lines = content.split('\n');
  // JSON lines + trailing newline means last element is empty string
  assert.equal(lines[lines.length - 1], '');
  assert.equal(lines.length, 2); // one data line + trailing newline
  assert.doesNotThrow(() => JSON.parse(lines[0]));
  assert.deepEqual(JSON.parse(lines[0]), data[0]);
});

test('writes multiple entries as separate JSON lines', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const data = [
    { workflow: 'ci.yml', status: 'success', duration: 120 },
    { workflow: 'audit.yml', status: 'failure', duration: 300 },
  ];
  const result = persistHealthSummary(data, { outputDir: dir });
  assert.ok(result);

  const content = fs.readFileSync(result, 'utf-8');
  const lines = content.split('\n');
  assert.equal(lines[lines.length - 1], '');
  assert.equal(lines.length, 3); // two data lines + trailing newline
  assert.deepEqual(JSON.parse(lines[0]), data[0]);
  assert.deepEqual(JSON.parse(lines[1]), data[1]);
});

// ---------------------------------------------------------------------------
// Custom opts: outputDir, prefix
// ---------------------------------------------------------------------------
test('uses custom outputDir', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = persistHealthSummary([{ x: 1 }], { outputDir: dir });
  assert.ok(result.startsWith(dir));
  assert.ok(fs.existsSync(result));
});

test('uses custom prefix in filename', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = persistHealthSummary([{ x: 1 }], { outputDir: dir, prefix: 'custom-prefix' });
  const filename = path.basename(result);
  assert.ok(filename.startsWith('custom-prefix-'), `Expected filename to start with "custom-prefix-", got "${filename}"`);
  assert.ok(filename.endsWith('.jsonl'));
});

// ---------------------------------------------------------------------------
// Timestamp formatting: replaces : and . with -
// ---------------------------------------------------------------------------
test('filename contains ISO timestamp with colons/dots replaced by dashes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const before = new Date();
  const result = persistHealthSummary([{ x: 1 }], { outputDir: dir, prefix: 'ts' });
  const after = new Date();
  const filename = path.basename(result, '.jsonl');
  // filename = ts-<timestamp>.jsonl, strip prefix
  const tsPart = filename.slice(3); // after "ts-"

  // Should not contain : or .
  assert.ok(!tsPart.includes(':'), `Timestamp should not contain ":", got "${tsPart}"`);
  assert.ok(!tsPart.includes('.'), `Timestamp should not contain ".", got "${tsPart}"`);

  // The impl stamps its own new Date() internally, which falls within [before, after].
  // Accept either adjacent date so a UTC-midnight boundary cannot flip the assertion.
  const datePart = tsPart.slice(0, 10); // YYYY-MM-DD portion
  const beforeDate = before.toISOString().slice(0, 10);
  const afterDate = after.toISOString().slice(0, 10);
  assert.ok(
    datePart === beforeDate || datePart === afterDate,
    `Expected date "${datePart}" to be ${beforeDate} or ${afterDate} (UTC midnight boundary tolerated)`,
  );
});

// ---------------------------------------------------------------------------
// Default opts (no outputDir, no prefix) — writes to cwd
// ---------------------------------------------------------------------------
test('defaults outputDir to "." and prefix to "health-summary" when no opts', () => {
  const origCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phs-'));
  process.chdir(dir);

  try {
    const result = persistHealthSummary([{ ok: true }]);
    assert.ok(result);
    const filename = path.basename(result);
    assert.ok(filename.startsWith('health-summary-'), `Expected default prefix "health-summary-", got "${filename}"`);
    assert.ok(filename.endsWith('.jsonl'));
  } finally {
    process.chdir(origCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
