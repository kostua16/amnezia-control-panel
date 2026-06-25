/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildFindings,
  buildClaudeLogScan,
  writeGithubOutputs,
} = require('../scan-claude-logs.cjs');

// ---------------------------------------------------------------------------
// buildFindings
// ---------------------------------------------------------------------------

test('buildFindings returns empty array when no issues detected', () => {
  const findings = buildFindings({
    metrics: { numTurns: 5, isError: false, maxTurns: 70 },
    logText: 'some normal log output\nall good here',
    conclusion: 'success',
    maxTurns: 70,
  });
  assert.deepStrictEqual(findings, []);
});

test('buildFindings detects action_error', () => {
  const findings = buildFindings({
    metrics: { actionError: 'Claude Code failed with a non-retryable error' },
    logText: '',
    conclusion: 'failure',
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, 'action_error');
  assert.equal(findings[0].severity, 'error');
  assert.equal(findings[0].message, 'Claude action failed');
  assert.ok(findings[0].detail.includes('non-retryable'));
});

test('buildFindings detects permission_denials as warning when <= 5', () => {
  const findings = buildFindings({
    metrics: {
      numRejectedToolCalls: 3,
      rejectedToolsList: ['Bash(rm:*)', 'Bash(sudo:*)'],
    },
    logText: '',
  });
  const denial = findings.find((f) => f.category === 'permission_denials');
  assert.ok(denial, 'expected permission_denials finding');
  assert.equal(denial.severity, 'warning');
  assert.ok(denial.detail.includes('DISALLOWED_TOOLS'));
  assert.ok(denial.detail.includes('Bash(rm:*)'));
});

test('buildFindings detects permission_denials as error when > 5', () => {
  const findings = buildFindings({
    metrics: {
      numRejectedToolCalls: 8,
      rejectedToolsList: ['Bash(rm:*)'],
    },
    logText: '',
  });
  const denial = findings.find((f) => f.category === 'permission_denials');
  assert.ok(denial);
  assert.equal(denial.severity, 'error');
});

test('buildFindings detects failed_tool_calls as warning on success', () => {
  const findings = buildFindings({
    metrics: {
      numFailedToolCalls: 2,
      failedToolSamples: [
        { tool: 'Bash', category: 'exec_error', error: 'command not found' },
      ],
    },
    logText: '',
    conclusion: 'success',
  });
  const failed = findings.find((f) => f.category === 'failed_tool_calls');
  assert.ok(failed);
  assert.equal(failed.severity, 'warning');
  assert.ok(failed.detail.includes('Bash/exec_error'));
});

test('buildFindings detects failed_tool_calls as error on failure conclusion', () => {
  const findings = buildFindings({
    metrics: { numFailedToolCalls: 1 },
    logText: '',
    conclusion: 'failure',
  });
  const failed = findings.find((f) => f.category === 'failed_tool_calls');
  assert.ok(failed);
  assert.equal(failed.severity, 'error');
});

test('buildFindings detects failed_tool_calls as error at turn limit with isError', () => {
  const findings = buildFindings({
    metrics: {
      numFailedToolCalls: 1,
      numTurns: 70,
      isError: true,
      maxTurns: 70,
    },
    logText: '',
    conclusion: 'success',
    maxTurns: 70,
  });
  const failed = findings.find((f) => f.category === 'failed_tool_calls');
  assert.ok(failed);
  assert.equal(failed.severity, 'error');
});

test('buildFindings detects git_push_403', () => {
  const findings = buildFindings({
    metrics: {},
    logText:
      'some output\nfatal: unable to access returned error: 403\nmore output',
  });
  const git = findings.find((f) => f.category === 'git_push_403');
  assert.ok(git);
  assert.equal(git.severity, 'error');
});

test('buildFindings detects graphql_pr_fail', () => {
  const findings = buildFindings({
    metrics: {},
    logText: 'pull request create failed: GraphQL: something broke',
  });
  const gql = findings.find((f) => f.category === 'graphql_pr_fail');
  assert.ok(gql);
  assert.equal(gql.severity, 'error');
});

test('buildFindings detects turn_limit_hit with error', () => {
  const findings = buildFindings({
    metrics: { numTurns: 70, isError: true, maxTurns: 70 },
    logText: '',
    conclusion: 'failure',
    maxTurns: 70,
  });
  const turn = findings.find((f) => f.category === 'turn_limit_hit');
  assert.ok(turn);
  assert.equal(turn.severity, 'error');
  assert.ok(turn.detail.includes('70/70'));
});

test('buildFindings does NOT detect turn_limit_hit when turns < maxTurns', () => {
  const findings = buildFindings({
    metrics: { numTurns: 50, isError: true, maxTurns: 70 },
    logText: '',
    maxTurns: 70,
  });
  assert.equal(
    findings.some((f) => f.category === 'turn_limit_hit'),
    false,
  );
});

test('buildFindings detects zero_turns', () => {
  const findings = buildFindings({
    metrics: { numTurns: 0 },
    logText: '',
  });
  const zero = findings.find((f) => f.category === 'zero_turns');
  assert.ok(zero);
  assert.equal(zero.severity, 'error');
});

test('buildFindings detects internal_error directory mismatch', () => {
  const findings = buildFindings({
    metrics: {},
    logText: 'Internal error: directory mismatch',
  });
  const internal = findings.find((f) => f.category === 'internal_error');
  assert.ok(internal);
  assert.equal(internal.severity, 'warning');
});

test('buildFindings detects non-human actor refusal as an action error', () => {
  const findings = buildFindings({
    metrics: {},
    logText:
      '##[error]Action failed with error: Workflow initiated by non-human actor: github-actions (type: Bot). Add bot to allowed_bots list or use "*" to allow all bots.',
  });
  const actor = findings.find((f) => f.category === 'non_human_actor');
  assert.ok(actor);
  assert.equal(actor.severity, 'error');
  assert.match(actor.detail, /github-actions/);
  assert.match(actor.detail, /allowed_bots/);
});

test('buildFindings detects disallowed_tools at info level', () => {
  const findings = buildFindings({
    metrics: {
      rejectedToolsList: ['Bash(curl:*)'],
      numRejectedToolCalls: 0,
    },
    logText: '',
  });
  const disallowed = findings.find((f) => f.category === 'disallowed_tools');
  assert.ok(disallowed);
  assert.equal(disallowed.severity, 'info');
});

test('buildFindings detects missing action.yml', () => {
  const findings = buildFindings({
    metrics: {},
    logText: "Can't find 'action.yml' in the workflow",
  });
  const missing = findings.find((f) => f.category === 'action_not_found');
  assert.ok(missing);
  assert.equal(missing.severity, 'error');
});

test('buildFindings detects graphql user fetch error', () => {
  const findings = buildFindings({
    metrics: {},
    logText: 'Failed to fetch user display name GraphqlResponseError',
  });
  const gql = findings.find((f) => f.category === 'graphql_user_err');
  assert.ok(gql);
  assert.equal(gql.severity, 'warning');
});

test('buildFindings detects rate_limited via 3 occurrences', () => {
  const findings = buildFindings({
    metrics: {},
    logText: 'is_rate_limited=true\nis_rate_limited=true\nis_rate_limited=true',
  });
  const rate = findings.find((f) => f.category === 'rate_limited');
  assert.ok(rate);
  assert.equal(rate.severity, 'error');
  assert.ok(rate.detail.includes('All attempts hit 429'));
});

test('buildFindings detects rate_limited via overloaded text', () => {
  const findings = buildFindings({
    metrics: {
      actionError: 'API Error: 529 service temporarily overloaded',
    },
    logText: '',
  });
  const rate = findings.find((f) => f.category === 'rate_limited');
  assert.ok(rate);
  assert.equal(rate.severity, 'error');
});

test('buildFindings detects uncategorized errors filtering out benign messages', () => {
  const findings = buildFindings({
    metrics: {
      errorMessages: [
        'fatal: no submodule mapping found in .gitmodules',
        '# some TAP diagnostic',
        'real error from Claude',
      ],
    },
    logText: '',
  });
  const uncategorized = findings.find((f) => f.category === 'uncategorized');
  assert.ok(uncategorized);
  // Benign messages (submodule + TAP diagnostic) should be filtered out
  assert.ok(!uncategorized.detail.includes('.gitmodules'));
  assert.ok(!uncategorized.detail.includes('TAP'));
  assert.ok(uncategorized.detail.includes('real error from Claude'));
});

test('buildFindings handles multiple findings simultaneously', () => {
  const findings = buildFindings({
    metrics: {
      actionError: 'Claude Code failed',
      numTurns: 0,
      numRejectedToolCalls: 2,
      rejectedToolsList: ['Bash(rm:*)'],
      errorMessages: ['real error'],
    },
    logText:
      "Can't find 'action.yml'\nis_rate_limited=true\nis_rate_limited=true\nis_rate_limited=true",
  });
  const categories = findings.map((f) => f.category);
  assert.ok(categories.includes('action_error'));
  assert.ok(categories.includes('zero_turns'));
  assert.ok(categories.includes('permission_denials'));
  assert.ok(categories.includes('action_not_found'));
  assert.ok(categories.includes('rate_limited'));
  assert.ok(categories.includes('uncategorized'));
});

// ---------------------------------------------------------------------------
// buildClaudeLogScan
// ---------------------------------------------------------------------------

test('buildClaudeLogScan normalizes inputs and returns expected shape', () => {
  const scan = buildClaudeLogScan({
    metrics: {
      numTurns: 42,
      isError: false,
      maxTurns: 70,
      durationMs: 12345,
      modelUsed: 'claude-sonnet-4-5',
      numToolCalls: 100,
    },
    logText: 'clean run',
    runId: '12345',
    workflow: 'claude-review',
    conclusion: 'success',
    attempt: '1',
    maxTurns: 70,
  });

  assert.equal(scan.run_id, 12345);
  assert.equal(scan.workflow, 'claude-review');
  assert.equal(scan.conclusion, 'success');
  assert.equal(scan.attempt, 1);
  assert.equal(scan.num_turns, 42);
  assert.equal(scan.max_turns, 70);
  assert.equal(scan.is_error, false);
  assert.equal(scan.findings.length, 0);
  assert.equal(scan.metrics.numTurns, 42);
});

test('buildClaudeLogScan string-coerces runId and attempt', () => {
  const scan = buildClaudeLogScan({
    metrics: {},
    runId: '98765',
    attempt: '2',
  });
  assert.equal(scan.run_id, 98765);
  assert.equal(scan.attempt, 2);
});

test('buildClaudeLogScan passes findings through from buildFindings', () => {
  const scan = buildClaudeLogScan({
    metrics: {
      numTurns: 0,
      isError: true,
    },
    logText: '',
    conclusion: 'failure',
  });
  assert.ok(scan.findings.some((f) => f.category === 'zero_turns'));
});

// ---------------------------------------------------------------------------
// writeGithubOutputs
// ---------------------------------------------------------------------------

test('writeGithubOutputs writes correct key=value format', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-logs-test-'));
  const outputPath = path.join(tempDir, 'output.txt');
  const issuesDir = path.join(tempDir, 'issues');

  const { issueFile, output } = writeGithubOutputs({
    scan: {
      run_id: 100,
      workflow: 'test-workflow',
      conclusion: 'success',
      attempt: 1,
      num_turns: 10,
      max_turns: 70,
      is_error: false,
      metrics: {
        numTurns: 10,
        maxTurns: 70,
        isError: false,
        durationMs: 5000,
        durationSec: 5,
        totalCostUsd: '0.05',
        modelUsed: 'claude-sonnet-4-5',
        turnsBudgetPct: '14',
        costPerTurn: '0.005',
        durationPerTurnMs: 500,
        numToolCalls: 50,
        numFailedToolCalls: 0,
        numRejectedToolCalls: 0,
        denialRate: '0',
        readFilesCount: 3,
        editFilesCount: 2,
        changedFilesCount: 4,
        toolBreakdown: { Bash: 20, Read: 15 },
        failedToolSamples: [],
        rejectedToolsList: [],
        readFilesList: ['src/a.ts', 'src/b.ts'],
        editFilesList: ['src/a.ts'],
        changedFilesList: ['src/a.ts', 'src/b.ts'],
        actionError: '',
        errorMessages: [],
        lastOutput: '',
      },
      findings: [],
    },
    outputPath,
    issuesDir,
  });

  const written = fs.readFileSync(outputPath, 'utf8');

  // No findings → no issue file should be written
  assert.equal(issueFile, '');
  assert.ok(written.includes('has_findings=false'));
  assert.ok(written.includes('has_error_findings=false'));
  assert.ok(written.includes('failure_reason='));
  assert.ok(written.includes('num_turns=10'));
  assert.ok(written.includes('is_error=false'));
  assert.ok(written.includes('duration_ms=5000'));
  assert.ok(written.includes('model_used=claude-sonnet-4-5'));
  assert.ok(written.includes('num_tool_calls=50'));

  // Verify tool_breakdown uses multiline format
  assert.ok(written.includes('tool_breakdown<<EOF-'));
  assert.ok(written.includes('"Bash":20'));
  assert.ok(written.includes('"Read":15'));

  // Return value output is the GITHUB_OUTPUT key=value lines
  assert.ok(output.includes('has_findings=false'));

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('writeGithubOutputs preserves the first error finding as failure_reason', () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'scan-logs-test-reason-'),
  );
  const outputPath = path.join(tempDir, 'output.txt');

  const { output } = writeGithubOutputs({
    scan: {
      metrics: {},
      findings: [
        {
          category: 'non_human_actor',
          severity: 'error',
          message: 'Claude action refused bot actor',
          detail:
            'Workflow initiated by non-human actor: github-actions (type: Bot). Add bot to allowed_bots list.',
        },
      ],
    },
    outputPath,
    issuesDir: tempDir,
  });

  assert.ok(output.includes('has_error_findings=true'));
  assert.ok(
    output.includes(
      'failure_reason=Workflow initiated by non-human actor: github-actions (type: Bot). Add bot to allowed_bots list.',
    ),
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('writeGithubOutputs writes issue file when findings exist', () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'scan-logs-test-issues-'),
  );
  const outputPath = path.join(tempDir, 'output.txt');
  const issuesDir = path.join(tempDir, 'issues');

  const scan = {
    run_id: 200,
    workflow: 'test',
    conclusion: 'failure',
    attempt: 2,
    num_turns: 0,
    max_turns: 70,
    is_error: true,
    metrics: { numTurns: 0, isError: true, maxTurns: 70 },
    findings: [
      {
        category: 'zero_turns',
        severity: 'error',
        message: 'Claude used zero turns',
        detail: 'num_turns: 0',
      },
    ],
  };

  const { issueFile } = writeGithubOutputs({
    scan,
    outputPath,
    issuesDir,
  });

  assert.ok(issueFile, 'issue file path should be returned');
  assert.ok(fs.existsSync(issueFile), 'issue file should exist on disk');

  const issueData = JSON.parse(fs.readFileSync(issueFile, 'utf8'));
  assert.equal(issueData.run_id, 200);
  assert.equal(issueData.findings.length, 1);
  assert.equal(issueData.findings[0].category, 'zero_turns');

  const written = fs.readFileSync(outputPath, 'utf8');
  assert.ok(written.includes('has_findings=true'));
  assert.ok(written.includes('has_error_findings=true'));
  assert.ok(written.includes('findings_summary=zero_turns'));

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('writeGithubOutputs handles null/undefined metrics gracefully', () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'scan-logs-test-null-'),
  );
  const outputPath = path.join(tempDir, 'output.txt');

  writeGithubOutputs({
    scan: {
      run_id: 0,
      workflow: '',
      conclusion: '',
      attempt: 0,
      num_turns: null,
      max_turns: null,
      is_error: null,
      metrics: {},
      findings: [],
    },
    outputPath,
  });

  const written = fs.readFileSync(outputPath, 'utf8');
  assert.ok(written.includes('num_turns=null'));
  assert.ok(written.includes('is_error=null'));

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('writeGithubOutputs stdout fallback when no outputPath', () => {
  // Should not throw when outputPath is omitted
  const result = writeGithubOutputs({
    scan: {
      run_id: 1,
      workflow: 'test',
      conclusion: 'success',
      attempt: 1,
      num_turns: 5,
      max_turns: 70,
      is_error: false,
      metrics: { numTurns: 5, maxTurns: 70, isError: false },
      findings: [],
    },
  });
  assert.ok(result.output);
});
