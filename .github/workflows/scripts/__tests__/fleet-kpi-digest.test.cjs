/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  classifyPr,
  windowBounds,
  renderDigestBody,
  FLEET_ACTORS,
  DIGEST_TITLE_PREFIX,
  DIGEST_LABELS,
  ISSUE_SEARCH_MARKER,
  formatDate,
} = require('../fleet-kpi-digest.cjs');

test('FLEET_ACTORS includes claude[bot] and dependabot[bot]', () => {
  assert.ok(FLEET_ACTORS.includes('claude[bot]'));
  assert.ok(FLEET_ACTORS.includes('dependabot[bot]'));
});

test('DIGEST_TITLE_PREFIX is a non-empty string', () => {
  assert.equal(typeof DIGEST_TITLE_PREFIX, 'string');
  assert.ok(DIGEST_TITLE_PREFIX.length > 0);
});

test('DIGEST_LABELS includes auto-fix', () => {
  assert.ok(DIGEST_LABELS.includes('auto-fix'));
});

test('ISSUE_SEARCH_MARKER uses the title prefix', () => {
  assert.ok(ISSUE_SEARCH_MARKER.includes(DIGEST_TITLE_PREFIX));
});

test('parseArgs extracts --repo, --window-hours, --github-output', () => {
  const args = parseArgs([
    'node',
    'script',
    '--repo',
    'owner/repo',
    '--window-hours',
    '24',
    '--github-output',
    '/tmp/out',
  ]);
  assert.equal(args.repo, 'owner/repo');
  assert.equal(args['window-hours'], '24');
  assert.equal(args['github-output'], '/tmp/out');
});

test('parseArgs sets dry-run flag', () => {
  const args = parseArgs(['node', 'script', '--dry-run']);
  assert.equal(args['dry-run'], true);
});

test('parseArgs defaults window-hours to undefined when not provided', () => {
  const args = parseArgs(['node', 'script']);
  assert.equal(args['window-hours'], undefined);
});

test('classifyPr returns merged for closed+merged PR', () => {
  assert.equal(
    classifyPr({ state: 'closed', merged_at: '2026-01-01T00:00:00Z' }),
    'merged',
  );
});

test('classifyPr returns closed for closed PR without merged_at', () => {
  assert.equal(classifyPr({ state: 'closed', merged_at: null }), 'closed');
  assert.equal(classifyPr({ state: 'closed' }), 'closed');
});

test('classifyPr returns opened for open PR', () => {
  assert.equal(classifyPr({ state: 'open' }), 'opened');
});

test('windowBounds returns since before until', () => {
  const { since, until } = windowBounds(12);
  assert.ok(since < until, 'since must be before until');
});

