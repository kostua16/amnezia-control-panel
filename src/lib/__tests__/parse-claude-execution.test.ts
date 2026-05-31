import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  parseClaudeExecution,
  redactSecrets,
} = require('../../../.github/workflows/scripts/parse-claude-execution.cjs');
const {
  mergeClaudeMetrics,
  renderClaudeExecutionSection,
} = require('../../../.github/workflows/scripts/render-claude-report.cjs');

describe('parseClaudeExecution', () => {
  it('extracts issue #128 structured-output failure from logs while preserving execution metrics', () => {
    const executionText = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 18,
      num_turns: 0,
      total_cost_usd: 0,
      permission_denials_count: 0,
    });
    const logText = [
      'improve (127)\tUNKNOWN STEP\t2026-05-30T19:11:26.8457129Z Running Claude Code via SDK (full output hidden for security)...',
      'improve (127)\tUNKNOWN STEP\t2026-05-30T19:11:27.8870081Z   "model": "glm-5"',
      'improve (127)\tUNKNOWN STEP\t2026-05-30T19:11:27.9247365Z ##[error]--json-schema was provided but Claude did not return structured_output. Result subtype: success',
      'improve (127)\tUNKNOWN STEP\t2026-05-30T19:11:27.9255779Z ##[error]Action failed with error: --json-schema was provided but Claude did not return structured_output. Result subtype: success',
    ].join('\n');

    const metrics = parseClaudeExecution({
      executionText,
      logText,
      maxTurns: '40',
      attempt: '1',
      outcome: 'failure',
    });

    assert.equal(metrics.attempt, 1);
    assert.equal(metrics.outcome, 'failure');
    assert.equal(metrics.numTurns, 0);
    assert.equal(metrics.durationMs, 18);
    assert.equal(metrics.durationSec, 0);
    assert.equal(metrics.totalCostUsd, 0);
    assert.equal(
      metrics.actionError,
      'Action failed with error: --json-schema was provided but Claude did not return structured_output. Result subtype: success',
    );
    assert.ok(
      metrics.errorMessages.some((message: string) =>
        message.includes('--json-schema was provided'),
      ),
    );
  });

  it('parses execution JSON without requiring logs', () => {
    const metrics = parseClaudeExecution({
      executionText: JSON.stringify({
        type: 'result',
        is_error: true,
        duration_ms: 15000,
        num_turns: 10,
        total_cost_usd: 0.25,
        permission_denials_count: 2,
      }),
      maxTurns: '40',
    });

    assert.equal(metrics.numTurns, 10);
    assert.equal(metrics.isError, true);
    assert.equal(metrics.durationSec, 15);
    assert.equal(metrics.totalCostUsd, 0.25);
    assert.equal(metrics.numRejectedToolCalls, 2);
    assert.equal(metrics.turnsBudgetPct, 25);
    assert.equal(metrics.costPerTurn, 0.025);
    assert.equal(metrics.durationPerTurnMs, 1500);
  });

  it('counts tool calls and dedupes read/edit file lists from execution events', () => {
    const executionText = [
      JSON.stringify({ type: 'system', subtype: 'init', model: 'glm-5' }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: 'src/a.ts' },
            },
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: 'src/a.ts' },
            },
            {
              type: 'tool_use',
              name: 'Edit',
              input: { file_path: 'src/b.ts' },
            },
            { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
            { type: 'tool_result', is_error: true, content: 'Error: failed' },
          ],
        },
      }),
      JSON.stringify({
        type: 'result',
        duration_ms: 1000,
        num_turns: 2,
        total_cost_usd: 0.1,
      }),
    ].join('\n');

    const metrics = parseClaudeExecution({
      executionText,
      changedFiles: 'src/b.ts\nsrc/c.ts\nsrc/b.ts\n',
      logText: 'DISALLOWED_TOOLS: Bash(rm *), WebFetch',
    });

    assert.equal(metrics.modelUsed, 'glm-5');
    assert.equal(metrics.numToolCalls, 4);
    assert.deepEqual(metrics.toolBreakdown, { Bash: 1, Edit: 1, Read: 2 });
    assert.equal(metrics.numFailedToolCalls, 1);
    assert.equal(metrics.readFilesCount, 1);
    assert.deepEqual(metrics.readFilesList, ['src/a.ts']);
    assert.equal(metrics.editFilesCount, 1);
    assert.deepEqual(metrics.editFilesList, ['src/b.ts']);
    assert.deepEqual(metrics.changedFilesList, ['src/b.ts', 'src/c.ts']);
    assert.deepEqual(metrics.rejectedToolsList, ['Bash(rm *)', 'WebFetch']);
  });

  it('counts pretty-printed tool_use blocks from full SDK logs when execution events are summary-only', () => {
    const logText = [
      'Running Claude Code via SDK...',
      '{',
      '  "type": "tool_use",',
      '  "name": "Read",',
      '  "input": {',
      '    "file_path": "src/full-log.ts"',
      '  }',
      '}',
      '{',
      '  "type": "tool_use",',
      '  "name": "Write",',
      '  "input": {',
      '    "file_path": "src/new-file.ts"',
      '  }',
      '}',
      '{',
      '  "type": "tool_result",',
      '  "is_error": true',
      '}',
      '  "num_turns": 3,',
      '  "duration_ms": 9000',
    ].join('\n');

    const metrics = parseClaudeExecution({
      executionText: JSON.stringify({ type: 'result', total_cost_usd: 0.03 }),
      logText,
      maxTurns: '30',
    });

    assert.equal(metrics.numTurns, 3);
    assert.equal(metrics.durationMs, 9000);
    assert.equal(metrics.numToolCalls, 2);
    assert.deepEqual(metrics.toolBreakdown, { Read: 1, Write: 1 });
    assert.equal(metrics.numFailedToolCalls, 1);
    assert.deepEqual(metrics.readFilesList, ['src/full-log.ts']);
    assert.deepEqual(metrics.editFilesList, ['src/new-file.ts']);
  });

  it('redacts common secret-like values from log-derived text', () => {
    assert.equal(
      redactSecrets('ANTHROPIC_API_KEY=sk-secret Bearer abc.def'),
      'ANTHROPIC_API_KEY=[REDACTED] Bearer [REDACTED]',
    );
  });

  it('extracts scheduled track_progress action errors without counting shell-source DISALLOWED_TOOLS', () => {
    const logText = [
      'audit-fix\tAudit repository and apply targeted fixes\t2026-05-31T11:23:39.3995994Z ##[error]Action failed with error: track_progress is only supported for events: pull_request, issues, issue_comment, pull_request_review_comment, pull_request_review. Current event: schedule',
      'audit-fix\tAudit repository and apply targeted fixes\t2026-05-31T11:23:43.8026503Z \u001b[36;1m  if [[ "$PERM_DENIALS" -gt 5 ]]; then SEV="error"; else SEV="warning"; fi\u001b[0m',
      'audit-fix\tAudit repository and apply targeted fixes\t2026-05-31T11:23:43.8028498Z \u001b[36;1m  [[ -n "$DISALLOWED" ]] && DETAIL="DISALLOWED_TOOLS: $DISALLOWED"\u001b[0m',
      'audit-fix\tAudit repository and apply targeted fixes\t2026-05-31T11:23:43.7322921Z ##[error]Attempt 1 failed with non-retryable error (API probe returned HTTP 200). Skipping retries.',
    ].join('\n');

    const metrics = parseClaudeExecution({
      logText,
      maxTurns: '100',
      attempt: '1',
      outcome: 'failure',
    });

    assert.equal(metrics.attempt, 1);
    assert.equal(metrics.outcome, 'failure');
    assert.equal(
      metrics.actionError,
      'Action failed with error: track_progress is only supported for events: pull_request, issues, issue_comment, pull_request_review_comment, pull_request_review. Current event: schedule',
    );
    assert.equal(metrics.numRejectedToolCalls, 0);
    assert.deepEqual(metrics.rejectedToolsList, []);
  });
});

