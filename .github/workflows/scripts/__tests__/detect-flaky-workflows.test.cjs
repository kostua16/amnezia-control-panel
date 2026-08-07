/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const { isFlaky, buildEvidence } = require('../detect-flaky-workflows.cjs');

// ── isFlaky ──────────────────────────────────────────────────────

test('isFlaky returns false for fewer than 3 runs', () => {
  assert.equal(isFlaky([{ conclusion: 'success' }]), false);
  assert.equal(
    isFlaky([{ conclusion: 'success' }, { conclusion: 'failure' }]),
    false,
  );
  assert.equal(isFlaky([]), false);
  assert.equal(isFlaky(null), false);
});

test('isFlaky returns false for all-pass runs', () => {
  const runs = Array.from({ length: 5 }, () => ({ conclusion: 'success' }));
  assert.equal(isFlaky(runs), false);
});

test('isFlaky returns false for all-fail runs', () => {
  const runs = Array.from({ length: 5 }, () => ({ conclusion: 'failure' }));
  assert.equal(isFlaky(runs), false);
});

test('isFlaky detects alternating pass/fail pattern', () => {
  // newest first: fail, pass, fail, pass, fail
  const runs = [
    { conclusion: 'failure' },
    { conclusion: 'success' },
    { conclusion: 'failure' },
    { conclusion: 'success' },
    { conclusion: 'failure' },
  ];
  assert.equal(isFlaky(runs), true);
});

test('isFlaky detects timed_out as failure', () => {
  const runs = [
    { conclusion: 'timed_out' },
    { conclusion: 'success' },
    { conclusion: 'failure' },
    { conclusion: 'success' },
  ];
  assert.equal(isFlaky(runs), true);
});

test('isFlaky requires at least 2 failures', () => {
  // 1 failure, 3 successes, 2 transitions — not enough failures
  const runs = [
    { conclusion: 'success' },
    { conclusion: 'failure' },
    { conclusion: 'success' },
    { conclusion: 'success' },
  ];
  assert.equal(isFlaky(runs), false);
});

test('isFlaky requires at least 1 success', () => {
  const runs = [
    { conclusion: 'failure' },
    { conclusion: 'failure' },
    { conclusion: 'failure' },
  ];
  assert.equal(isFlaky(runs), false);
});

test('isFlaky requires at least 2 transitions', () => {
  // 2 failures + 1 success but only 1 transition (fail, fail, pass)
  const runs = [
    { conclusion: 'failure' },
    { conclusion: 'failure' },
    { conclusion: 'success' },
  ];
  assert.equal(isFlaky(runs), false);
});

test('isFlaky handles cancelled as success', () => {
  const runs = [
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
  ];
  assert.equal(isFlaky(runs), true);
});

// ── buildEvidence ─────────────────────────────────────────────────

test('buildEvidence produces markdown with run details', () => {
  const runs = [
    { conclusion: 'failure', run_number: 100, created_at: '2026-01-01T10:00:00Z' },
    { conclusion: 'success', run_number: 99, created_at: '2026-01-01T09:00:00Z' },
  ];
  const evidence = buildEvidence('Test WF', 6, runs);
  assert.ok(evidence.includes('**Workflow:** Test WF'));
  assert.ok(evidence.includes('**Lookback:** 6 hours'));
  assert.ok(evidence.includes('1 failure'));
  assert.ok(evidence.includes('- failure (run #100'));
});

test('buildEvidence limits to 8 runs', () => {
  const runs = Array.from({ length: 10 }, (_, i) => ({
    conclusion: 'success',
    run_number: 100 - i,
    created_at: '2026-01-01T10:00:00Z',
  }));
  const evidence = buildEvidence('Test', 6, runs);
  const runLines = evidence.split('\n').filter(l => l.startsWith('- '));
  assert.equal(runLines.length, 8);
});
