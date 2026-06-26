#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseClaudeExecution,
  redactSecrets,
} = require('./parse-claude-execution.cjs');
const { isRateLimitOrOverloadText } = require('./classify-claude-retry.cjs');

function readOptionalFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg
      .slice(2)
      .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    args[key] =
      argv[index + 1] && !argv[index + 1].startsWith('--')
        ? argv[++index]
        : 'true';
  }
  return args;
}

function asNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to newline parsing.
    }
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

function sanitizeLogLine(value, limit = 200) {
  return redactSecrets(String(value || '').replace(/\r/g, '')).slice(0, limit);
}

function firstMatchingLine(logText, pattern) {
  return String(logText || '')
    .split('\n')
    .find((line) => pattern.test(line));
}

function countMatches(logText, pattern) {
  const matches = String(logText || '').match(pattern);
  return matches ? matches.length : 0;
}

function firstRateLimitEvidenceLine(value) {
  return firstMatchingLine(
    value,
    /API Error:\s*529(?:\D|$)|(?:service\s+)?temporarily overloaded|service overloaded/i,
  );
}

function isBenignErrorMessage(message) {
  if (!message) return true;
  const text = String(message);
  // Git submodule noise from stray worktree dirs / runner checkout artifacts
  // ("fatal: no submodule mapping found in .gitmodules") is not a real run error.
  if (/no submodule mapping found in \.gitmodules/i.test(text)) return true;
  // TAP diagnostic lines ("# ...") are test-runner output captured into tool
  // results (e.g. "# [api/users] Prisma error P2002"), not Claude errors.
  if (/^\s*#/.test(text)) return true;
  return false;
}

function compactJson(value) {
  return JSON.stringify(value);
}

function formatMetric(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function formatNullableMetric(value) {
  return value === null || value === undefined || value === ''
    ? 'null'
    : String(value);
}

function formatCount(value) {
  return String(asNumber(value, 0));
}

function failedToolSampleDetail(samples) {
  return asArray(samples)
    .slice(0, 3)
    .map((sample) => {
      if (!sample || typeof sample !== 'object') return String(sample || '');
      const tool = sample.tool || 'unknown';
      const category = sample.category || 'unknown';
      const target = sample.command || sample.filePath || sample.error || '';
      return `${tool}/${category}: ${target}`;
    })
    .join('; ')
    .slice(0, 300);
}

function addFinding(findings, category, severity, message, detail) {
  findings.push({ category, severity, message, detail });
}

function firstErrorFailureReason(findings) {
  const finding =
    findings.find(
      (item) =>
        item.severity === 'error' && item.category === 'non_human_actor',
    ) || findings.find((item) => item.severity === 'error');
  if (!finding) return '';
  return sanitizeLogLine(finding.detail || finding.message || '', 300)
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function buildFindings({
  metrics = {},
  logText = '',
  conclusion = '',
  maxTurns,
}) {
  const findings = [];
  const actionError = metrics.actionError || '';
  const errorMessages = asArray(metrics.errorMessages);
  const numTurns = asNumber(metrics.numTurns, null);
  const maxTurnsNumber = asNumber(maxTurns ?? metrics.maxTurns, null);
  const isError = asBoolean(metrics.isError);
  const permissionDenials = asNumber(metrics.numRejectedToolCalls, 0);
  const failedToolCalls = asNumber(metrics.numFailedToolCalls, 0);
  const rejectedToolsList = asArray(metrics.rejectedToolsList);
  const rateLimitEvidenceText = [
    logText,
    actionError,
    ...errorMessages,
    metrics.lastOutput || '',
  ].join('\n');

  if (actionError) {
    addFinding(
      findings,
      'action_error',
      'error',
      'Claude action failed',
      actionError,
    );
  }

  if (permissionDenials > 0) {
    const disallowed = rejectedToolsList.join(', ');
    addFinding(
      findings,
      'permission_denials',
      permissionDenials > 5 ? 'error' : 'warning',
      `${permissionDenials} tool permission denials`,
      disallowed
        ? `DISALLOWED_TOOLS: ${disallowed}`
        : `${permissionDenials} rejected tool call(s)`,
    );
  }

  if (failedToolCalls > 0) {
    let severity = 'warning';
    if (conclusion === 'failure') {
      severity = 'error';
    } else if (
      numTurns !== null &&
      numTurns > 0 &&
      maxTurnsNumber !== null &&
      numTurns >= maxTurnsNumber &&
      isError === true
    ) {
      severity = 'error';
    }
    addFinding(
      findings,
      'failed_tool_calls',
      severity,
      `${failedToolCalls} failed tool call(s)`,
      failedToolSampleDetail(metrics.failedToolSamples) ||
        `${failedToolCalls} failed tool call(s)`,
    );
  }

  const git403Line = firstMatchingLine(
    logText,
    /fatal: unable to access.*returned error: 403/,
  );
  if (git403Line) {
    addFinding(
      findings,
      'git_push_403',
      'error',
      'Git push failed with HTTP 403',
      sanitizeLogLine(git403Line),
    );
  }

  if (/pull request create failed: GraphQL:/.test(logText)) {
    addFinding(
      findings,
      'graphql_pr_fail',
      'error',
      'GraphQL PR creation failed',
      'pull request create failed: GraphQL:',
    );
  }

  if (
    numTurns !== null &&
    numTurns > 0 &&
    maxTurnsNumber !== null &&
    numTurns >= maxTurnsNumber &&
    isError === true
  ) {
    addFinding(
      findings,
      'turn_limit_hit',
      'error',
      'Turn limit hit with error',
      `Turns: ${numTurns}/${maxTurnsNumber}`,
    );
  }

  if (numTurns === 0) {
    addFinding(
      findings,
      'zero_turns',
      'error',
      'Claude used zero turns',
      'num_turns: 0',
    );
  }

  if (/Internal error: directory mismatch/.test(logText)) {
    addFinding(
      findings,
      'internal_error',
      'warning',
      'Internal directory mismatch',
      'Internal error: directory mismatch',
    );
  }

  const nonHumanActorLine = firstMatchingLine(
    logText,
    /Workflow initiated by non-human actor: .*allowed_bots/i,
  );
  if (nonHumanActorLine) {
    const actorReason = String(nonHumanActorLine).replace(
      /^.*Action failed with error:\s*/,
      '',
    );
    addFinding(
      findings,
      'non_human_actor',
      'error',
      'Claude action refused bot actor',
      sanitizeLogLine(actorReason, 300),
    );
  }

  if (rejectedToolsList.length > 0 && permissionDenials === 0) {
    addFinding(
      findings,
      'disallowed_tools',
      'info',
      'Disallowed tools detected',
      rejectedToolsList.join(', '),
    );
  }

  if (/Can't find 'action\.yml'/.test(logText)) {
    addFinding(
      findings,
      'action_not_found',
      'error',
      'Missing action.yml',
      'action.yml not found',
    );
  }

  if (/Failed to fetch user display name.*GraphqlResponseError/.test(logText)) {
    addFinding(
      findings,
      'graphql_user_err',
      'warning',
      'GraphQL user fetch failed',
      'GraphqlResponseError',
    );
  }

  const allAttemptsRateLimited =
    countMatches(logText, /is_rate_limited=true/g) >= 3;
  if (
    allAttemptsRateLimited ||
    isRateLimitOrOverloadText(rateLimitEvidenceText)
  ) {
    addFinding(
      findings,
      'rate_limited',
      'error',
      allAttemptsRateLimited
        ? 'All 3 attempts rate limited'
        : 'Claude API temporarily overloaded',
      allAttemptsRateLimited
        ? 'All attempts hit 429'
        : sanitizeLogLine(
            firstRateLimitEvidenceLine(rateLimitEvidenceText) ||
              'API Error: 529 / temporarily overloaded',
          ),
    );
  }

  const extraErrors = errorMessages
    .filter(
      (message) =>
        message &&
        message !== actionError &&
        !/Claude Code failed with a non-(rate-limit|retryable) error/.test(
          message,
        ) &&
        !isRateLimitOrOverloadText(message) &&
        !isBenignErrorMessage(message),
    )
    .slice(0, 3);
  if (extraErrors.length > 0) {
    addFinding(
      findings,
      'uncategorized',
      'error',
      `${extraErrors.length} unrecognized error(s) from Claude run`,
      extraErrors.join('\n').slice(0, 300),
    );
  }

  return findings;
}

function buildClaudeLogScan({
  metrics = {},
  logText = '',
  runId = '0',
  workflow = '',
  conclusion = '',
  attempt = 0,
  maxTurns,
}) {
  const normalizedMaxTurns = asNumber(maxTurns ?? metrics.maxTurns, null);
  const normalizedAttempt = asNumber(attempt ?? metrics.attempt, 0);
  const normalizedConclusion = conclusion || metrics.outcome || '';
  const normalizedRunId = asNumber(runId, 0);
  const normalizedNumTurns = asNumber(metrics.numTurns, null);
  const normalizedIsError = asBoolean(metrics.isError);
  const permissionDenials = asNumber(metrics.numRejectedToolCalls, 0);
  const findings = buildFindings({
    metrics,
    logText,
    conclusion: normalizedConclusion,
    maxTurns: normalizedMaxTurns,
  });

  return {
    run_id: normalizedRunId,
    workflow,
    conclusion: normalizedConclusion,
    attempt: normalizedAttempt,
    num_turns: normalizedNumTurns,
    max_turns: normalizedMaxTurns,
    permission_denials_count: permissionDenials,
    is_error: normalizedIsError,
    metrics,
    findings,
  };
}

function appendOutput(lines, key, value, { multiline = false } = {}) {
  const normalized = value === null || value === undefined ? '' : String(value);
  if (!multiline && !normalized.includes('\n')) {
    lines.push(`${key}=${normalized}`);
    return;
  }
  const delimiter = `EOF-${crypto.randomBytes(8).toString('hex')}`;
  lines.push(`${key}<<${delimiter}`, normalized, delimiter);
}

function createIssueFile(scan, issuesDir = os.tmpdir()) {
  fs.mkdirSync(issuesDir, { recursive: true });
  const issueDir = fs.mkdtempSync(path.join(issuesDir, 'claude-issues-'));
  const issueFile = path.join(issueDir, 'scan.json');
  fs.writeFileSync(issueFile, `${compactJson(scan)}\n`);
  return issueFile;
}

function writeGithubOutputs({ scan, outputPath, issuesDir = os.tmpdir() }) {
  const metrics = scan.metrics || {};
  const findings = scan.findings || [];
  const errorFindings = findings.filter(
    (finding) => finding.severity === 'error',
  );
  const lines = [];
  const issueFile = findings.length > 0 ? createIssueFile(scan, issuesDir) : '';

  appendOutput(lines, 'claude_issues_file', issueFile);
  appendOutput(lines, 'has_findings', findings.length > 0 ? 'true' : 'false');
  appendOutput(
    lines,
    'has_error_findings',
    errorFindings.length > 0 ? 'true' : 'false',
  );
  appendOutput(
    lines,
    'findings_summary',
    errorFindings.map((finding) => finding.category).join(','),
  );
  appendOutput(lines, 'failure_reason', firstErrorFailureReason(findings));

  appendOutput(lines, 'num_turns', formatNullableMetric(metrics.numTurns));
  appendOutput(lines, 'is_error', formatNullableMetric(metrics.isError));
  appendOutput(lines, 'duration_ms', formatMetric(metrics.durationMs));
  appendOutput(lines, 'duration_sec', formatMetric(metrics.durationSec));
  appendOutput(lines, 'total_cost_usd', formatMetric(metrics.totalCostUsd));
  appendOutput(lines, 'model_used', formatMetric(metrics.modelUsed));
  appendOutput(lines, 'turns_budget_pct', formatMetric(metrics.turnsBudgetPct));
  appendOutput(lines, 'cost_per_turn', formatMetric(metrics.costPerTurn));
  appendOutput(
    lines,
    'duration_per_turn_ms',
    formatMetric(metrics.durationPerTurnMs),
  );
  appendOutput(lines, 'num_tool_calls', formatCount(metrics.numToolCalls));
  appendOutput(
    lines,
    'num_failed_tool_calls',
    formatCount(metrics.numFailedToolCalls),
  );
  appendOutput(
    lines,
    'num_rejected_tool_calls',
    formatCount(metrics.numRejectedToolCalls),
  );
  appendOutput(lines, 'denial_rate', formatMetric(metrics.denialRate));
  appendOutput(lines, 'read_files_count', formatCount(metrics.readFilesCount));
  appendOutput(lines, 'edit_files_count', formatCount(metrics.editFilesCount));
  appendOutput(
    lines,
    'changed_files_count',
    formatCount(metrics.changedFilesCount),
  );
  appendOutput(
    lines,
    'tool_breakdown',
    compactJson(metrics.toolBreakdown || {}),
    { multiline: true },
  );
  appendOutput(
    lines,
    'failed_tool_samples',
    compactJson(metrics.failedToolSamples || []),
    { multiline: true },
  );
  appendOutput(
    lines,
    'rejected_tools_list',
    compactJson(metrics.rejectedToolsList || []),
    { multiline: true },
  );
  appendOutput(
    lines,
    'read_files_list',
    compactJson(metrics.readFilesList || []),
    { multiline: true },
  );
  appendOutput(
    lines,
    'edit_files_list',
    compactJson(metrics.editFilesList || []),
    { multiline: true },
  );
  appendOutput(
    lines,
    'changed_files_list',
    compactJson(metrics.changedFilesList || []),
    { multiline: true },
  );
  appendOutput(lines, 'action_error', metrics.actionError || '', {
    multiline: true,
  });
  appendOutput(
    lines,
    'error_messages',
    compactJson(metrics.errorMessages || []),
    { multiline: true },
  );
  appendOutput(lines, 'last_output', metrics.lastOutput || '', {
    multiline: true,
  });
  appendOutput(lines, 'metrics_json', compactJson(metrics), {
    multiline: true,
  });

  const output = `${lines.join('\n')}\n`;
  if (outputPath) fs.appendFileSync(outputPath, output);
  else process.stdout.write(output);

  const summary = findings.length
    ? `Scanned Claude logs - ${findings.length} finding(s): ${findings
        .map((finding) => finding.category)
        .join(',')}`
    : 'Scanned Claude logs - no issues found.';
  console.log(summary);

  return { issueFile, output };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const executionText = readOptionalFile(args.executionFile);
  const logText = readOptionalFile(args.logFile);
  const changedFiles = readOptionalFile(args.changedFilesFile);
  const metrics = parseClaudeExecution({
    executionText,
    logText,
    changedFiles,
    maxTurns: args.maxTurns,
    attempt: args.attempt,
    outcome: args.outcome,
  });
  const scan = buildClaudeLogScan({
    metrics,
    logText,
    runId: args.runId,
    workflow: args.workflow,
    conclusion: args.outcome,
    attempt: args.attempt,
    maxTurns: args.maxTurns,
  });

  writeGithubOutputs({
    scan,
    outputPath: args.githubOutput || process.env.GITHUB_OUTPUT,
    issuesDir: args.issuesDir || os.tmpdir(),
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  buildClaudeLogScan,
  buildFindings,
  firstErrorFailureReason,
  writeGithubOutputs,
};
