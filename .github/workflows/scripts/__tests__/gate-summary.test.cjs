/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BANNER,
  label,
  renderGateComparison,
  renderGateSummary,
} = require('../lib/gate-summary.cjs');

test('label normalizes GitHub step outcomes', () => {
  assert.equal(label('success'), 'pass');
  assert.equal(label('failure'), 'fail');
  assert.equal(label('skipped'), 'skipped');
  assert.equal(label(undefined), 'unknown');
  assert.equal(label(''), 'unknown');
});

test('renderGateSummary always shows the banner + authoritative gate block', () => {
  const body = renderGateSummary({
    gateOutcomes: {
      lint: 'success',
      typecheck: 'success',
      format: 'success',
      test: 'success',
      build: 'success',
      scriptTests: 'success',
      prismaSafe: 'success',
    },
  });
  assert.ok(body.includes(BANNER));
  assert.ok(body.includes('Workflow gate (authoritative):'));
  assert.ok(body.includes('- lint (tracked files): **pass**'));
  assert.ok(body.includes('- typecheck: **pass**'));
  assert.ok(body.includes('- format (prettier): **pass**'));
  assert.ok(body.includes('- build: **pass**'));
  assert.ok(body.includes('- prisma-safe-sql: **pass**'));
  // No agent block when agentValidation is absent.
  assert.ok(!body.includes('Agent-reported'));
});

test('renderGateSummary shows the agent-reported block when provided', () => {
  const body = renderGateSummary({
    agentValidation: { tsc: 'pass', lint: 'pass', tests: 'pass' },
    gateOutcomes: {
      lint: 'failure',
      test: 'success',
      build: 'skipped',
      scriptTests: 'success',
      prismaSafe: 'success',
    },
  });
  // Both blocks present — the contradiction (agent pass, gate fail) is visible.
  assert.ok(body.includes('Agent-reported (may be inaccurate):'));
  assert.ok(body.includes('- lint: **pass**'));
  assert.ok(body.includes('Workflow gate (authoritative):'));
  assert.ok(body.includes('- lint (tracked files): **fail**'));
  assert.ok(body.includes('- build: **skipped**'));
  assert.ok(body.includes(BANNER));
});

test('renderGateSummary keeps partial agent reports and unknown outcomes', () => {
  const body = renderGateSummary({
    agentValidation: { build: 'pass' },
    gateOutcomes: {
      lint: undefined,
      test: 'success',
      build: 'success',
      scriptTests: 'success',
      prismaSafe: 'success',
    },
  });
  assert.ok(body.includes('- build: **pass**'));
  // Missing gate outcomes render as 'unknown' rather than crashing.
  assert.ok(body.includes('- lint (tracked files): **unknown**'));
});

test('renderGateComparison explains unavailable baseline with green post gate', () => {
  const body = renderGateComparison({
    no_new_failures: true,
    baseline_unavailable: true,
    post_all_passing: true,
    new_failures: [],
    pre_existing_failures: [],
    improved_failures: [],
  });

  assert.ok(body.includes('no new failures introduced'));
  assert.ok(
    body.includes('Baseline gate: unavailable, but post-rebase gate is green.'),
  );
  assert.ok(!body.includes('fail-closed'));
});
