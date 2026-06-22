/* eslint-disable @typescript-eslint/no-require-imports */
// E2E §4 — autonomous-PR lane classification (audit-fix safe vs manual).
// classifyAuditFix is a pure exported fn; we drive it with synthetic fileDetails
// + the real policy.json auditSafe config. See docs/workflow-e2e-scenarios.md
// (P-cases).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyAuditFix } = require('../classify-audit-fix.cjs');

const policy = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'policy.json'), 'utf8'),
);

function classify(fileDetails, mode = 'auto') {
  return classifyAuditFix({ mode, policy, runId: '123', fileDetails });
}

test('P5 char: small diff within safe allow-list → safe lane (auto-merge eligible)', () => {
  const r = classify([{ path: 'src/components/Button.tsx', additions: 5, deletions: 2 }]);
  assert.equal(r.eligible, true);
  assert.ok(r.branch_name.startsWith('claude-audit-safe-fix-'), r.branch_name);
  assert.ok(r.labels.includes('audit-safe'));
  assert.equal(r.draft, 'false');
});

test('P6 char: diff touches manual-only path (.github/**) → manual lane', () => {
  const r = classify([{ path: '.github/workflows/ci.yml', additions: 1, deletions: 1 }]);
  assert.equal(r.eligible, false);
  assert.ok(r.branch_name.startsWith('claude-audit-fix-'), r.branch_name);
  assert.ok(r.labels.includes('needs-review'));
  assert.equal(r.draft, 'true');
});

test('P6 char: manual-only mode requested → manual lane regardless of diff', () => {
  const r = classify(
    [{ path: 'src/components/Button.tsx', additions: 5, deletions: 2 }],
    'manual-only',
  );
  assert.equal(r.eligible, false);
  assert.ok(r.branch_name.startsWith('claude-audit-fix-'), r.branch_name);
  assert.ok(r.labels.includes('needs-review'));
});

test('P4 char: no changes → ineligible, reason "no changes"', () => {
  const r = classify([]);
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'no changes');
});
