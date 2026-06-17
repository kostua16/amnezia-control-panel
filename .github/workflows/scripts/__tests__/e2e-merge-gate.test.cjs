/* eslint-disable @typescript-eslint/no-require-imports */
// E2E §1 — merge gate (pr-finalizer). See docs/workflow-e2e-scenarios.md.
// char = lock current behavior (green); test.todo = spec for a Phase-2 fix (red today).
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCheck,
  mergeGateDecision,
} = require('../lib/e2e-simulator.cjs');
const { getRequiredCheckStatus } = require('../required-check-evidence.cjs');

// Model CI as a single required check named "CI" (decision logic is independent
// of how many jobs ci.yml has).
const CI = [{ names: ['CI'], workflow: 'CI' }];
const ciPassing = [buildCheck('CI', { workflow: 'CI' })];
const ciFailing = [buildCheck('CI', { workflow: 'CI', bucket: 'fail', state: 'failure' })];
const ciPending = [buildCheck('CI', { workflow: 'CI', bucket: 'pending', state: 'in_progress' })];
const ciSkipped = [buildCheck('CI', { workflow: 'CI', bucket: 'cancel', state: 'skipped' })];

// decision helper: trusted-ready policy by default, override per case
const mg = (policyOverrides, checks = ciPassing) =>
  mergeGateDecision({ policy: policyOverrides, checks, requiredChecks: CI }).decision;

// ---------- required-check aggregator (the M11/M12 bug surface) ----------
test('aggregator: success → passed', () => {
  assert.equal(getRequiredCheckStatus(ciPassing, CI).status, 'passed');
});

test('aggregator: failure → failed', () => {
  assert.equal(getRequiredCheckStatus(ciFailing, CI).status, 'failed');
});

test('M11 char: SKIPPED check → cancel bucket counted as failing (blocks today)', () => {
  const s = getRequiredCheckStatus(ciSkipped, CI);
  assert.equal(s.status, 'failed');
  assert.deepEqual(s.failing, ['CI']);
});

test('M12 char: MISSING check → pending (strands PR if path-filtered out)', () => {
  const s = getRequiredCheckStatus([], CI);
  assert.equal(s.status, 'pending');
  assert.deepEqual(s.missing, ['CI']);
});

// ---------- finalizer decision tree (§1) ----------
test('M1 char: draft → awaiting_checks', () => {
  assert.equal(mg({ is_draft: true }), 'awaiting_checks');
});

test('M2 char: hard block label → blocked', () => {
  assert.equal(mg({ blocking_labels_present: ['do-not-merge'] }), 'blocked');
});

test('M3 char: needs-review, non-maintainer → manual_only', () => {
  assert.equal(
    mg({ blocking_labels_present: ['needs-review'], maintainer_approved: false }),
    'manual_only',
  );
});

test('M4 char: needs-review, maintainer-approved → approve_and_enable_automerge', () => {
  assert.equal(
    mg({ blocking_labels_present: ['needs-review'], maintainer_approved: true }),
    'approve_and_enable_automerge',
  );
});

test('M5 char: manualOnly policy → manual_only', () => {
  assert.equal(mg({ manual_only: true, maintainer_approved: false }), 'manual_only');
});

test('M7 char: fork / cross-repo (same_repo=false) → manual_only', () => {
  assert.equal(mg({ same_repo: false }), 'manual_only');
});

test('M9 char: required check FAILED → blocked', () => {
  assert.equal(mg({}, ciFailing), 'blocked');
});

test('M10 char: required check PENDING → awaiting_checks', () => {
  assert.equal(mg({}, ciPending), 'awaiting_checks');
});

test('M11 char: SKIPPED check → blocked (cancel bucket = failing)', () => {
  assert.equal(mg({}, ciSkipped), 'blocked');
});

test('M12 char: MISSING check → awaiting_checks', () => {
  assert.equal(mg({}, []), 'awaiting_checks');
});

test('M13 char: all review labels + checks pass + trusted → approve_and_enable_automerge', () => {
  assert.equal(mg({}), 'approve_and_enable_automerge');
});

test('M14 char: all pass + untrusted → manual_only', () => {
  assert.equal(mg({ same_repo: false }), 'manual_only');
});

test('M15 char: missing required_pass_label → awaiting_checks', () => {
  assert.equal(mg({ labels: [] }), 'awaiting_checks');
});

// ---------- specs (desired; RED today → test.todo, activated + fixed in Phase 2 P0-1) ----------
test.todo('M11 spec: SKIPPED required check must NOT block → approve_and_enable_automerge (P0-1)');
test.todo('M12 spec: MISSING (path-filtered) required check must NOT strand PR → approve_and_enable_automerge (P0-1)');

// ---------- out of scope for the decision function (documented in the catalog) ----------
// M6/M8 feed the same manual_only branch as M5 (upstream evaluate-pr-policy sets manual_only).
// M16 auto-merge ENABLEMENT failure is a shell step (pr-finalizer.yml:146), not a decision output.
// M18 a later check going red after auto-merge is armed is a GitHub-side temporal event.
// M19 dry_run is a main() arg suppressing the action; the decision is unchanged.
