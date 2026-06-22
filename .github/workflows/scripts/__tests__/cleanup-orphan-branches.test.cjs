/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectOrphanBranches,
  collectPolicyPrefixes,
  deleteRefPath,
  parseMaxAgeDays,
} = require('../cleanup-orphan-branches.cjs');

test('deleteRefPath: includes the repos/ prefix required by the REST API', () => {
  assert.equal(
    deleteRefPath(
      'kostua16/amnezia-control-panel',
      'claude-workflow-optimize-1',
    ),
    'repos/kostua16/amnezia-control-panel/git/refs/heads/claude-workflow-optimize-1',
  );
});

test('deleteRefPath: preserves slashes in branch names', () => {
  assert.equal(
    deleteRefPath('o/r', 'claude/issue-9'),
    'repos/o/r/git/refs/heads/claude/issue-9',
  );
});

const NOW = Date.UTC(2026, 5, 23, 0, 0, 0); // 2026-06-23T00:00:00Z
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const OLD = new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10d ago
const FRESH = new Date(NOW - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1d ago
const PREFIXES = ['claude-workflow-optimize-', 'claude-gsd-planning-execute-'];

const branch = (name, date, extra = {}) => ({
  name,
  committedDate: date,
  ...extra,
});

test('parseMaxAgeDays: returns the default for a missing/empty argument', () => {
  assert.equal(parseMaxAgeDays(null, 7), 7);
  assert.equal(parseMaxAgeDays('', 7), 7);
});

test('parseMaxAgeDays: parses valid positive numbers (incl. decimals)', () => {
  assert.equal(parseMaxAgeDays('7', 7), 7);
  assert.equal(parseMaxAgeDays('14', 7), 14);
  assert.equal(parseMaxAgeDays('0.5', 7), 0.5);
});

test('parseMaxAgeDays: rejects non-numeric, zero, and negative as null', () => {
  assert.equal(parseMaxAgeDays('seven', 7), null);
  assert.equal(parseMaxAgeDays('0', 7), null);
  assert.equal(parseMaxAgeDays('-3', 7), null);
  assert.equal(parseMaxAgeDays('NaN', 7), null);
});
test('selectOrphanBranches: selects prefixed, old, non-open-PR branch', () => {
  const got = selectOrphanBranches(
    [branch('claude-workflow-optimize-123', OLD)],
    [],
    PREFIXES,
    { now: NOW, maxAgeMs: SEVEN_DAYS },
  );
  assert.deepEqual(
    got.map((b) => b.name),
    ['claude-workflow-optimize-123'],
  );
});

test('selectOrphanBranches: excludes the head of an open PR even when old + prefixed', () => {
  const got = selectOrphanBranches(
    [branch('claude-workflow-optimize-123', OLD)],
    ['claude-workflow-optimize-123'],
    PREFIXES,
    { now: NOW, maxAgeMs: SEVEN_DAYS },
  );
  assert.equal(got.length, 0);
});

test('selectOrphanBranches: excludes branches younger than the age threshold', () => {
  const got = selectOrphanBranches(
    [branch('claude-gsd-planning-execute-9', FRESH)],
    [],
    PREFIXES,
    { now: NOW, maxAgeMs: SEVEN_DAYS },
  );
  assert.equal(got.length, 0);
});

test('selectOrphanBranches: includes a branch exactly at the age threshold', () => {
  const exactlyOld = new Date(NOW - SEVEN_DAYS).toISOString();
  const got = selectOrphanBranches(
    [branch('claude-workflow-optimize-7d', exactlyOld)],
    [],
    PREFIXES,
    { now: NOW, maxAgeMs: SEVEN_DAYS },
  );
  assert.equal(got.length, 1);
});

test('selectOrphanBranches: excludes non-automation branches (default + feature)', () => {
  const got = selectOrphanBranches(
    [branch('main', OLD), branch('feature/x', OLD), branch('release-1', OLD)],
    [],
    PREFIXES,
    { now: NOW, maxAgeMs: SEVEN_DAYS },
  );
  assert.equal(got.length, 0);
});

test('selectOrphanBranches: excludes explicitly protected branches even if prefixed', () => {
  const got = selectOrphanBranches(
    [branch('claude-workflow-optimize-protected', OLD)],
    [],
    PREFIXES,
    {
      now: NOW,
      maxAgeMs: SEVEN_DAYS,
      protectedBranches: ['claude-workflow-optimize-protected'],
    },
  );
  assert.equal(got.length, 0);
});

test('selectOrphanBranches: skips entries with unknown commit date (safe default)', () => {
  const got = selectOrphanBranches(
    [branch('claude-workflow-optimize-nodate', 'not-a-date')],
    [],
    PREFIXES,
    { now: NOW, maxAgeMs: SEVEN_DAYS },
  );
  assert.equal(got.length, 0);
});

test('selectOrphanBranches: skips null / non-object / nameless entries', () => {
  const got = selectOrphanBranches(
    [null, 'x', {}, { name: '' }, branch('claude-workflow-optimize-ok', OLD)],
    [],
    PREFIXES,
    { now: NOW, maxAgeMs: SEVEN_DAYS },
  );
  assert.deepEqual(
    got.map((b) => b.name),
    ['claude-workflow-optimize-ok'],
  );
});

test('selectOrphanBranches: matches when any of several prefixes applies', () => {
  const got = selectOrphanBranches(
    [
      branch('claude-gsd-planning-execute-1', OLD),
      branch('claude-workflow-optimize-2', OLD),
    ],
    [],
    PREFIXES,
    { now: NOW, maxAgeMs: SEVEN_DAYS },
  );
  assert.equal(got.length, 2);
});

test('selectOrphanBranches: empty inputs yield empty result', () => {
  assert.deepEqual(
    selectOrphanBranches([], [], PREFIXES, { now: NOW, maxAgeMs: SEVEN_DAYS }),
    [],
  );
});

test('collectPolicyPrefixes: flattens all policy keys into a unique list', () => {
  const policy = {
    cleanupBranchPrefixes: ['codex/', 'claude/'],
    trustedAutomationBranchPrefixes: ['claude-auto-fix-ci-'],
    manualOnlyBranchPrefixes: ['claude-audit-fix-'],
    planningBranchPrefix: 'claude-planning-pr-',
    trustedPlanning: { branchPrefixes: ['claude-workflow-optimize-'] },
    gsdExecution: { branchPrefix: 'claude-gsd-planning-execute-' },
    auditSafe: {
      safeBranchPrefix: 'claude-audit-safe-fix-',
      manualBranchPrefix: 'claude-audit-fix-',
    },
    dependabot: { manualOnlyBranchPrefixes: ['dependabot/github_actions/'] },
  };
  const got = collectPolicyPrefixes(policy);
  const expected = [
    'codex/',
    'claude/',
    'claude-auto-fix-ci-',
    'claude-audit-fix-',
    'claude-planning-pr-',
    'claude-workflow-optimize-',
    'claude-gsd-planning-execute-',
    'claude-audit-safe-fix-',
    'dependabot/github_actions/',
  ];
  assert.deepEqual([...got].sort(), [...expected].sort());
});

test('collectPolicyPrefixes: dedups overlapping keys (claude-audit-fix- appears twice)', () => {
  const policy = {
    manualOnlyBranchPrefixes: ['claude-audit-fix-'],
    auditSafe: { manualBranchPrefix: 'claude-audit-fix-' },
  };
  assert.deepEqual(collectPolicyPrefixes(policy), ['claude-audit-fix-']);
});

test('collectPolicyPrefixes: tolerates missing keys and filters falsy entries', () => {
  assert.deepEqual(collectPolicyPrefixes({}), []);
  assert.deepEqual(
    collectPolicyPrefixes({ cleanupBranchPrefixes: ['x', '', null] }),
    ['x'],
  );
});