describe('renderClaudeExecutionSection', () => {
  it('fills blank sparse metrics from detected failure metrics', () => {
    const sparseMetrics = {
      attempt: 1,
      outcome: 'failure',
      maxTurns: 100,
      modelUsed: '',
      numTurns: null,
      actionError: '',
      errorMessages: [],
      lastOutput: '',
      toolBreakdown: {},
      numToolCalls: 0,
    };
    const detectedMetrics = {
      modelUsed: 'glm-5',
      actionError:
        'Action failed with error: track_progress is only supported for events: pull_request, issues, issue_comment, pull_request_review_comment, pull_request_review. Current event: schedule',
      errorMessages: [
        'Action failed with error: track_progress is only supported for events: pull_request, issues, issue_comment, pull_request_review_comment, pull_request_review. Current event: schedule',
      ],
      lastOutput:
        '##[error]Action failed with error: track_progress is only supported for events: pull_request, issues, issue_comment, pull_request_review_comment, pull_request_review. Current event: schedule',
      toolBreakdown: { Read: 1 },
      numToolCalls: 1,
    };

    const merged = mergeClaudeMetrics(
      JSON.stringify(sparseMetrics),
      JSON.stringify(detectedMetrics),
    );

    assert.equal(merged.attempt, 1);
    assert.equal(merged.outcome, 'failure');
    assert.equal(merged.maxTurns, 100);
    assert.equal(merged.modelUsed, 'glm-5');
    assert.equal(merged.numTurns, null);
    assert.equal(merged.numToolCalls, 0);
    assert.deepEqual(merged.toolBreakdown, { Read: 1 });
    assert.match(merged.actionError, /track_progress is only supported/);
    assert.deepEqual(merged.errorMessages, detectedMetrics.errorMessages);
    assert.equal(merged.lastOutput, detectedMetrics.lastOutput);
  });

  it('renders a compact report section with the real action error', () => {
    const section = renderClaudeExecutionSection({
      claudeStepOutcome: 'failure',
      claudeUsedAttempt: '1',
      claudeTurns: '0',
      claudeDurationMs: '18',
      claudeTotalCostUsd: '0',
      claudeToolBreakdown: JSON.stringify({ Read: 2, Bash: 1 }),
      claudeActionError:
        'Action failed with error: --json-schema was provided but Claude did not return structured_output. Result subtype: success',
      claudeLastOutput: 'Running Claude Code via SDK\n"type": "result"',
    });

    assert.match(section, /### Claude Execution/);
    assert.match(section, /Read: 2, Bash: 1|Bash: 1, Read: 2/);
    assert.match(
      section,
      /--json-schema was provided but Claude did not return structured_output/,
    );
    assert.match(section, /Last Claude SDK output/);
  });
});
