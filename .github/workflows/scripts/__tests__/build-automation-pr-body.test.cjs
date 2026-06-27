/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REQUIRED_HEADINGS,
  buildAutomationPrBody,
  cleanText,
  extractFinalResultFromExecutionText,
  parseChangedFiles,
  redactSecrets,
  truncateText,
  validateRichBody,
} = require('../build-automation-pr-body.cjs');

// ---------------------------------------------------------------------------
// redactSecrets
// ---------------------------------------------------------------------------
test('redactSecrets removes Bearer tokens', () => {
  const input = 'Authorization: Bearer ghp_abc123DEFghijklmnopqrs';
  const result = redactSecrets(input);
  assert.ok(result.includes('[REDACTED]'));
  assert.ok(!result.includes('ghp_abc123DEF'));
});

test('redactSecrets removes Basic auth', () => {
  const result = redactSecrets('Basic dXNlcjpwYXNz');
  assert.ok(result.includes('[REDACTED]'));
  assert.ok(!result.includes('dXNlcjpwYXNz'));
});

test('redactSecrets removes github_pat_ tokens', () => {
  const result = redactSecrets('token github_pat_abc123DEFghijklmnopqrst');
  assert.ok(result.includes('[REDACTED_GITHUB_PAT]'));
});

test('redactSecrets removes gh[pousr]_ tokens', () => {
  const result = redactSecrets('key ghp_abc123defghijklmnopqrst');
  assert.ok(result.includes('[REDACTED_GITHUB_TOKEN]'));
});

test('redactSecrets removes sk- API keys', () => {
  const result = redactSecrets('sk-abcdefghijklmnopqrst');
  assert.ok(result.includes('[REDACTED_API_KEY]'));
});

test('redactSecrets removes key=value secrets', () => {
  const result = redactSecrets('api_key=supersecretvalue123');
  assert.ok(result.includes('api_key=[REDACTED]'));
  assert.ok(!result.includes('supersecretvalue123'));
});

test('redactSecrets handles empty string', () => {
  assert.equal(redactSecrets(''), '');
});

// ---------------------------------------------------------------------------
// cleanText
// ---------------------------------------------------------------------------
test('cleanText strips ANSI codes', () => {
  const result = cleanText('\x1b[31mError\x1b[0m message');
  assert.equal(result, 'Error message');
});

test('cleanText strips carriage returns and trims', () => {
  const result = cleanText('  hello\r\nworld  ');
  assert.equal(result, 'hello\nworld');
});

// ---------------------------------------------------------------------------
// truncateText
// ---------------------------------------------------------------------------
test('truncateText passes short text through', () => {
  const short = 'Short text';
  assert.equal(truncateText(short, 100), short);
});

test('truncateText truncates and appends marker', () => {
  const long = 'A'.repeat(2500);
  const result = truncateText(long, 2200);
  assert.ok(result.length < 2500);
  assert.ok(result.includes('[truncated for PR body]'));
});

test('truncateText uses default limit', () => {
  const long = 'B'.repeat(3000);
  const result = truncateText(long);
  assert.ok(result.length < 3000);
  assert.ok(result.includes('[truncated for PR body]'));
});

// ---------------------------------------------------------------------------
// parseChangedFiles
// ---------------------------------------------------------------------------
test('parseChangedFiles parses JSON array', () => {
  const result = parseChangedFiles(JSON.stringify(['src/a.ts', 'src/b.ts']));
  assert.deepEqual(result, ['src/a.ts', 'src/b.ts']);
});

test('parseChangedFiles parses JSON object with changedFiles', () => {
  const result = parseChangedFiles(
    JSON.stringify({ changedFiles: ['x.ts', 'y.ts'] }),
  );
  assert.deepEqual(result, ['x.ts', 'y.ts']);
});

test('parseChangedFiles parses JSON object with files', () => {
  const result = parseChangedFiles(JSON.stringify({ files: ['p.ts', 'q.ts'] }));
  assert.deepEqual(result, ['p.ts', 'q.ts']);
});

test('parseChangedFiles parses newline-separated list', () => {
  const result = parseChangedFiles('foo.ts\nbar.ts\nbaz.ts');
  assert.deepEqual(result, ['bar.ts', 'baz.ts', 'foo.ts']);
});

test('parseChangedFiles parses CSV', () => {
  const result = parseChangedFiles('a.ts,b.ts,c.ts');
  assert.deepEqual(result, ['a.ts', 'b.ts', 'c.ts']);
});

