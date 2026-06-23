/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateRebaseEligibility,
} = require('../evaluate-rebase-eligibility.cjs');

const HEAD = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
const basePr = {
  state: 'OPEN',
  mergedAt: null,
  headRefName: 'feature/x',
  headRefOid: HEAD,
  baseRefName: 'main',
  autoMergeRequest: null,
};
const baseEval = { same_repo: true, is_draft: false, labels: [] };

test('eligible: open same-repo non-draft PR without do-not-merge', () => {
  const r = evaluateRebaseEligibility(basePr, baseEval, '');
  assert.equal(r.eligible, true);
  assert.equal(r.reason, null);
  assert.equal(r.do_not_merge, false);
  assert.equal(r.stale_head, false);
});

test('draft PR is not rebase-eligible', () => {
  const r = evaluateRebaseEligibility(
    basePr,
    { ...baseEval, is_draft: true },
    '',
  );
  assert.equal(r.eligible, false);
  assert.match(r.reason, /draft/);
});

test('cross-repository PR is not rebase-eligible', () => {
  const r = evaluateRebaseEligibility(
    basePr,
    { ...baseEval, same_repo: false },
    '',
  );
  assert.equal(r.eligible, false);
  assert.match(r.reason, /cross-repositor/);
});

test('closed PR is not rebase-eligible', () => {
  const r = evaluateRebaseEligibility(
    { ...basePr, state: 'CLOSED' },
    baseEval,
    '',
  );
  assert.equal(r.eligible, false);
  assert.match(r.reason, /state/);
});

test('merged PR is not rebase-eligible', () => {
  const r = evaluateRebaseEligibility(
    { ...basePr, mergedAt: '2026-01-01T00:00:00Z' },
    baseEval,
    '',
  );
  assert.equal(r.eligible, false);
  assert.match(r.reason, /merged/);
});

test('do-not-merge blocks a rebase (other blocking labels do not)', () => {
  const blocked = evaluateRebaseEligibility(
    basePr,
    { ...baseEval, labels: ['do-not-merge'] },
    '',
  );
  assert.equal(blocked.eligible, false);
  assert.match(blocked.reason, /do-not-merge/);

  // needs-review / ai-review-concerns block MERGE, not a branch refresh.
  const refreshable = evaluateRebaseEligibility(
    basePr,
    { ...baseEval, labels: ['needs-review', 'ai-review-concerns'] },
    '',
  );
  assert.equal(refreshable.eligible, true);
});

test('head SHA stale guard: mismatched expected head is rejected', () => {
  const r = evaluateRebaseEligibility(basePr, baseEval, 'deadbeef');
  assert.equal(r.eligible, false);
  assert.equal(r.stale_head, true);
  assert.match(r.reason, /expected head/);
});

test('head SHA stale guard: matching expected head is accepted', () => {
  const r = evaluateRebaseEligibility(basePr, baseEval, HEAD);
  assert.equal(r.eligible, true);
  assert.equal(r.stale_head, false);
});

test('missing head ref is not rebase-eligible', () => {
  const r = evaluateRebaseEligibility(
    { ...basePr, headRefName: '', headRefOid: null },
    baseEval,
    '',
  );
  assert.equal(r.eligible, false);
  assert.match(r.reason, /head/);
});

test('auto_merge_enabled reflects the autoMergeRequest state', () => {
  const on = evaluateRebaseEligibility(
    {
      ...basePr,
      autoMergeRequest: { enabledAt: '2026-01-01T00:00:00Z' },
    },
    baseEval,
    '',
  );
  assert.equal(on.auto_merge_enabled, true);
  assert.equal(on.eligible, true);
});
