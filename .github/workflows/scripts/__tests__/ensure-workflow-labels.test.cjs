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
