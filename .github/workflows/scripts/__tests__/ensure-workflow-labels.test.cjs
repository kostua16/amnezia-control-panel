/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureLabel, ensureLabels } = require('../ensure-workflow-labels.cjs');

const LABEL = { color: '5319e7', description: 'test label' };

test('ensureLabel retries transient failures and succeeds', () => {
  let calls = 0;
  const waits = [];
  const ok = ensureLabel('skip-improve', LABEL, {
    run: () => {
      calls += 1;
      if (calls < 3) {
        const error = new Error('HTTP 500');
        error.stderr = 'HTTP 500 (https://api.github.com/...)';
        throw error;
      }
    },
    wait: (ms) => waits.push(ms),
  });

  assert.equal(ok, true);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 4000]);
});

test('ensureLabel warns and continues after exhausting retries', () => {
  let calls = 0;
  const ok = ensureLabel('skip-improve', LABEL, {
    run: () => {
      calls += 1;
      throw new Error('HTTP 500');
    },
    wait: () => {},
  });

  assert.equal(ok, false);
  assert.equal(calls, 3);
});

test('ensureLabels keeps going past a failing label and reports the count', () => {
  const ensured = ensureLabels(
    ['good', 'flaky'],
    { good: LABEL, flaky: LABEL },
    {
      run: (args) => {
        if (args.includes('flaky')) throw new Error('HTTP 502');
      },
      wait: () => {},
    },
  );
  assert.equal(ensured, 1);
});

test('ensureLabels still throws for a label missing from policy', () => {
  assert.throws(
    () => ensureLabels(['unknown'], {}, { run: () => {}, wait: () => {} }),
    /not defined in the policy file/,
  );
});

test('every label ensured by a workflow or action is defined in policy.json', () => {
  // ensure-workflow-labels.cjs throws at runtime for a label missing from
  // policy.json, which kills the calling workflow at its setup step — the
  // triage-failed label was ensured by issue-catch-up but never defined,
  // and every hourly sweep died there until the label landed in policy.
  // This scan makes that mismatch a test failure instead of a prod outage.
  const fs = require('node:fs');
  const path = require('node:path');
  const policy = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', '..', 'policy.json'), 'utf8'),
  );
  const roots = [
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..', '..', '..', 'actions'),
  ];
  const files = [];
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (entry.isFile() && /\.ya?ml$/.test(entry.name)) {
        files.push(path.join(entry.parentPath ?? entry.path, entry.name));
      }
    }
  }
  assert.ok(files.length > 0, 'no workflow/action YAML files found to scan');
  const referenced = new Set();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(
      /^\s*(?:names|ensure-labels):\s*'?([a-z0-9\/,-]+)'?\s*$/gim,
    )) {
      for (const name of match[1].split(',')) {
        if (name) referenced.add(name.trim());
      }
    }
  }
  assert.ok(referenced.has('triage-failed'), 'scan lost the ensured lists');
  const missing = [...referenced].filter((name) => !policy.labels[name]);
  assert.deepEqual(
    missing,
    [],
    `labels ensured by workflows but missing from policy.json: ${missing.join(', ')}`,
  );
});
