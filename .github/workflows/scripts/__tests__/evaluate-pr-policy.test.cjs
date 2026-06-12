/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { evaluatePrPolicy, readJson } = require('../evaluate-pr-policy.cjs');

const policy = readJson(path.join(__dirname, '..', '..', 'policy.json'));

function makePr(overrides = {}) {
  return {
    title: 'feat: update implementation',
    labels: [],
    headRefName: 'codex/example',
    baseRefName: 'main',
    isDraft: false,
    isCrossRepository: false,
    ...overrides,
  };
}

test('blocks committed graphify generated state', () => {
  const result = evaluatePrPolicy(makePr(), policy, [
    {
      filename: 'graphify-out/graph.json',
      additions: 1,
      deletions: 1,
    },
  ]);

  assert.equal(result.eligible, false);
  assert.equal(result.manual_only, true);
  assert.match(result.blocked_reason, /local cache/);
  assert.deepEqual(result.generated_state.matched_generated_state_paths, [
    'graphify-out/graph.json',
  ]);
});

test('keeps normal source changes out of generated-state policy', () => {
  const result = evaluatePrPolicy(makePr(), policy, [
    {
      filename: 'src/lib/api-response.ts',
      additions: 3,
      deletions: 1,
    },
  ]);

  assert.equal(result.manual_only, false);
  assert.equal(result.blocked_reason, null);
  assert.equal(result.generated_state.eligible, true);
  assert.deepEqual(result.generated_state.matched_generated_state_paths, []);
});
