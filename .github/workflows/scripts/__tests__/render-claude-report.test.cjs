/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderClaudeExecutionSection } = require('../render-claude-report.cjs');

test('cancelled execution with no recovered metrics renders marker only', () => {
  const body = renderClaudeExecutionSection({ outcome: 'cancelled' });

  assert.match(body, /### Claude Execution/);
  assert.match(body, /Cancelled before metrics were captured/);
  assert.doesNotMatch(body, /\| Metric \| Value \|/);
});

test('cancelled execution with recovered changed files renders table and details', () => {
  const body = renderClaudeExecutionSection({
    outcome: 'cancelled',
    changedFilesList: ['.github/workflows/audit-fix.yml'],
  });

  assert.match(
    body,
    /Cancelled before completion; metrics below were recovered from logs/,
  );
  assert.match(body, /\| Metric \| Value \|/);
  assert.match(body, /<details><summary>Changed files<\/summary>/);
  assert.match(body, /\.github\/workflows\/audit-fix\.yml/);
});

test('cancelled execution with recovered rejected tools renders table and details', () => {
  const body = renderClaudeExecutionSection({
    outcome: 'cancelled',
    rejectedToolsList: ['Bash(rm:*)'],
  });

  assert.match(
    body,
    /Cancelled before completion; metrics below were recovered from logs/,
  );
  assert.match(body, /\| Metric \| Value \|/);
  assert.match(body, /<details><summary>Rejected tools<\/summary>/);
  assert.match(body, /Bash\(rm:\*\)/);
});

test('non-cancelled execution renders the metrics table without cancelled notice', () => {
  const body = renderClaudeExecutionSection({
    outcome: 'failure',
    numTurns: 3,
  });

  assert.match(body, /\| Metric \| Value \|/);
  assert.doesNotMatch(body, /Cancelled before/);
});
