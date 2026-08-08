/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  TRANSIENT_PATTERNS,
  isTransientLog,
  classifyRun,
  buildRecoveryLedger,
  rerunTransientFailedRuns,
} = require('../rerun-transient-failed-runs.cjs');

// ── TRANSIENT_PATTERNS ─────────────────────────────────────────────

test('TRANSIENT_PATTERNS covers core network resets', () => {
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('ECONNRESET')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('ETIMEDOUT')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('ECONNREFUSED')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('ENOTFOUND')));
});

test('TRANSIENT_PATTERNS covers HTTP 5xx', () => {
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('HTTP 500')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('HTTP 502')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('HTTP 503')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('HTTP 504')));
});

test('TRANSIENT_PATTERNS covers rate-limit and throttle', () => {
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('rate limit')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('throttle')));
  assert.ok(
    TRANSIENT_PATTERNS.some((re) => re.test('service temporarily overloaded')),
  );
});

test('TRANSIENT_PATTERNS leaves resource exhaustion to dedicated recovery', () => {
  assert.ok(!isTransientLog('Runner cancelled'));
  assert.ok(!isTransientLog('shutdown signal'));
  assert.ok(!isTransientLog('out of memory'));
  assert.ok(!isTransientLog('OOM killed'));
  assert.ok(!isTransientLog('no space left on device'));
  assert.ok(!isTransientLog('ENOSPC'));
});

// ── isTransientLog ───────────────────────────────────────────────

test('isTransientLog returns true for ECONNRESET in logs', () => {
  assert.ok(isTransientLog('Error: read ECONNRESET'));
  assert.ok(isTransientLog('some line\nECONNRESET\nmore lines'));
});

test('isTransientLog returns true for HTTP 5xx in logs', () => {
  assert.ok(isTransientLog('gh: HTTP 504: Gateway Timeout'));
  assert.ok(isTransientLog('HTTP 500 Internal Server Error'));
  assert.ok(isTransientLog('http 502')); // case-insensitive
});

test('isTransientLog returns true for rate-limit in logs', () => {
  assert.ok(isTransientLog('API rate limit exceeded'));
  assert.ok(isTransientLog('secondary rate limit'));
});

test('isTransientLog returns false for permanent errors', () => {
  assert.ok(!isTransientLog('error TS2304: Cannot find name'));
  assert.ok(!isTransientLog('HTTP 404: Not Found'));
  assert.ok(!isTransientLog('HTTP 403: Forbidden')); // 403 alone is not transient
  assert.ok(!isTransientLog('Permission denied'));
  assert.ok(!isTransientLog(''));
});

// ── classifyRun ───────────────────────────────────────────────────

test('classifyRun returns transient for ECONNRESET', () => {
  const result = classifyRun(123, 'owner/repo', (args) => {
    assert.deepEqual(args, [
      'run',
      'view',
      '123',
      '--log-failed',
      '--repo',
      'owner/repo',
    ]);
    return { ok: true, stdout: '##[error] Error: read ECONNRESET' };
  });
  assert.equal(result.transient, true);
  assert.equal(result.reason, 'transient-signature');
});

test('classifyRun returns non-transient for TypeScript errors', () => {
  const result = classifyRun(456, '', () => ({
    ok: true,
    stdout: '##[error] src/app.ts(42,5): error TS2304: Cannot find name',
  }));
  assert.equal(result.transient, false);
  assert.equal(result.reason, 'permanent-signature');
});

test('classifyRun does not let an incidental transient warning hide a permanent failure', () => {
  const result = classifyRun(457, '', () => ({
    ok: true,
    stdout: [
      'warning: registry request returned HTTP 503 and was retried',
      '##[error] src/app.ts(42,5): error TS2304: Cannot find name',
    ].join('\n'),
  }));
  assert.equal(result.transient, false);
  assert.equal(result.reason, 'permanent-signature');
});

test('classifyRun accepts a failed line whose dominant error is transient', () => {
  const result = classifyRun(458, '', () => ({
    ok: true,
    stdout: '##[error] npm ERR! request failed: HTTP 503',
  }));
  assert.equal(result.transient, true);
  assert.equal(result.reason, 'transient-signature');
});

