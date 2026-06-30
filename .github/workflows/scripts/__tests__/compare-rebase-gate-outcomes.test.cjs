/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareGateOutcomes,
  isPassingOutcome,
  renderComparisonSummary,
} = require('../compare-rebase-gate-outcomes.cjs');

const GREEN = {
  lint: 'success',
  typecheck: 'success',
  format: 'success',
  test: 'success',
  build: 'success',
  scriptTests: 'success',
  prismaSafe: 'success',
};

test('post all green grants no-worse permission', () => {
  const result = compareGateOutcomes({
    baseline: {},
    post: GREEN,
  });

  assert.equal(result.no_new_failures, true);
  assert.equal(result.post_all_passing, true);
  assert.equal(result.baseline_unavailable, true);
});

test('pre-existing format failure grants no-worse permission', () => {
  const result = compareGateOutcomes({
    baseline: { ...GREEN, format: 'failure' },
    post: { ...GREEN, format: 'failure' },
  });

  assert.equal(result.no_new_failures, true);
  assert.deepEqual(
    result.pre_existing_failures.map((row) => row.key),
    ['format'],
  );
  assert.deepEqual(result.new_failures, []);
});

test('new format failure blocks no-worse permission', () => {
  const result = compareGateOutcomes({
    baseline: GREEN,
    post: { ...GREEN, format: 'failure' },
  });

  assert.equal(result.no_new_failures, false);
  assert.deepEqual(
    result.new_failures.map((row) => row.key),
    ['format'],
  );
});

test('improved baseline failure is reported', () => {
  const result = compareGateOutcomes({
    baseline: { ...GREEN, format: 'failure' },
    post: GREEN,
  });

  assert.equal(result.no_new_failures, true);
  assert.deepEqual(
    result.improved_failures.map((row) => row.key),
    ['format'],
  );
});

test('missing baseline fails closed unless post gate is green', () => {
  const result = compareGateOutcomes({
    baseline: { ...GREEN, format: '' },
    post: { ...GREEN, format: 'failure' },
  });

  assert.equal(result.baseline_unavailable, true);
  assert.equal(result.no_new_failures, false);
});

test('skipped build is treated as pass', () => {
  assert.equal(isPassingOutcome('build', 'skipped'), true);
  assert.equal(isPassingOutcome('lint', 'skipped'), false);

  const result = compareGateOutcomes({
    baseline: { ...GREEN, build: 'skipped' },
    post: { ...GREEN, build: 'skipped' },
  });

  assert.equal(result.no_new_failures, true);
});

test('renderComparisonSummary names pre-existing and new failures', () => {
  const comparison = compareGateOutcomes({
    baseline: { ...GREEN, format: 'failure' },
    post: { ...GREEN, format: 'failure', lint: 'failure' },
  });
  const summary = renderComparisonSummary(comparison);

  assert.match(summary, /New failures:/);
  assert.match(summary, /lint \(tracked files\)/);
  assert.match(summary, /Pre-existing failures:/);
  assert.match(summary, /format \(prettier\)/);
});
