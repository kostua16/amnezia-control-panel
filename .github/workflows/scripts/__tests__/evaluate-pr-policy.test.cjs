/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { evaluatePrPolicy, readJson } = require('../evaluate-pr-policy.cjs');

const policy = readJson(path.join(__dirname, '..', '..', 'policy.json'));
const auditSafePr = {
  headRefName: policy.auditSafe.safeBranchPrefix + '12345',
  labels: ['ai-review-passed', 'security-review-passed'],
};

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

test('carries maintainer associations into the evaluated policy output', () => {
  const result = evaluatePrPolicy(makePr(), policy, []);

  assert.deepEqual(
    result.maintainerAssociations,
    policy.maintainerAssociations,
  );
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

test('allows audit-safe source changes up to relaxed file and line limits', () => {
  const files = [
    {
      filename: 'src/components/dashboard/panel-card-expanded.tsx',
      additions: 1,
      deletions: 12,
    },
    {
      filename: 'src/components/dashboard/resource-monitor.tsx',
      additions: 2,
      deletions: 21,
    },
    {
      filename: 'src/components/dashboard/traffic-stats.tsx',
      additions: 1,
      deletions: 9,
    },
    {
      filename: 'src/lib/__tests__/usage-colors.test.ts',
      additions: 41,
      deletions: 0,
    },
    {
      filename: 'src/lib/usage-colors.ts',
      additions: 13,
      deletions: 0,
    },
    {
      filename: 'src/types/api.ts',
      additions: 1,
      deletions: 0,
    },
  ];

  const result = evaluatePrPolicy(makePr(auditSafePr), policy, files);

  assert.equal(result.eligible, true);
  assert.equal(result.manual_only, false);
  assert.equal(result.blocked_reason, null);
  assert.equal(result.audit_safe.changed_files_count, 6);
  assert.equal(result.audit_safe.total_changed_lines, 101);
  assert.equal(result.audit_safe.max_files, 10);
  assert.equal(result.audit_safe.max_changed_lines, 400);
});

test('keeps sensitive audit-safe library paths manual-only', () => {
  const result = evaluatePrPolicy(makePr(auditSafePr), policy, [
    {
      filename: 'src/lib/auth.ts',
      additions: 1,
      deletions: 1,
    },
  ]);

  assert.equal(result.eligible, false);
  assert.equal(result.manual_only, true);
  assert.match(result.blocked_reason, /manual-only paths/);
  assert.deepEqual(result.audit_safe.matched_manual_paths, ['src/lib/auth.ts']);
});

test('keeps sensitive audit-safe type paths manual-only', () => {
  const result = evaluatePrPolicy(makePr(auditSafePr), policy, [
    {
      filename: 'src/types/user.ts',
      additions: 1,
      deletions: 1,
    },
  ]);

  assert.equal(result.eligible, false);
  assert.equal(result.manual_only, true);
  assert.match(result.blocked_reason, /manual-only paths/);
  assert.deepEqual(result.audit_safe.matched_manual_paths, [
    'src/types/user.ts',
  ]);
});

test('keeps audit-safe PRs with unknown line counts manual-only', () => {
  const result = evaluatePrPolicy(makePr(auditSafePr), policy, [
    'src/lib/usage-colors.ts',
  ]);

  assert.equal(result.eligible, false);
  assert.equal(result.manual_only, true);
  assert.match(result.blocked_reason, /changed line counts unavailable/);
  assert.deepEqual(result.audit_safe.unknown_line_paths, [
    'src/lib/usage-colors.ts',
  ]);
});

test('keeps audit-safe PRs with unavailable changed files manual-only', () => {
  const result = evaluatePrPolicy(makePr(auditSafePr), policy, []);

  assert.equal(result.eligible, false);
  assert.equal(result.manual_only, true);
  assert.equal(
    result.blocked_reason,
    'audit-safe changed files are unavailable',
  );
});