test('parseChangedFiles handles objects with path property', () => {
  const result = parseChangedFiles(
    JSON.stringify([{ path: 'x.ts' }, { path: 'y.ts' }]),
  );
  assert.deepEqual(result, ['x.ts', 'y.ts']);
});

test('parseChangedFiles deduplicates and sorts', () => {
  const result = parseChangedFiles('z.ts\na.ts\nz.ts');
  assert.deepEqual(result, ['a.ts', 'z.ts']);
});

test('parseChangedFiles handles empty string', () => {
  assert.deepEqual(parseChangedFiles(''), []);
});

test('parseChangedFiles strips markdown bullets and backticks', () => {
  const result = parseChangedFiles('- `src/app.ts`\n- src/lib.ts');
  assert.deepEqual(result, ['src/app.ts', 'src/lib.ts']);
});

// ---------------------------------------------------------------------------
// validateRichBody
// ---------------------------------------------------------------------------
test('validateRichBody passes for valid body', () => {
  const body = [
    '## Problem / Trigger',
    'Something happened',
    '## Why Automation Changed This',
    'Because...',
    '## What Changed',
    'Files changed',
    '## Evidence',
    'Logs here',
    '## Review Notes',
    'Review carefully',
    '---',
    '*Auto-generated by the CI workflow.*',
  ].join('\n');
  assert.doesNotThrow(() => validateRichBody(body));
});

test('validateRichBody throws on missing section', () => {
  const body = '## Problem / Trigger\nNo other sections\n';
  assert.throws(() => validateRichBody(body), {
    message: /missing required section/,
  });
});

test('validateRichBody throws on missing automation footer', () => {
  const body = [
    '## Problem / Trigger',
    'x',
    '## Why Automation Changed This',
    'x',
    '## What Changed',
    'x',
    '## Evidence',
    'x',
    '## Review Notes',
    'x',
  ].join('\n');
  assert.throws(() => validateRichBody(body), {
    message: /missing automation footer/,
  });
});

test('validateRichBody passes empty body check (no throw for empty — just missing headings)', () => {
  assert.throws(() => validateRichBody(''));
});

// ---------------------------------------------------------------------------
// buildAutomationPrBody — full body generation
// ---------------------------------------------------------------------------
test('buildAutomationPrBody includes all required headings', () => {
  const body = buildAutomationPrBody({
    workflowName: 'test-workflow',
    problem: 'Build broke',
    rationale: 'Fix lint errors',
    changes: 'Updated config',
  });
  for (const heading of REQUIRED_HEADINGS) {
    assert.ok(body.includes(heading), `Missing heading: ${heading}`);
  }
});

test('buildAutomationPrBody includes automation footer', () => {
  const body = buildAutomationPrBody({
    workflowName: 'ci-test',
    problem: 'test',
  });
  assert.ok(/Auto-generated by/i.test(body));
  assert.ok(body.includes('ci-test'));
});

test('buildAutomationPrBody uses trigger when problem is empty', () => {
  const body = buildAutomationPrBody({
    workflowName: 'w',
    trigger: 'Scheduled run',
  });
  assert.ok(body.includes('Scheduled run'));
});

test('buildAutomationPrBody uses fallback when no problem or trigger', () => {
  const body = buildAutomationPrBody({
    workflowName: 'w',
  });
  assert.ok(body.includes('repository workflow event'));
});

test('buildAutomationPrBody uses rationale over fallback', () => {
  const body = buildAutomationPrBody({
    workflowName: 'w',
    problem: 'p',
    rationale: 'Custom reason',
  });
  assert.ok(body.includes('Custom reason'));
  assert.ok(!body.includes('no model rationale was captured'));
});

test('buildAutomationPrBody renders changed files list', () => {
  const body = buildAutomationPrBody({
    workflowName: 'w',
    problem: 'p',
    changedFiles: JSON.stringify(['a.ts', 'b.ts']),
  });
  assert.ok(body.includes('`a.ts`'));
  assert.ok(body.includes('`b.ts`'));
});

test('buildAutomationPrBody renders source links', () => {
  const body = buildAutomationPrBody({
    workflowName: 'w',
    problem: 'p',
    sourceRunUrl: 'https://github.com/owner/repo/actions/runs/42',
    sourcePrUrl: 'https://github.com/owner/repo/pull/10',
    sourceIssueUrl: 'https://github.com/owner/repo/issues/5',
  });
  assert.ok(body.includes('Source run:'));
  assert.ok(body.includes('Source PR:'));
  assert.ok(body.includes('Source issue:'));
});