test('windowBounds returns ISO strings', () => {
  const { since, until } = windowBounds(1);
  assert.match(since, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.match(until, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

test('formatDate produces YYYY-MM-DD HH:00 UTC', () => {
  const date = new Date('2026-08-07T14:30:00Z');
  const formatted = formatDate(date);
  assert.equal(formatted, '2026-08-07 14:00 UTC');
});

test('renderDigestBody includes title and window label', () => {
  const body = renderDigestBody(
    { prs: [], issues: [], gateSkips: [] },
    '2026-08-07 00:00 UTC – 2026-08-07 12:00 UTC',
  );
  assert.ok(body.includes(DIGEST_TITLE_PREFIX));
  assert.ok(body.includes('2026-08-07 00:00 UTC'));
  assert.ok(body.includes('2026-08-07 12:00 UTC'));
});

test('renderDigestBody shows zero counts when empty', () => {
  const body = renderDigestBody(
    { prs: [], issues: [], gateSkips: [] },
    'window',
  );
  assert.ok(body.includes('| Opened | 0 |'));
  assert.ok(body.includes('| Merged | 0 |'));
  assert.ok(body.includes('| Closed (not merged) | 0 |'));
  assert.ok(body.includes('| Opened | 0 |'));
  assert.ok(body.includes('| Closed | 0 |'));
  assert.ok(body.includes('_No gate skips in this window._'));
});

test('renderDigestBody counts PRs by category', () => {
  const body = renderDigestBody(
    {
      prs: [
        { number: 1, title: 'Open PR', state: 'open', user: 'claude[bot]' },
        {
          number: 2,
          title: 'Merged PR',
          state: 'closed',
          merged_at: '2026-01-01',
          user: 'claude[bot]',
        },
        { number: 3, title: 'Closed PR', state: 'closed', user: 'dependabot[bot]' },
      ],
      issues: [],
      gateSkips: [],
    },
    'window',
  );
  assert.ok(body.includes('| Opened | 1 |'));
  assert.ok(body.includes('| Merged | 1 |'));
  assert.ok(body.includes('| Closed (not merged) | 1 |'));
  assert.ok(body.includes('#1'));
  assert.ok(body.includes('#2'));
  assert.ok(body.includes('#3'));
});

test('renderDigestBody counts issues by event', () => {
  const body = renderDigestBody(
    {
      prs: [],
      issues: [
        { number: 10, title: 'New bug', event: 'opened' },
        { number: 11, title: 'Fixed bug', event: 'closed' },
        { number: 12, title: 'Another new', event: 'opened' },
      ],
      gateSkips: [],
    },
    'window',
  );
  assert.ok(body.includes('| Opened | 2 |'));
  assert.ok(body.includes('| Closed | 1 |'));
});

test('renderDigestBody lists gate skips with run ID and workflow name', () => {
  const body = renderDigestBody(
    {
      prs: [],
      issues: [],
      gateSkips: [
        { id: 12345, name: 'maintenance', updated_at: '2026-08-07T06:00:00Z' },
        { id: 12346, name: 'audit-fix', created_at: '2026-08-07T07:00:00Z' },
      ],
    },
    'window',
  );
  assert.ok(body.includes('12345'));
  assert.ok(body.includes('maintenance'));
  assert.ok(body.includes('12346'));
  assert.ok(body.includes('audit-fix'));
  assert.ok(body.includes('**2 workflow run(s) skipped'));
});

test('renderDigestBody escapes pipes in PR titles', () => {
  const body = renderDigestBody(
    {
      prs: [
        {
          number: 99,
          title: 'fix | pipe | chars',
          state: 'open',
          user: 'claude[bot]',
        },
      ],
      issues: [],
      gateSkips: [],
    },
    'window',
  );
  // Escaped pipe must appear, raw pipe must not break table structure.
  assert.ok(body.includes('fix \\| pipe \\| chars'));
});

test('renderDigestBody escapes pipes in issue titles', () => {
  const body = renderDigestBody(
    {
      prs: [],
      issues: [{ number: 5, title: 'A | B', event: 'opened' }],
      gateSkips: [],
    },
    'window',
  );
  assert.ok(body.includes('A \\| B'));
});

test('renderDigestBody escapes pipes in gate skip workflow names', () => {
  const body = renderDigestBody(
    {
      prs: [],
      issues: [],
      gateSkips: [
        { id: 1, name: 'workflow | name', updated_at: '2026-08-07T06:00:00Z' },
      ],
    },
    'window',
  );
  assert.ok(body.includes('workflow \\| name'));
});

test('renderDigestBody does not leak PR table when no PRs', () => {
  const body = renderDigestBody(
    { prs: [], issues: [], gateSkips: [] },
    'window',
  );
  assert.ok(!body.includes('| # | Title | Author | Status |'));
});

test('renderDigestBody does not leak issue table when no issues', () => {
  const body = renderDigestBody(
    { prs: [], issues: [], gateSkips: [] },
    'window',
  );
  assert.ok(!body.includes('| # | Title | Event |'));
});

test('renderDigestBody does not leak gate skip table when no skips', () => {
  const body = renderDigestBody(
    { prs: [], issues: [], gateSkips: [] },
    'window',
  );
  assert.ok(!body.includes('| Run ID | Workflow | Time |'));
});
