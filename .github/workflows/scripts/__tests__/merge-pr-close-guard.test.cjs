/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const { canCloseSourcePr } = require('../merge-pr-close-guard.cjs');

const ALL_TRUE = {
  replacementPushed: true,
  replacementPrOpened: true,
  validationPassed: true,
  replacementGreen: true,
  bodyLinksAllSources: true,
  bodyListsFindings: true,
  sourceUnchangedSinceCollection: true,
  notDryRun: true,
  labelsPolicyOk: true,
};

test('closes when every condition is met', () => {
  const decision = canCloseSourcePr(ALL_TRUE);
  assert.equal(decision.canClose, true);
  assert.deepEqual(decision.reasons, []);
});

test('keeps open when any single condition is missing', () => {
  for (const key of Object.keys(ALL_TRUE)) {
    const conditions = { ...ALL_TRUE, [key]: false };
    const decision = canCloseSourcePr(conditions);
    assert.equal(decision.canClose, false, `${key} should block closure`);
    assert.equal(decision.reasons.length, 1);
  }
});

test('dry run blocks closure even when everything else is green', () => {
  const decision = canCloseSourcePr({ ...ALL_TRUE, dryRun: 'true' });
  assert.equal(decision.canClose, false);
  assert.match(decision.reasons.join('; '), /not a dry run/);
});

test('dryRun false (write mode) allows closure when other conditions hold', () => {
  const decision = canCloseSourcePr({
    ...ALL_TRUE,
    notDryRun: undefined,
    dryRun: 'false',
  });
  assert.equal(decision.canClose, true);
});

test('accepts string "true" outputs from GitHub steps', () => {
  const stringTrue = Object.fromEntries(
    Object.keys(ALL_TRUE).map((k) => [k, 'true']),
  );
  assert.equal(canCloseSourcePr(stringTrue).canClose, true);
});

test('reports every missing reason, not just the first', () => {
  const decision = canCloseSourcePr({
    ...ALL_TRUE,
    validationPassed: false,
    replacementGreen: false,
  });
  assert.equal(decision.canClose, false);
  assert.equal(decision.reasons.length, 2);
});
