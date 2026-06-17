/* eslint-disable @typescript-eslint/no-require-imports */
// E2E §3 (AI-review gate) + §6a (fix-issue gate) via evaluate-trigger-policy.
// evaluate-trigger-policy.cjs is CLI-only (no exports), so we spawn it the same
// way scripts/__tests__/evaluate-trigger-policy.test.cjs does. See
// docs/workflow-e2e-scenarios.md (R-cases, F-cases).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const scriptPath = path.join(
  repoRoot,
  '.github/workflows/scripts/evaluate-trigger-policy.cjs',
);
const policyPath = path.join(repoRoot, '.github/workflows/policy.json');

function runMode({ mode, eventName, event }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-review-'));
  const eventPath = path.join(tempDir, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify(event), 'utf8');
  const output = execFileSync(
    process.execPath,
    [
      scriptPath,
      '--mode',
      mode,
      '--policy-file',
      policyPath,
      '--event-path',
      eventPath,
      '--event-name',
      eventName,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return JSON.parse(output);
}

// ---------- §3 AI-review mention gate (parametrized over provider) ----------
test('R1 char: maintainer @mention → triggered + trusted', () => {
  const out = runMode({
    mode: 'claude',
    eventName: 'issue_comment',
    event: { comment: { body: '@claude please fix', author_association: 'OWNER' } },
  });
  assert.equal(out.triggered, true);
  assert.equal(out.trusted, true);
});

test('R3 char: non-maintainer @mention → triggered but NOT trusted', () => {
  const out = runMode({
    mode: 'claude',
    eventName: 'issue_comment',
    event: { comment: { body: '@claude please fix', author_association: 'NONE' } },
  });
  assert.equal(out.triggered, true);
  assert.equal(out.trusted, false);
});

test('R7 char: workflow_dispatch review → should_run + trusted', () => {
  const out = runMode({
    mode: 'antigravity-review',
    eventName: 'workflow_dispatch',
    event: { inputs: { pr_number: '42' } },
  });
  assert.equal(out.should_run, true);
  assert.equal(out.trusted, true);
  assert.equal(out.trigger_source, 'workflow_dispatch');
});

// ---------- §6a fix-issue gate ----------
test('F1 char: maintainer /fix on an open issue → should_run (comment)', () => {
  const out = runMode({
    mode: 'fix-issue',
    eventName: 'issue_comment',
    event: {
      issue: { number: 5, state: 'open' },
      comment: { body: '/fix the bug', author_association: 'OWNER' },
    },
  });
  assert.equal(out.should_run, true);
  assert.equal(out.trigger_source, 'comment');
});

test('F2 char: non-maintainer /fix → should_run false', () => {
  const out = runMode({
    mode: 'fix-issue',
    eventName: 'issue_comment',
    event: {
      issue: { number: 5, state: 'open' },
      comment: { body: '/fix the bug', author_association: 'NONE' },
    },
  });
  assert.equal(out.should_run, false);
});

test('F6 char: /fix on a PR-linked issue → should_run false (open-issue guard)', () => {
  const out = runMode({
    mode: 'fix-issue',
    eventName: 'issue_comment',
    event: {
      // issue.pull_request present ⇒ not an open standalone issue
      issue: { number: 5, state: 'open', pull_request: { url: 'x' } },
      comment: { body: '/fix the bug', author_association: 'OWNER' },
    },
  });
  assert.equal(out.should_run, false);
});
