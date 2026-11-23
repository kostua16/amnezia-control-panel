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

test('unreachable API probe preserves fatal Git auth precedence', () => {
  for (const httpCode of ['000', '']) {
    const unavailable = classifyClaudeRetry({ httpCode, attempt: '1' });
    assert.equal(unavailable.shouldRetry, true);
    assert.equal(unavailable.retryReason, 'probe_unreachable');

    const fatal = classifyClaudeRetry({
      httpCode,
      attempt: '1',
      logText:
        "Error in branch setup: fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    });
    assert.equal(fatal.shouldRetry, false);
    assert.equal(fatal.retryReason, 'fatal_config_git_auth');
  }
});

test('retry CLI preserves an explicitly empty HTTP code from either probe step', () => {
  const { execFileSync } = require('node:child_process');
  const { load } = require('js-yaml');
  const fs = require('node:fs');
  const path = require('node:path');
  const output = execFileSync(
    process.execPath,
    [
      require.resolve('../classify-claude-retry.cjs'),
      '--http-code',
      '',
      '--probe-exit-code',
      '28',
      '--attempt',
      '1',
    ],
    { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' } },
  );
  assert.match(output, /retry_reason=probe_unreachable/);

  const action = load(
    fs.readFileSync(
      path.join(__dirname, '../../../actions/run-claude-params/action.yml'),
      'utf8',
    ),
  );
  for (const id of ['check-429-1', 'check-429-2']) {
    const index = action.runs.steps.findIndex(
      (candidate) => candidate.id === id,
    );
    const step = action.runs.steps[index];
    const backoff = action.runs.steps[index + 1];
    assert.ok(
      backoff.if.includes(
        'steps.' + id + ".outputs.retry_reason == 'transient_transport'",
      ),
    );
    assert.equal(backoff.run, 'sleep 120');
    assert.ok(step.run.includes('--max-time 30) || probe_exit=$?'));
    assert.ok(step.run.includes('--probe-exit-code "$probe_exit"'));
  }
});

test('permanent probe failures fail fast and successful results are not replayed', () => {
  for (const probeExitCode of ['3', '6', '7', '35', '60', '127']) {
    assert.equal(
      classifyClaudeRetry({ httpCode: '000', probeExitCode }).shouldRetry,
      false,
    );
  }
  const success = classifyClaudeRetry({
    httpCode: '000',
    probeExitCode: '28',
    executionText: JSON.stringify({ type: 'result', is_error: false }),
  });
  assert.equal(success.shouldRetry, false);
  assert.equal(success.softSuccess, true);
});

test('an execution socket close retries even if the subsequent probe is healthy', () => {
  const result = classifyClaudeRetry({
    httpCode: '200',
    executionText: JSON.stringify({
      type: 'result',
      is_error: true,
      result: 'The socket connection was closed unexpectedly',
    }),
  });
  assert.equal(result.shouldRetry, true);
  assert.equal(result.retryReason, 'transient_transport');
});

test('HTTP/2 framing, partial responses, and stream failures retry', () => {
  for (const probeExitCode of ['16', '18', '92']) {
    for (const httpCode of ['000', '200']) {
      const result = classifyClaudeRetry({ httpCode, probeExitCode });
      assert.equal(
        result.retryReason,
        httpCode === '000' ? 'probe_unreachable' : 'transient_transport',
      );
      const deterministic = classifyClaudeRetry({
        httpCode,
        probeExitCode,
        executionText: JSON.stringify({
          type: 'result',
          subtype: 'error_max_turns',
        }),
      });
      assert.equal(deterministic.shouldRetry, false);
      assert.equal(deterministic.softSuccess, false);
    }
  }
});

test('quoted socket-close text in the transcript does not trigger transport retry', () => {
  const result = classifyClaudeRetry({
    httpCode: '200',
    executionText: JSON.stringify([
      {
        type: 'assistant',
        message: 'The socket connection was closed unexpectedly',
      },
      { type: 'result', is_error: true, result: 'Turn limit reached' },
    ]),
  });
  assert.equal(result.shouldRetry, false);
  assert.equal(result.retryReason, 'non_retryable');
});

test('socket-close matching recognizes alternate SDK error-result fields', () => {
  const message = 'The socket connection was closed unexpectedly';
  for (const fields of [
    { error: message },
    { result: 'Agent failed', message },
    { errors: [message] },
  ]) {
    assert.equal(
      classifyClaudeRetry({
        httpCode: '200',
        executionText: JSON.stringify({
          type: 'result',
          subtype: 'error_during_execution',
          ...fields,
        }),
      }).retryReason,
      'transient_transport',
    );
  }
});
