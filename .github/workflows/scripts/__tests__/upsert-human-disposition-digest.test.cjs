/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  escapeCell,
  escapeListItem,
  parseStructuredOutput,
  renderDigestBody,
} = require('../upsert-human-disposition-digest.cjs');

test('escapeCell collapses newlines, escapes pipes, and neutralizes link brackets', () => {
  assert.equal(escapeCell('a|b'), 'a\\|b');
  assert.equal(escapeCell('line1\nline2'), 'line1 line2');
  assert.equal(escapeCell('line1\r\nline2'), 'line1 line2');
  assert.equal(escapeCell('line1\rline2'), 'line1 line2');
  // A markdown-link-shaped value must not survive as a clickable link.
  assert.equal(escapeCell('[click](https://evil.example)'), '\\[click](https://evil.example)');
  assert.equal(escapeCell(null), '');
  assert.equal(escapeCell(undefined), '');
});

test('escapeListItem collapses embedded newlines to spaces', () => {
  assert.equal(escapeListItem('one\ntwo'), 'one two');
  assert.equal(escapeListItem('- nested\nmore'), '- nested more');
  assert.equal(escapeListItem(null), '');
});

test('parseStructuredOutput returns null for empty or invalid JSON', () => {
  assert.equal(parseStructuredOutput(''), null);
  assert.equal(parseStructuredOutput(null), null);
  assert.equal(parseStructuredOutput('not json'), null);
  assert.deepEqual(parseStructuredOutput('{"a":1}'), { a: 1 });
});

test('renderDigestBody emits the empty-state body when there is nothing to publish', () => {
  const body = renderDigestBody(
    { human_disposition: [], auto_prs_inspected: [] },
    'https://example/run',
    'https://github.com/owner/repo',
  );
  assert.match(body, /_No PRs currently require human disposition\._/);
  assert.ok(!body.includes('### Inspected PRs'));
});

test('renderDigestBody escapes external PR metadata in the inspected table', () => {
  const body = renderDigestBody(
    {
      human_disposition: [],
      auto_prs_inspected: [
        {
          number: 42,
          title: 'B | d[a](https://evil.example)\nsecond',
          author: 'alice|bot',
          branch: 'feat|pipe',
          recommendation: 'needs|review',
        },
      ],
    },
    'https://example/run',
    'https://github.com/owner/repo',
  );
  // Pipe characters must be escaped so the row keeps exactly five columns.
  assert.ok(body.includes('B \\| d\\[a](https://evil.example) second'));
  assert.ok(body.includes('alice\\|bot'));
  assert.ok(body.includes('feat\\|pipe'));
  assert.ok(body.includes('needs\\|review'));
  // The PR number link is built from trusted data and stays intact.
  assert.ok(body.includes('[#42](https://github.com/owner/repo/pull/42)'));
  // No raw pipe from the cell values leaks as a column separator: after removing
  // escaped pipes, only the 6 structural separators of a 5-cell row remain.
  const row = body.split('\n').find((l) => l.startsWith('| [#42]'));
  assert.ok(row, 'expected an inspected-PR table row');
  const structuralPipes = (row.replace(/\\\|/g, '').match(/\|/g) || []).length;
  assert.equal(structuralPipes, 6);
});

test('renderDigestBody collapses newlines in human_disposition bullet items', () => {
  const body = renderDigestBody(
    {
      human_disposition: ['PR #1 needs a look\nreview the diff carefully'],
      auto_prs_inspected: [],
    },
    'https://example/run',
    'https://github.com/owner/repo',
  );
  assert.ok(body.includes('- PR #1 needs a look review the diff carefully'));
  // The newline-terminated remainder must not leak as a non-bullet line.
  assert.ok(!/^review the diff carefully$/m.test(body));
});
