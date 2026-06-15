/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMMENT_MARKER,
  REVIEW_CHECKLIST,
  parseStructuredOutput,
  verdictIcon,
  renderStarted,
  renderComplete,
  renderFailureBody,
  findExistingComment,
} = require('../upsert-code-review-comment.cjs');

test('renderStarted prefixes the sticky marker, head SHA and unchecked checklist', () => {
  const body = renderStarted({
    headSha: 'e699b0871d0379b5c32afbe977f4f70aef57a39d',
    runUrl: 'https://example/run/1',
    startedAt: '2026-06-14T18:06:48.000Z',
  });

  assert.match(body, new RegExp(`^${COMMENT_MARKER}`));
  assert.match(body, /Code review in progress/);
  assert.match(body, /`e699b0871d03`/);
  assert.match(body, /https:\/\/example\/run\/1/);
  assert.match(body, /Started: 2026-06-14T18:06:48\.000Z/);
  // Every checklist item renders as unchecked.
  for (const item of REVIEW_CHECKLIST) {
    // Escape regex metacharacters (e.g. parentheses in "Security review (STRIDE)").
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(body, new RegExp(`- \\[ \\] ${escaped}`));
  }
});

test('renderComplete marks concerns overall and surfaces both verdicts with counts', () => {
  const body = renderComplete({
    structured: {
      code_review: {
        verdict: 'concerns',
        summary: 'install-uv is missing in two flows.',
        blocking_findings_count: 1,
      },
      security_review: {
        verdict: 'passed',
        summary: 'Serena read-only enforcement is correct.',
        highest_severity: 'low',
      },
      reviewed_files: ['.github/workflows/audit-fix.yml', 'src/x.ts'],
    },
    numTurns: '42',
    headSha: 'e699b0871d0379b5c32afbe977f4f70aef57a39d',
    runUrl: 'https://example/run/1',
    failed: 'false',
  });

  assert.match(body, new RegExp(`^${COMMENT_MARKER}`));
  assert.match(body, /⚠️ Code review complete — with concerns/);
  assert.match(body, /Code review — ⚠️ concerns/);
  assert.match(body, /install-uv is missing in two flows\./);
  assert.match(body, /Blocking findings: \*\*1\*\*/);
  assert.match(body, /Security review — ✅ passed/);
  assert.match(body, /Highest severity: \*\*low\*\*/);
  assert.match(body, /Reviewed files \(2\)/);
  assert.match(body, /- \.github\/workflows\/audit-fix\.yml/);
  assert.match(body, /Turns: 42/);
});

test('renderComplete shows a pass when both verdicts are passed', () => {
  const body = renderComplete({
    structured: {
      code_review: {
        verdict: 'passed',
        summary: 'Clean.',
        blocking_findings_count: 0,
      },
      security_review: {
        verdict: 'passed',
        summary: 'No issues.',
        highest_severity: 'none',
      },
      reviewed_files: ['a.ts'],
    },
    headSha: 'abc',
    runUrl: 'u',
    failed: 'false',
  });

  assert.match(body, /✅ Code review complete — passed/);
});

test('renderComplete renders a failure body when failed, without throwing', () => {
  const body = renderComplete({
    structured: {},
    headSha: 'abc',
    runUrl: 'u',
    failed: 'true',
    failReason: 'claude-code-action step failed',
  });

  assert.match(body, /❌ Code review failed to complete/);
  assert.match(body, /claude-code-action step failed/);
  assert.doesNotMatch(body, /Blocking findings/);
});

test('renderFailureBody falls back to a default reason when none is given', () => {
  const body = renderFailureBody({
    headSha: 'abc',
    runUrl: 'u',
    failReason: null,
    updatedAt: '2026-06-14T18:12:00Z',
  });

  assert.match(body, /did not complete successfully/);
});

test('parseStructuredOutput tolerates empty and invalid JSON', () => {
  assert.deepEqual(parseStructuredOutput(''), {});
  assert.deepEqual(parseStructuredOutput(undefined), {});
  assert.deepEqual(parseStructuredOutput('not json'), {});
  assert.deepEqual(parseStructuredOutput('{"code_review":{}}'), {
    code_review: {},
  });
});

test('verdictIcon maps verdicts to the expected emoji', () => {
  assert.equal(verdictIcon('concerns'), '⚠️');
  assert.equal(verdictIcon('passed'), '✅');
  assert.equal(verdictIcon(undefined), 'ℹ️');
});

test('findExistingComment returns the workflow-owned summary comment only', () => {
  const existing = findExistingComment([
    {
      id: 1,
      user: { login: 'github-actions[bot]' },
      body: `${COMMENT_MARKER}\nold`,
    },
    { id: 2, user: { login: 'kostua16' }, body: `${COMMENT_MARKER}\nmanual` },
    { id: 3, user: { login: 'github-actions[bot]' }, body: 'unrelated text' },
  ]);

  assert.equal(existing?.id, 1);
});

test('findExistingComment ignores duplicate text without the marker', () => {
  const existing = findExistingComment([
    {
      id: 1,
      user: { login: 'github-actions[bot]' },
      body: 'Code review complete',
    },
  ]);

  assert.equal(existing, null);
});
