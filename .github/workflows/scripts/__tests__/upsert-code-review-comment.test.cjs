/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMMENT_MARKER,
  REVIEW_CHECKLIST,
  parseStructuredOutput,
  verdictIcon,
  quoteBlock,
  isCancelledOutcome,
  isSkippedOutcome,
  renderStarted,
  renderCancelled,
  renderSkipped,
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

test('renderComplete never claims "passed" when verdicts are missing (empty output)', () => {
  const body = renderComplete({
    structured: {},
    headSha: 'abc',
    runUrl: 'u',
    failed: 'false',
  });

  assert.match(body, /❌ Code review failed to complete/);
  assert.match(body, /Review did not produce structured verdicts\./);
  assert.doesNotMatch(body, /✅ Code review complete/);
});

test('renderComplete treats a partial result (verdict missing) as incomplete', () => {
  const body = renderComplete({
    structured: { code_review: { summary: 'partial, no verdict' } },
    headSha: 'abc',
    runUrl: 'u',
    failed: 'false',
  });

  assert.match(body, /❌ Code review failed to complete/);
  assert.doesNotMatch(body, /Code review complete —/);
});

test('renderComplete keeps a multi-line summary inside the blockquote', () => {
  const body = renderComplete({
    structured: {
      code_review: {
        verdict: 'concerns',
        summary: 'line one\nline two',
        blocking_findings_count: 1,
      },
      security_review: { verdict: 'passed', highest_severity: 'low' },
      reviewed_files: [],
    },
    headSha: 'abc',
    runUrl: 'u',
    failed: 'false',
  });

  assert.match(body, /> line one/);
  assert.match(body, /> line two/);
  // No summary line should render without the blockquote prefix.
  assert.doesNotMatch(body, /(^|\n)line two/);
});

test('quoteBlock prefixes every line, including blank ones', () => {
  assert.equal(quoteBlock('a\nb'), '> a\n> b');
  assert.equal(quoteBlock('only'), '> only');
  assert.equal(quoteBlock('a\n\nb'), '> a\n> \n> b');
});

test('renderCancelled renders the cancellation body with a clear reason', () => {
  const body = renderCancelled({
    headSha: 'abc123def456',
    runUrl: 'https://example/run/9',
    updatedAt: '2026-06-15T10:04:49.000Z',
  });

  assert.match(body, new RegExp(`^${COMMENT_MARKER}`));
  assert.match(body, /🚫 Code review was cancelled/);
  assert.match(body, /`abc123def456`/);
  assert.match(body, /did not finish/);
  assert.match(body, /job timeout|superseded/);
  assert.match(body, /Re-dispatch with `\/review`/);
  // It must not claim success or a generic model failure.
  assert.doesNotMatch(body, /Code review complete/);
  assert.doesNotMatch(body, /failed to complete/);
});

test('isCancelledOutcome treats only cancelled review action as cancellation', () => {
  assert.equal(isCancelledOutcome('cancelled'), true);
  assert.equal(isCancelledOutcome('skipped'), false);
  assert.equal(isCancelledOutcome('success'), false);
  assert.equal(isCancelledOutcome('failure'), false);
});

test('renderSkipped explains a prerequisite setup failure, not cancellation', () => {
  const body = renderSkipped({
    headSha: 'abc123def456',
    runUrl: 'https://example/run/10',
    updatedAt: '2026-06-15T10:04:49.000Z',
  });

  assert.match(body, new RegExp(`^${COMMENT_MARKER}`));
  assert.match(body, /⚪ Code review was skipped/);
  assert.match(body, /`abc123def456`/);
  assert.match(body, /earlier setup or prerequisite step failed/);
  assert.match(body, /re-dispatch with `\/review`/);
  assert.doesNotMatch(body, /timeout|supersed/);
});

test('isSkippedOutcome treats only skipped review action as skipped', () => {
  assert.equal(isSkippedOutcome('skipped'), true);
  assert.equal(isSkippedOutcome('cancelled'), false);
  assert.equal(isSkippedOutcome('success'), false);
  assert.equal(isSkippedOutcome('failure'), false);
});
