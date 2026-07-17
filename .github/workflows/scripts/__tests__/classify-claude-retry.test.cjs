/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyClaudeRetry,
  isPrepareGitAuthText,
} = require('../classify-claude-retry.cjs');

const GIT_AUTH_LOG = [
  'Creating local branch claude/issue-771-20260715-1842 for issue #771 from source branch: main...',
  "fatal: could not read Username for 'https://github.com': No such device or address",
  'Error in branch setup: ...',
  'error: Command failed: git fetch origin main --depth=1',
].join('\n');

// ---------------------------------------------------------------------------
// isPrepareGitAuthText
// ---------------------------------------------------------------------------
test('isPrepareGitAuthText matches the branch-setup credential signature', () => {
  assert.ok(isPrepareGitAuthText(GIT_AUTH_LOG));
  assert.ok(
    isPrepareGitAuthText(
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    ),
  );
  assert.ok(!isPrepareGitAuthText('ordinary log line\ngit fetch ok'));
  assert.ok(!isPrepareGitAuthText(''));
});

// ---------------------------------------------------------------------------
// classifyClaudeRetry — fatal_config_git_auth
// ---------------------------------------------------------------------------
test('git-auth prepare failure is fatal: no retry, actionable reason', () => {
  const result = classifyClaudeRetry({
    httpCode: '200',
    executionText: '',
    logText: GIT_AUTH_LOG,
    attempt: '1',
  });
  assert.equal(result.shouldRetry, false);
  assert.equal(result.retryReason, 'fatal_config_git_auth');
  assert.equal(result.isRateLimited, false);
  assert.match(result.message, /branch setup/);
  // Both remediation hints must be present, not either one.
  assert.match(result.message, /track-progress/);
  assert.match(result.message, /credentials/);
});

test('git-auth signature does not override a real execution result', () => {
  // A run that produced a result node failed for its own reasons; stale
  // prepare noise in the log must not reclassify it as fatal config.
  const executionWithResult = JSON.stringify({
    type: 'result',
    is_error: true,
    num_turns: 12,
  });
  const result = classifyClaudeRetry({
    httpCode: '500',
    executionText: executionWithResult,
    logText: GIT_AUTH_LOG,
    attempt: '1',
  });
  // With a result node present and an unhealthy probe, the classifier must
  // fall through to the terminal non-retryable rule — pin the exact outcome.
  assert.equal(result.retryReason, 'non_retryable');
  assert.equal(result.shouldRetry, false);
});

test('rate limit evidence still wins over the git-auth rule', () => {
  const result = classifyClaudeRetry({
    httpCode: '429',
    executionText: '',
    logText: GIT_AUTH_LOG,
    attempt: '1',
  });
  assert.equal(result.isRateLimited, true);
  assert.equal(result.shouldRetry, true);
});

test('empty output with healthy probe and no git-auth signature still retries', () => {
  const result = classifyClaudeRetry({
    httpCode: '200',
    executionText: '',
    logText: 'nothing suspicious here',
    attempt: '1',
  });
  assert.equal(result.shouldRetry, true);
  assert.equal(result.retryReason, 'abortive_no_output');
});
