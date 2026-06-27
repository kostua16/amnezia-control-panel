/* eslint-disable @typescript-eslint/no-require-imports */
// E2E §1 — merge gate (pr-finalizer). See docs/workflow-e2e-scenarios.md.
// char = lock current behavior (green); test.todo = spec for a Phase-2 fix (red today).
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCheck, mergeGateDecision } = require('../lib/e2e-simulator.cjs');
const { getRequiredCheckStatus } = require('../required-check-evidence.cjs');

// Model CI as a single required check named "CI" (decision logic is independent
// of how many jobs ci.yml has).
const CI = [{ names: ['CI'], workflow: 'CI' }];
const ciPassing = [buildCheck('CI', { workflow: 'CI' })];
const ciFailing = [
  buildCheck('CI', { workflow: 'CI', bucket: 'fail', state: 'failure' }),
];
const ciPending = [
  buildCheck('CI', { workflow: 'CI', bucket: 'pending', state: 'in_progress' }),
];
const ciSkipped = [
  buildCheck('CI', { workflow: 'CI', bucket: 'skip', state: 'skipped' }),
];
const ciCancelled = [
  buildCheck('CI', { workflow: 'CI', bucket: 'cancel', state: 'cancelled' }),
];

// decision helper: trusted-ready policy by default, override per case
const mg = (policyOverrides, checks = ciPassing) =>
  mergeGateDecision({ policy: policyOverrides, checks, requiredChecks: CI })
    .decision;

// ---------- required-check aggregator (the M11/M12 bug surface) ----------
test('aggregator: success → passed', () => {
  assert.equal(getRequiredCheckStatus(ciPassing, CI).status, 'passed');
});

test('aggregator: failure → failed', () => {
  assert.equal(getRequiredCheckStatus(ciFailing, CI).status, 'failed');
});

test('skipped required check is non-blocking (intentional non-run)', () => {
  const s = getRequiredCheckStatus(ciSkipped, CI);
  assert.equal(s.status, 'passed');
  assert.deepEqual(s.failing, []);
  assert.deepEqual(s.pending, []);
});

// A skipped required check must still block when a sibling job in the same
// workflow failed: GitHub reports a failed `needs:` dependency's dependents as
// "skipped", which would otherwise mask a real failure. Run-cleanliness guard
// added in #443 (see kilo-code-bot review on that PR).
test('skipped required check blocks when a sibling job in the same workflow failed', () => {
  const checks = [
    buildCheck('CI', { workflow: 'CI', bucket: 'skip', state: 'skipped' }),
    buildCheck('install', { workflow: 'CI', bucket: 'fail', state: 'failure' }),
  ];
  const s = getRequiredCheckStatus(checks, CI);
  assert.equal(s.status, 'failed');
  assert.deepEqual(s.failing, ['CI']);
});

test('cancelled required check still blocks (aborted, did not pass)', () => {
  const s = getRequiredCheckStatus(ciCancelled, CI);
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
    mg({
      blocking_labels_present: ['needs-review'],
      maintainer_approved: false,
    }),
    'manual_only',
  );
});

test('M4 char: needs-review, maintainer-approved → approve_and_enable_automerge', () => {
  assert.equal(
    mg({
      blocking_labels_present: ['needs-review'],
      maintainer_approved: true,
    }),
    'approve_and_enable_automerge',
  );
});

test('M5 char: manualOnly policy → manual_only', () => {
  assert.equal(
    mg({ manual_only: true, maintainer_approved: false }),
    'manual_only',
  );
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

test('skipped required check does not block merge', () => {
  assert.equal(mg({}, ciSkipped), 'approve_and_enable_automerge');
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

// ---------- specs ----------
// M11 (skipped non-blocking) + M12 (path-filtered required check) resolved:
// ci.yml gates heavy jobs on a `changes` job (P0-1b) so docs-only changes skip
// them — the required checks report `skipped`, which is non-blocking (P0-1a).
// A genuinely-missing check still correctly blocks (pending) — see M12 char tests.
// Guarded by workflow-triggers.test.ts (heavy jobs need [changes]).

// ---------- maintainer-approved gate preservation ----------
test('maintainer-approved does NOT bypass hard-blocker label do-not-merge', () => {
  assert.equal(
    mg({
      blocking_labels_present: ['do-not-merge'],
      maintainer_approved: true,
    }),
    'blocked',
  );
});

test('maintainer-approved does NOT bypass hard-blocker label ai-review-concerns', () => {
  assert.equal(
    mg({
      blocking_labels_present: ['ai-review-concerns'],
      maintainer_approved: true,
    }),
    'blocked',
  );
});

test('maintainer-approved does NOT bypass draft status', () => {
  assert.equal(
    mg({ is_draft: true, maintainer_approved: true }),
    'awaiting_checks',
  );
});

test('maintainer-approved does NOT bypass cross-repo restriction', () => {
  assert.equal(
    mg({ same_repo: false, maintainer_approved: true }),
    'manual_only',
  );
});

test('maintainer-approved overrides manualOnly policy', () => {
  assert.equal(
    mg({ manual_only: true, maintainer_approved: true }),
    'approve_and_enable_automerge',
  );
});

test('maintainer-approved does NOT bypass failing required checks', () => {
  assert.equal(mg({ maintainer_approved: true }, ciFailing), 'blocked');
});

test('maintainer-approved does NOT bypass pending required checks', () => {
  assert.equal(mg({ maintainer_approved: true }, ciPending), 'awaiting_checks');
});

// ---------- out of scope for the decision function (documented in the catalog) ----------
// M6/M8 feed the same manual_only branch as M5 (upstream evaluate-pr-policy sets manual_only).
// M16 auto-merge ENABLEMENT failure is a shell step (pr-finalizer.yml:146), not a decision output.
// M18 a later check going red after auto-merge is armed is a GitHub-side temporal event.
// M19 dry_run is a main() arg suppressing the action; the decision is unchanged.