test('buildAutomationPrBody renders Closes #N lines', () => {
  const body = buildAutomationPrBody({
    workflowName: 'w',
    problem: 'p',
    closingIssues: '123, 456',
  });
  assert.ok(body.includes('Closes #123'));
  assert.ok(body.includes('Closes #456'));
});

test('buildAutomationPrBody handles closing issues from newline-separated', () => {
  const body = buildAutomationPrBody({
    workflowName: 'w',
    problem: 'p',
    closingIssues: '#789\n#999',
  });
  assert.ok(body.includes('Closes #789'));
  assert.ok(body.includes('Closes #999'));
});

test('buildAutomationPrBody caps changed files display', () => {
  const files = Array.from({ length: 40 }, (_, i) => `file${i}.ts`);
  const body = buildAutomationPrBody({
    workflowName: 'w',
    problem: 'p',
    changedFiles: JSON.stringify(files),
  });
  assert.ok(body.includes('10 more file(s)'));
});

test('buildAutomationPrBody uses custom footer', () => {
  const body = buildAutomationPrBody({
    workflowName: 'w',
    problem: 'p',
    footer: 'Custom footer text',
  });
  assert.ok(body.includes('Custom footer text'));
});

test('buildAutomationPrBody includes failed jobs in evidence', () => {
  const body = buildAutomationPrBody({
    workflowName: 'w',
    problem: 'p',
    failedJobs: 'build (3), lint (1)',
  });
  assert.ok(body.includes('Failed jobs:'));
  assert.ok(body.includes('build (3)'));
});

test('buildAutomationPrBody includes error logs in evidence', () => {
  const body = buildAutomationPrBody({
    workflowName: 'w',
    problem: 'p',
    errorLogs: 'TypeError: cannot read property of null',
  });
  assert.ok(body.includes('Error log excerpts:'));
  assert.ok(body.includes('TypeError'));
});

test('buildAutomationPrBody default evidence when none provided', () => {
  const body = buildAutomationPrBody({
    workflowName: 'w',
    problem: 'p',
  });
  assert.ok(body.includes('No additional evidence'));
});

test('buildAutomationPrBody default review notes', () => {
  const body = buildAutomationPrBody({
    workflowName: 'w',
    problem: 'p',
  });
  assert.ok(body.includes('Manual review is required'));
});

test('buildAutomationPrBody redacts secrets from rationale', () => {
  const body = buildAutomationPrBody({
    workflowName: 'w',
    problem: 'p',
    rationale: 'Key=sk-abcdefghijklmnopqrst was used',
  });
  assert.ok(!body.includes('sk-abcdefghijklmnopqrst'));
  assert.ok(body.includes('[REDACTED'));
});

// ---------------------------------------------------------------------------
// extractFinalResultFromExecutionText
// ---------------------------------------------------------------------------
test('extractFinalResultFromExecutionText extracts from result type', () => {
  const events = JSON.stringify([
    { type: 'result', result: 'Fix applied successfully' },
  ]);
  const result = extractFinalResultFromExecutionText(events);
  assert.equal(result, 'Fix applied successfully');
});

test('extractFinalResultFromExecutionText extracts from assistant content', () => {
  const events = JSON.stringify([
    { role: 'assistant', content: 'Analysis complete' },
  ]);
  const result = extractFinalResultFromExecutionText(events);
  assert.equal(result, 'Analysis complete');
});

test('extractFinalResultFromExecutionText prefers result over assistant', () => {
  const events = JSON.stringify([
    { role: 'assistant', content: 'Earlier text' },
    { type: 'result', result: 'Final result' },
  ]);
  const result = extractFinalResultFromExecutionText(events);
  assert.equal(result, 'Final result');
});

test('extractFinalResultFromExecutionText returns empty for no events', () => {
  assert.equal(extractFinalResultFromExecutionText(''), '');
});

test('extractFinalResultFromExecutionText handles nested objects', () => {
  const events = JSON.stringify([
    { nested: { type: 'result', result: 'deep fix' } },
  ]);
  const result = extractFinalResultFromExecutionText(events);
  assert.equal(result, 'deep fix');
});

// ---------------------------------------------------------------------------
// REQUIRED_HEADINGS constant
// ---------------------------------------------------------------------------
test('REQUIRED_HEADINGS contains expected sections', () => {
  assert.ok(REQUIRED_HEADINGS.includes('## Problem / Trigger'));
  assert.ok(REQUIRED_HEADINGS.includes('## Why Automation Changed This'));
  assert.ok(REQUIRED_HEADINGS.includes('## What Changed'));
  assert.ok(REQUIRED_HEADINGS.includes('## Evidence'));
  assert.ok(REQUIRED_HEADINGS.includes('## Review Notes'));
});
