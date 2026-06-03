import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildClaudeLogScan,
  buildFindings,
  writeGithubOutputs,
} = require('../../../.github/workflows/scripts/scan-claude-logs.cjs');
const {
  parseClaudeExecution,
} = require('../../../.github/workflows/scripts/parse-claude-execution.cjs');

function parseGitHubOutput(text: string) {
  const output: Record<string, string> = {};
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const multilineMatch = line.match(/^([^<]+)<<(.+)$/);
    if (multilineMatch) {
      const [, key, delimiter] = multilineMatch;
      const valueLines = [];
      index += 1;
      while (index < lines.length && lines[index] !== delimiter) {
        valueLines.push(lines[index]);
        index += 1;
      }
      output[key] = valueLines.join('\n');
      continue;
    }

    const separator = line.indexOf('=');
    if (separator >= 0) {
      output[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return output;
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scan-claude-logs-test-'));
}

function baseMetrics(overrides = {}) {
  return {
    attempt: 1,
    outcome: 'success',
    maxTurns: 40,
    durationMs: 1000,
    durationSec: 1,
    totalCostUsd: 0,
    modelUsed: 'glm-5',
    numTurns: 1,
    isError: false,
    turnsBudgetPct: 2.5,
    costPerTurn: 0,
    durationPerTurnMs: 1000,
    numToolCalls: 0,
    toolBreakdown: {},
    numFailedToolCalls: 0,
    failedToolSamples: [],
    numRejectedToolCalls: 0,
    rejectedToolsList: [],
    denialRate: null,
    readFilesCount: 0,
    readFilesList: [],
    editFilesCount: 0,
    editFilesList: [],
    changedFilesCount: 0,
    changedFilesList: [],
    actionError: '',
    errorMessages: [],
    lastOutput: '',
    ...overrides,
  };
}

describe('scan-claude-logs', () => {
  it('writes no-finding outputs without creating an issue file', () => {
    const tmpDir = makeTempDir();
    const outputPath = path.join(tmpDir, 'github-output.txt');
    const metrics = parseClaudeExecution({
      executionText: JSON.stringify({
        type: 'result',
        is_error: false,
        duration_ms: 1000,
        num_turns: 2,
        total_cost_usd: 0,
      }),
      maxTurns: '40',
      attempt: '1',
      outcome: 'success',
    });
    const scan = buildClaudeLogScan({
      metrics,
      runId: '123',
      workflow: 'test-job',
      conclusion: 'success',
      attempt: '1',
      maxTurns: '40',
    });

    const { issueFile } = writeGithubOutputs({
      scan,
      outputPath,
      issuesDir: tmpDir,
    });
    const outputs = parseGitHubOutput(fs.readFileSync(outputPath, 'utf8'));

    assert.equal(issueFile, '');
    assert.equal(outputs.claude_issues_file, '');
    assert.equal(outputs.has_findings, 'false');
    assert.equal(outputs.has_error_findings, 'false');
    assert.equal(outputs.num_turns, '2');
    assert.equal(outputs.is_error, 'false');
    assert.equal(outputs.metrics_json, JSON.stringify(metrics));
  });

  it('builds action_error findings and error summaries', () => {
    const metrics = baseMetrics({
      actionError: 'Action failed with error: sample failure',
      errorMessages: ['Action failed with error: sample failure'],
    });
    const scan = buildClaudeLogScan({
      metrics,
      runId: '456',
      workflow: 'claude-job',
      conclusion: 'failure',
      attempt: '1',
      maxTurns: '40',
    });
    const tmpDir = makeTempDir();
    const outputPath = path.join(tmpDir, 'github-output.txt');

    writeGithubOutputs({ scan, outputPath, issuesDir: tmpDir });
    const outputs = parseGitHubOutput(fs.readFileSync(outputPath, 'utf8'));

    assert.equal(scan.findings[0].category, 'action_error');
    assert.equal(scan.findings[0].severity, 'error');
    assert.equal(outputs.has_findings, 'true');
    assert.equal(outputs.has_error_findings, 'true');
    assert.equal(outputs.findings_summary, 'action_error');
  });

  it('grades failed tool calls as error for failed or turn-limit runs and warning otherwise', () => {
    const metrics = baseMetrics({
      numTurns: 40,
      isError: true,
      numFailedToolCalls: 1,
      failedToolSamples: [
        {
          tool: 'Bash',
          command: 'gh run view 26711225846 --log',
          category: 'approval_required',
          error: 'This command requires approval',
        },
      ],
    });

    assert.equal(
      buildFindings({
        metrics,
        conclusion: 'failure',
        maxTurns: 40,
      }).find(
        (finding: { category: string }) =>
          finding.category === 'failed_tool_calls',
      )?.severity,
      'error',
    );
    assert.equal(
      buildFindings({
        metrics,
        conclusion: 'success',
        maxTurns: 40,
      }).find(
        (finding: { category: string }) =>
          finding.category === 'failed_tool_calls',
      )?.severity,
      'error',
    );
    assert.equal(
      buildFindings({
        metrics: { ...metrics, numTurns: 10, isError: false },
        conclusion: 'success',
        maxTurns: 40,
      }).find(
        (finding: { category: string }) =>
          finding.category === 'failed_tool_calls',
      )?.severity,
      'warning',
    );
  });

  it('detects known log-pattern findings', () => {
    const findings = buildFindings({
      metrics: baseMetrics(),
      maxTurns: 40,
      logText: [
        'fatal: unable to access https://github.com/example/repo returned error: 403',
        'pull request create failed: GraphQL: No commits between main and branch',
        'Internal error: directory mismatch',
        "Can't find 'action.yml'",
        'Failed to fetch user display name GraphqlResponseError',
        'is_rate_limited=true',
        'is_rate_limited=true',
        'is_rate_limited=true',
      ].join('\n'),
    });
    const categories = findings.map(
      (finding: { category: string }) => finding.category,
    );

    assert.deepEqual(categories, [
      'git_push_403',
      'graphql_pr_fail',
      'internal_error',
      'action_not_found',
      'graphql_user_err',
      'rate_limited',
    ]);
  });

  it('classifies API Error 529 log text as rate_limited', () => {
    const findings = buildFindings({
      metrics: baseMetrics(),
      maxTurns: 40,
      logText:
        '##[error]API Error: 529 {"error":"[1305][service temporarily overloaded]"}',
    });
    const categories = findings.map(
      (finding: { category: string }) => finding.category,
    );

    assert.deepEqual(categories, ['rate_limited']);
  });

  it('classifies execution JSON 529 errors as rate_limited without job logs', () => {
    const metrics = parseClaudeExecution({
      executionText: JSON.stringify({
        type: 'result',
        is_error: true,
        duration_ms: 1000,
        num_turns: 1,
        result:
          'API Error: 529 {"error":"[1305][service temporarily overloaded]"}',
      }),
      maxTurns: '40',
      attempt: '1',
      outcome: 'failure',
    });
    const scan = buildClaudeLogScan({
      metrics,
      logText: '',
      runId: '195',
      workflow: 'fix-issue',
      conclusion: 'failure',
      attempt: '1',
      maxTurns: '40',
    });
    const categories = scan.findings.map(
      (finding: { category: string }) => finding.category,
    );

    assert.ok(
      metrics.errorMessages.some((message: string) =>
        message.includes('API Error: 529'),
      ),
    );
    assert.deepEqual(categories, ['rate_limited']);
  });

  it('CLI writes GitHub outputs and a readable issue JSON file from samples', () => {
    const tmpDir = makeTempDir();
    const executionFile = path.join(tmpDir, 'execution.jsonl');
    const logFile = path.join(tmpDir, 'job.log');
    const changedFilesFile = path.join(tmpDir, 'changed-files.txt');
    const outputPath = path.join(tmpDir, 'github-output.txt');
    const scriptPath = path.resolve(
      '.github/workflows/scripts/scan-claude-logs.cjs',
    );

    fs.writeFileSync(
      executionFile,
      `${JSON.stringify({
        type: 'result',
        is_error: false,
        duration_ms: 18,
        num_turns: 1,
        total_cost_usd: 0,
      })}\n`,
    );
    fs.writeFileSync(
      logFile,
      '##[error]Action failed with error: CLI sample failure\n',
    );
    fs.writeFileSync(changedFilesFile, 'src/sample.ts\n');

    const stdout = execFileSync(
      process.execPath,
      [
        scriptPath,
        '--execution-file',
        executionFile,
        '--log-file',
        logFile,
        '--changed-files-file',
        changedFilesFile,
        '--max-turns',
        '40',
        '--attempt',
        '1',
        '--outcome',
        'failure',
        '--run-id',
        '789',
        '--workflow',
        'scan-job',
        '--github-output',
        outputPath,
        '--issues-dir',
        tmpDir,
      ],
      { encoding: 'utf8' },
    );
    const outputs = parseGitHubOutput(fs.readFileSync(outputPath, 'utf8'));
    const issue = JSON.parse(
      fs.readFileSync(outputs.claude_issues_file, 'utf8'),
    );

    assert.match(stdout, /Scanned Claude logs - 1 finding/);
    assert.equal(outputs.has_findings, 'true');
    assert.equal(outputs.has_error_findings, 'true');
    assert.equal(outputs.findings_summary, 'action_error');
    assert.deepEqual(JSON.parse(outputs.changed_files_list), ['src/sample.ts']);
    assert.equal(JSON.parse(outputs.metrics_json).numTurns, 1);
    assert.equal(issue.run_id, 789);
    assert.equal(issue.workflow, 'scan-job');
    assert.equal(issue.findings[0].category, 'action_error');
    assert.equal(
      issue.metrics.actionError,
      'Action failed with error: CLI sample failure',
    );
  });
});