test('rerun scan uses the supported attempt field and accepts empty rerun stdout', () => {
  const calls = [];
  const result = rerunTransientFailedRuns(
    {
      repo: 'owner/repo',
      since: '2026-08-08T00:00:00Z',
    },
    (args) => {
      calls.push(args);
      if (args[1] === 'list') {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              databaseId: 789,
              workflowName: 'CI',
              attempt: 1,
            },
          ]),
        };
      }
      if (args.includes('--log-failed')) {
        return { ok: true, stdout: 'npm ERR! HTTP 503' };
      }
      return { ok: true, stdout: '' };
    },
  );

  assert.equal(result.rerun.length, 1);
  const listCall = calls.find((args) => args[1] === 'list');
  assert.ok(listCall.includes('--repo'));
  assert.equal(listCall[listCall.indexOf('--status') + 1], 'failure');
  assert.match(listCall[listCall.indexOf('--json') + 1], /\battempt\b/);
  assert.doesNotMatch(listCall[listCall.indexOf('--json') + 1], /runAttempt/);
  assert.deepEqual(calls.at(-1), [
    'run',
    'rerun',
    '789',
    '--failed',
    '--repo',
    'owner/repo',
  ]);
});

test('rerun scan reports a failed gh run list instead of silently returning empty', () => {
  const result = rerunTransientFailedRuns(
    { since: '2026-08-08T00:00:00Z' },
    () => ({ ok: false, stdout: '', error: 'unsupported field' }),
  );
  assert.equal(result.error, 'run-list-failed');
});

test('buildRecoveryLedger distinguishes accepted rerun requests from outcomes', () => {
  const ledger = buildRecoveryLedger({
    scanned: 2,
    rerun: [{ runId: 789, workflowName: 'CI', reason: 'transient-signature' }],
    skipped: [{ runId: 456, workflowName: 'Lint', reason: 'non-transient' }],
  });

  assert.deepEqual(ledger, {
    schemaVersion: 1,
    scanned: 2,
    rerunRequested: [
      { runId: 789, workflowName: 'CI', reason: 'transient-signature' },
    ],
    skipped: [{ runId: 456, workflowName: 'Lint', reason: 'non-transient' }],
    error: null,
  });
  assert.equal('rerun' in ledger, false);
});

test('monitor workflow runs transient recovery before the ZAI diagnosis step', () => {
  const workflow = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      '..',
      'monitor-amnezia-control-panel-github-runs.yml',
    ),
    'utf8',
  );
  const rerunIndex = workflow.indexOf('rerun-transient-failed-runs.cjs');
  const agentIndex = workflow.indexOf(
    'name: Monitor runs and apply narrow fixes',
  );

  assert.ok(rerunIndex >= 0, 'monitor workflow must invoke the MON-E04 script');
  assert.ok(
    rerunIndex < agentIndex,
    'transient recovery must run before AI diagnosis',
  );
  assert.match(
    workflow,
    /--since "\$\{\{ steps\.window\.outputs\.monitor_since \}\}"/,
  );
  assert.match(workflow, /TRANSIENT_RERUN_SUMMARY/);
  assert.match(workflow, /rerunRequested\[\]\.runId/);
  assert.match(workflow, /recovery-pending/);
  assert.match(workflow, /recovered-transient/);
  assert.match(workflow, /structural code-fix candidate/);
  assert.match(workflow, /repeated-transient reliability incident/);
  assert.match(workflow, /absent, invalid, or reports an error/);
});

test('static monitor agent mirrors the runtime MON-E04 recovery contract', () => {
  const agent = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '.claude/agents/kos-monitor-amnezia-control-panel-github-runs.md',
    ),
    'utf8',
  );

  assert.match(agent, /rerunRequested\[\]\.runId/);
  assert.match(agent, /recovery-pending/);
  assert.match(agent, /recovered-transient/);
  assert.match(agent, /structural code-fix candidate/);
  assert.match(agent, /repeated-transient reliability incident/);
  assert.match(agent, /absent, invalid, or reports an error/);
});
