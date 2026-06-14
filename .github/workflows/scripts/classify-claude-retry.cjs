#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('fs');
const { parseJsonValues } = require('./parse-claude-execution.cjs');

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

function asBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  for (const item of Object.values(value)) {
    if (item && typeof item === 'object') walk(item, visit);
  }
}

function hasSuccessfulResult(executionText) {
  for (const value of parseJsonValues(executionText)) {
    let found = false;
    walk(value, (node) => {
      if (found || node.type !== 'result') return;
      found = asBoolean(node.is_error) !== true;
    });
    if (found) return true;
  }
  return false;
}

// Detects whether the execution output carries any result node at all
// (success or error). An empty execution file — no turns, no result — means
// the action step died before producing any diagnostic output.
function hasAnyResultNode(executionText) {
  for (const value of parseJsonValues(executionText)) {
    let found = false;
    walk(value, (node) => {
      if (found || node.type !== 'result') return;
      found = true;
    });
    if (found) return true;
  }
  return false;
}

function isRateLimitOrOverloadText(value) {
  const text = String(value || '');
  return (
    /API Error:\s*529(?:\D|$)/i.test(text) ||
    /(?:service\s+)?temporarily overloaded/i.test(text) ||
    /service overloaded/i.test(text)
  );
}

function classifyClaudeRetry({
  httpCode = '',
  executionText = '',
  logText = '',
  jsonSchemaEnabled = false,
  attempt = '',
} = {}) {
  const normalizedHttpCode = String(httpCode || '').trim();
  const normalizedAttempt = String(attempt || '').trim();
  const finalRetry = normalizedAttempt === '2';
  const retrySuffix = finalRetry
    ? 'Final retry after 2 min wait.'
    : 'Will retry after 2 min wait.';

  if (
    normalizedHttpCode === '429' ||
    normalizedHttpCode === '529' ||
    isRateLimitOrOverloadText(`${executionText}\n${logText}`)
  ) {
    let detail = 'execution output contains ZAI 529/overload evidence';
    if (normalizedHttpCode === '429') detail = 'API returned HTTP 429';
    if (normalizedHttpCode === '529') detail = 'API returned HTTP 529';
    return {
      httpCode: normalizedHttpCode,
      isRateLimited: true,
      shouldRetry: true,
      retryReason: 'rate_limited',
      softSuccess: false,
      softSuccessReason: '',
      annotation: 'warning',
      message: `Attempt ${normalizedAttempt} failed and ${detail}. ${retrySuffix}`,
    };
  }

  if (
    asBoolean(jsonSchemaEnabled) === true &&
    hasSuccessfulResult(executionText)
  ) {
    return {
      httpCode: normalizedHttpCode,
      isRateLimited: false,
      shouldRetry: true,
      retryReason: 'missing_structured_output',
      softSuccess: false,
      softSuccessReason: '',
      annotation: 'warning',
      message: finalRetry
        ? `Attempt ${normalizedAttempt} produced a successful execution result but no structured output. Retrying final attempt because --json-schema was requested.`
        : `Attempt ${normalizedAttempt} produced a successful execution result but no structured output. Retrying once because --json-schema was requested.`,
    };
  }

  if (normalizedHttpCode === '200' && hasSuccessfulResult(executionText)) {
    return {
      httpCode: normalizedHttpCode,
      isRateLimited: false,
      shouldRetry: false,
      retryReason: 'successful_result_after_action_probe',
      softSuccess: true,
      softSuccessReason:
        'Claude completed successfully, but the action API probe returned HTTP 200',
      annotation: 'warning',
      message: `Attempt ${normalizedAttempt} produced a successful execution result, but the action API probe returned HTTP 200. Treating as soft success.`,
    };
  }

  // Abortive failure: the action step failed but captured no execution result
  // (no turns, no error) while the API probe is healthy. That empty-output +
  // healthy-probe signature is a transient/abortive failure — a brief overload
  // or network blip that cleared before the probe ran a few seconds later —
  // not a real code or prompt error (those leave a result or action_error).
  // Retry once instead of giving up; bounded by the existing 3-attempt cap.
  if (normalizedHttpCode === '200' && !hasAnyResultNode(executionText)) {
    return {
      httpCode: normalizedHttpCode,
      isRateLimited: false,
      shouldRetry: true,
      retryReason: 'abortive_no_output',
      softSuccess: false,
      softSuccessReason: '',
      annotation: 'warning',
      message: finalRetry
        ? `Attempt ${normalizedAttempt} failed with no execution output despite a healthy API probe (HTTP 200). Retrying final attempt — likely transient.`
        : `Attempt ${normalizedAttempt} failed with no execution output despite a healthy API probe (HTTP 200). Retrying once — likely transient.`,
    };
  }

  return {
    httpCode: normalizedHttpCode,
    isRateLimited: false,
    shouldRetry: false,
    retryReason: 'non_retryable',
    softSuccess: false,
    softSuccessReason: '',
    annotation: 'error',
    message: finalRetry
      ? `Attempt ${normalizedAttempt} failed with non-retryable error (API probe returned HTTP ${normalizedHttpCode}). Skipping final retry.`
      : `Attempt ${normalizedAttempt} failed with non-retryable error (API probe returned HTTP ${normalizedHttpCode}). Skipping retries.`,
  };
}

function writeGithubOutputs(result, outputPath) {
  const lines = [
    `http_code=${result.httpCode}`,
    `is_rate_limited=${result.isRateLimited ? 'true' : 'false'}`,
    `should_retry=${result.shouldRetry ? 'true' : 'false'}`,
    `retry_reason=${result.retryReason}`,
    `soft_success=${result.softSuccess ? 'true' : 'false'}`,
    `soft_success_reason=${result.softSuccessReason || ''}`,
  ];
  const output = `${lines.join('\n')}\n`;
  if (outputPath) fs.appendFileSync(outputPath, output);
  else process.stdout.write(output);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = classifyClaudeRetry({
    httpCode: args.httpCode,
    executionText: readOptionalFile(args.executionFile),
    logText: readOptionalFile(args.logFile),
    jsonSchemaEnabled: args.jsonSchemaEnabled,
    attempt: args.attempt,
  });

  console.log(`::${result.annotation}::${result.message}`);
  writeGithubOutputs(result, args.githubOutput || process.env.GITHUB_OUTPUT);
}

if (require.main === module) {
  main();
}

module.exports = {
  classifyClaudeRetry,
  hasSuccessfulResult,
  hasAnyResultNode,
  isRateLimitOrOverloadText,
};
