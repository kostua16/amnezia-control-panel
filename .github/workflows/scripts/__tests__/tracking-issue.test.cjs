/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isTrackingIssue,
  normalizeLabels,
} = require('../lib/tracking-issue.cjs');
const { detectFromEnv } = require('../detect-tracking-issue.cjs');

// ---------------------------------------------------------------------------
// isTrackingIssue — title prefixes
// ---------------------------------------------------------------------------
test('detects [todo-backlog] umbrella by title prefix', () => {
  assert.equal(
    isTrackingIssue({
      title: '[todo-backlog] audit-fix: optimize/audit review backlog (AFX)',
    }),
    true,
  );
});

test('detects [claude-health] rolling tracker by title prefix', () => {
  assert.equal(
    isTrackingIssue({ title: '[claude-health] CI Claude Issue Tracker' }),
    true,
  );
});

test('detects [GROUPED] canonical issue case-insensitively', () => {
  assert.equal(
    isTrackingIssue({ title: '[GROUPED] Common: flaky webhook tests' }),
    true,
  );
});

test('title prefix must be at the start, not mid-title', () => {
  assert.equal(
    isTrackingIssue({ title: 'Fix parser of [todo-backlog] titles' }),
    false,
  );
});

// ---------------------------------------------------------------------------
// isTrackingIssue — labels
// ---------------------------------------------------------------------------
test('detects tracking issue by backlog label (objects)', () => {
  assert.equal(
    isTrackingIssue({
      title: 'Anything',
      labels: [{ name: 'triaged' }, { name: 'backlog' }],
    }),
    true,
  );
});

test('detects tracking issue by keep-open label (CSV string)', () => {
  assert.equal(
    isTrackingIssue({ title: 'Anything', labels: 'triaged, keep-open' }),
    true,
  );
});

test('plain bug issue with terminal labels is not tracking', () => {
  assert.equal(
    isTrackingIssue({
      title: 'API returns 500 on login',
      labels: ['triaged', 'canceled', 'medium'],
      body: 'Stack trace attached.',
    }),
    false,
  );
});

// ---------------------------------------------------------------------------
// isTrackingIssue — body markers
// ---------------------------------------------------------------------------
test('detects umbrella by body marker', () => {
  assert.equal(
    isTrackingIssue({
      title: 'Workflow improvements',
      body: 'Umbrella tracking issue for the items in docs/TODOs-2.md.',
    }),
    true,
  );
});

test('detects rolling issue by body marker', () => {
  assert.equal(
    isTrackingIssue({
      title: 'CI tracker',
      body: 'This is a **rolling issue** that collects failure reports.',
    }),
    true,
  );
});

test('empty issue is not tracking', () => {
  assert.equal(isTrackingIssue({}), false);
});

// ---------------------------------------------------------------------------
// normalizeLabels
// ---------------------------------------------------------------------------
test('normalizeLabels handles arrays, objects, strings, and blanks', () => {
  assert.deepEqual(normalizeLabels(['A', { name: 'B' }, '']), ['a', 'b']);
  assert.deepEqual(normalizeLabels('x,\n y ,'), ['x', 'y']);
  assert.deepEqual(normalizeLabels(undefined), []);
});

// ---------------------------------------------------------------------------
// detectFromEnv — the fix-issue.yml step contract
// ---------------------------------------------------------------------------
test('detectFromEnv reads title/body/labels from env', () => {
  assert.equal(
    detectFromEnv({
      ISSUE_TITLE: '[todo-backlog] maintenance backlog (MNT)',
      ISSUE_BODY: '',
      ISSUE_LABELS: 'triaged,canceled',
    }),
    true,
  );
  assert.equal(
    detectFromEnv({
      ISSUE_TITLE: 'Login broken',
      ISSUE_BODY: 'steps to reproduce',
      ISSUE_LABELS: 'triaged,high',
    }),
    false,
  );
});
