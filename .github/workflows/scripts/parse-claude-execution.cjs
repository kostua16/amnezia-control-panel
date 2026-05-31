#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('fs');

const MAX_LAST_OUTPUT_BYTES = 6000;
const MAX_LAST_OUTPUT_LINES = 80;

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function stripGitHubLogPrefix(line) {
  return line
    .replace(/^[^\t\r\n]+\t[^\t\r\n]+\t/, '')
    .replace(/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z\s+/, '');
}

function redactSecrets(value) {
  return String(value || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/(Basic\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(
      /((?:api[_-]?key|auth[_-]?token|access[_-]?token|github[_-]?token|password|secret)\s*[:=]\s*["']?)[^"'\s,}]+/gi,
      '$1[REDACTED]',
    );
}

function sanitizeText(value) {
  return redactSecrets(stripAnsi(value)).replace(/\r/g, '');
}

function parseJsonValues(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const nested = [];
      for (const key of ['events', 'messages', 'logs']) {
        if (Array.isArray(parsed[key])) nested.push(...parsed[key]);
      }
      return nested.length > 0 ? [parsed, ...nested] : [parsed];
    }
  } catch {
    // Fall through to JSONL parsing.
  }

  const values = [];
  for (const line of trimmed.split('\n')) {
    const candidate = line.trim();
    if (!candidate.startsWith('{') && !candidate.startsWith('[')) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) values.push(...parsed);
      else values.push(parsed);
    } catch {
      // Ignore non-JSON log lines.
    }
  }
  return values;
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

function percent(numerator, denominator) {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  )
    return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function addToolCall(metrics, name, input = {}) {
  if (!name) return;
  metrics.numToolCalls += 1;
  metrics.toolBreakdown[name] = (metrics.toolBreakdown[name] || 0) + 1;

  const filePath = input.file_path || input.path || input.notebook_path;
  if (name === 'Read' && filePath) metrics.readFiles.add(filePath);
  if (['Edit', 'Write', 'MultiEdit'].includes(name) && filePath)
    metrics.editFiles.add(filePath);
}

function parseEvents(executionText) {
  const events = parseJsonValues(executionText);
  const metrics = {
    durationMs: null,
    totalCostUsd: null,
    numTurns: null,
    isError: null,
    permissionDenialsCount: 0,
    modelUsed: '',
    numToolCalls: 0,
    toolBreakdown: {},
    numFailedToolCalls: 0,
    readFiles: new Set(),
    editFiles: new Set(),
  };

  for (const event of events) {
    walk(event, (node) => {
      if (!metrics.modelUsed && typeof node.model === 'string') {
        metrics.modelUsed = node.model;
      }

      if (
        node.type === 'result' ||
        node.num_turns !== undefined ||
        node.duration_ms !== undefined
      ) {
        metrics.durationMs = asNumber(node.duration_ms, metrics.durationMs);
        metrics.totalCostUsd = asNumber(
          node.total_cost_usd,
          metrics.totalCostUsd,
        );
        metrics.numTurns = asNumber(node.num_turns, metrics.numTurns);
        metrics.permissionDenialsCount = asNumber(
          node.permission_denials_count,
          metrics.permissionDenialsCount,
        );
        const parsedError = asBoolean(node.is_error);
        if (parsedError !== null) metrics.isError = parsedError;
      }

      if (node.type === 'tool_use') {
        addToolCall(metrics, node.name || node.tool_name, node.input || {});
      } else if (typeof node.tool_name === 'string') {
        addToolCall(metrics, node.tool_name, node.input || {});
      }

      if (
        node.type === 'tool_result' &&
        (node.is_error === true ||
          node.isError === true ||
          /(^|\b)error\b/i.test(String(node.content || '')))
      ) {
        metrics.numFailedToolCalls += 1;
      }
    });
  }

  return metrics;
}

function emptyToolMetrics() {
  return {
    numToolCalls: 0,
    toolBreakdown: {},
    numFailedToolCalls: 0,
    readFiles: new Set(),
    editFiles: new Set(),
  };
}

function parseLogToolMetrics(logText) {
  const metrics = emptyToolMetrics();
  const lines = String(logText || '')
    .split('\n')
    .map((line) => stripGitHubLogPrefix(sanitizeText(line)));
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      /"type"\s*:\s*"tool_use"/.test(line) ||
      /"tool_name"\s*:\s*"[^"]+"/.test(line)
    ) {
      const block = lines.slice(index, index + 40).join('\n');
      const name = block.match(/"(?:name|tool_name)"\s*:\s*"([^"]+)"/)?.[1];
      const filePath = block.match(
        /"(?:file_path|path|notebook_path)"\s*:\s*"([^"]+)"/,
      )?.[1];
      addToolCall(metrics, name, filePath ? { file_path: filePath } : {});
    }
    if (/"type"\s*:\s*"tool_result"/.test(line)) {
      const block = lines.slice(index, index + 20).join('\n');
      if (/"is_error"\s*:\s*true/.test(block) || /\bError:/.test(block)) {
        metrics.numFailedToolCalls += 1;
      }
    }
  }
  return metrics;
}

function extractRejectedTools(logText) {
  const rejected = new Set();
  for (const rawLine of String(logText || '').split('\n')) {
    const line = stripGitHubLogPrefix(sanitizeText(rawLine));
    const match = line.match(/DISALLOWED_TOOLS:\s*(.+)$/);
    if (!match) continue;
    for (const item of match[1].split(/[,;]/)) {
      const value = item.trim();
      if (/^\$[{A-Za-z_]/.test(value)) continue;
      if (value) rejected.add(value);
    }
  }
  return [...rejected].sort();
}

function extractJsonFieldFromLog(logText, field) {
  const pattern = new RegExp(
    `"${field}"\\s*:\\s*("[^"]*"|-?[0-9]+(?:\\.[0-9]+)?|true|false|null)`,
  );
  for (const rawLine of String(logText || '').split('\n')) {
    const line = stripGitHubLogPrefix(sanitizeText(rawLine));
    const match = line.match(pattern);
    if (!match) continue;
    try {
      return JSON.parse(match[1]);
    } catch {
      return match[1].replace(/^"|"$/g, '');
    }
  }
  return null;
}

function extractErrorMessages(logText) {
  const messages = [];
  const seen = new Set();
  for (const rawLine of String(logText || '').split('\n')) {
    const line = stripGitHubLogPrefix(sanitizeText(rawLine)).trim();
    const errorMatch = line.match(/##\[error\](.+)$/);
    const actionMatch = line.match(/Action failed with error:\s*(.+)$/);
    const value = (
      actionMatch
        ? `Action failed with error: ${actionMatch[1]}`
        : errorMatch?.[1] || ''
    ).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    messages.push(value.slice(0, 500));
    if (messages.length >= 8) break;
  }
  return messages;
}

function extractActionError(logText, errorMessages) {
  for (const message of errorMessages) {
    if (message.startsWith('Action failed with error:')) return message;
  }
  for (const rawLine of String(logText || '').split('\n')) {
    const line = stripGitHubLogPrefix(sanitizeText(rawLine));
    const match = line.match(/Action failed with error:\s*(.+)$/);
    if (match)
      return `Action failed with error: ${match[1].trim()}`.slice(0, 500);
  }
  return '';
}

function extractLastOutput(logText) {
  const rawLines = String(logText || '')
    .split('\n')
    .map((line) => stripGitHubLogPrefix(sanitizeText(line)));
  const start = rawLines.findIndex((line) =>
    line.includes('Running Claude Code via SDK'),
  );
  const scoped = start >= 0 ? rawLines.slice(start) : rawLines;
  const relevant = scoped.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return (
      trimmed.includes('Running Claude Code via SDK') ||
      trimmed.includes('Rerun in debug mode') ||
      trimmed.includes('Log saved to ') ||
      trimmed.includes('Action failed with error:') ||
      trimmed.includes('DISALLOWED_TOOLS:') ||
      trimmed.includes('##[error]') ||
      (/^["{}[\],:\sA-Za-z0-9._-]+$/.test(trimmed) &&
        /"(type|subtype|model|is_error|duration_ms|num_turns|total_cost_usd|permission_denials_count)"\s*:/.test(
          trimmed,
        ))
    );
  });

  const tail = relevant.slice(-MAX_LAST_OUTPUT_LINES);
  let output = tail.join('\n').trim();
  if (Buffer.byteLength(output, 'utf8') > MAX_LAST_OUTPUT_BYTES) {
    const buffer = Buffer.from(output, 'utf8');
    output = buffer
      .subarray(buffer.length - MAX_LAST_OUTPUT_BYTES)
      .toString('utf8');
    const firstNewline = output.indexOf('\n');
    if (firstNewline >= 0) output = output.slice(firstNewline + 1);
  }
  return output;
}

function parseChangedFiles(value) {
  return [
    ...new Set(
      String(value || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function parseClaudeExecution(options = {}) {
  const executionText = options.executionText || '';
  const logText = options.logText || '';
  const eventMetrics = parseEvents(executionText);
  const logToolMetrics = parseLogToolMetrics(logText);
  const rejectedToolsList = extractRejectedTools(logText);
  const errorMessages = extractErrorMessages(logText);
  const actionError = extractActionError(logText, errorMessages);
  const changedFilesList = parseChangedFiles(options.changedFiles || '');
  const maxTurns = asNumber(options.maxTurns, null);
  const numTurns =
    eventMetrics.numTurns ??
    asNumber(extractJsonFieldFromLog(logText, 'num_turns'), null);
  const durationMs =
    eventMetrics.durationMs ??
    asNumber(extractJsonFieldFromLog(logText, 'duration_ms'), null);
  const totalCostUsd =
    eventMetrics.totalCostUsd ??
    asNumber(extractJsonFieldFromLog(logText, 'total_cost_usd'), null);
  const isError =
    eventMetrics.isError ??
    asBoolean(extractJsonFieldFromLog(logText, 'is_error'));
  const permissionDenialsCount =
    eventMetrics.permissionDenialsCount ||
    asNumber(extractJsonFieldFromLog(logText, 'permission_denials_count'), 0);
  const modelUsed =
    eventMetrics.modelUsed || extractJsonFieldFromLog(logText, 'model') || '';
  const numRejectedToolCalls =
    permissionDenialsCount || rejectedToolsList.length;
  const numToolCalls = eventMetrics.numToolCalls || logToolMetrics.numToolCalls;
  const toolBreakdown =
    eventMetrics.numToolCalls > 0
      ? eventMetrics.toolBreakdown
      : logToolMetrics.toolBreakdown;
  const numFailedToolCalls =
    eventMetrics.numFailedToolCalls || logToolMetrics.numFailedToolCalls;
  const readFiles = new Set([
    ...eventMetrics.readFiles,
    ...logToolMetrics.readFiles,
  ]);
  const editFiles = new Set([
    ...eventMetrics.editFiles,
    ...logToolMetrics.editFiles,
  ]);

  return {
    attempt: asNumber(options.attempt, null),
    outcome: options.outcome || '',
    maxTurns,
    durationMs,
    durationSec: Number.isFinite(durationMs)
      ? Math.round((durationMs / 1000) * 10) / 10
      : null,
    totalCostUsd,
    modelUsed,
    numTurns,
    isError,
    turnsBudgetPct: percent(numTurns, maxTurns),
    costPerTurn:
      percent(totalCostUsd, numTurns) === null
        ? null
        : Math.round((totalCostUsd / numTurns) * 10000) / 10000,
    durationPerTurnMs:
      Number.isFinite(durationMs) && Number.isFinite(numTurns) && numTurns > 0
        ? Math.round(durationMs / numTurns)
        : null,
    numToolCalls,
    toolBreakdown,
    numFailedToolCalls,
    numRejectedToolCalls,
    rejectedToolsList,
    denialRate: percent(numRejectedToolCalls, numToolCalls),
    readFilesCount: readFiles.size,
    readFilesList: [...readFiles].sort(),
    editFilesCount: editFiles.size,
    editFilesList: [...editFiles].sort(),
    changedFilesCount: changedFilesList.length,
    changedFilesList,
    actionError,
    errorMessages,
    lastOutput: extractLastOutput(logText),
  };
}

function readOptionalFile(path) {
  if (!path || !fs.existsSync(path)) return '';
  return fs.readFileSync(path, 'utf8');
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const metrics = parseClaudeExecution({
    executionText: readOptionalFile(args.executionFile),
    logText: readOptionalFile(args.logFile),
    changedFiles: readOptionalFile(args.changedFilesFile),
    maxTurns: args.maxTurns,
    attempt: args.attempt,
    outcome: args.outcome,
  });
  const json = JSON.stringify(metrics);
  if (args.metricsFile) fs.writeFileSync(args.metricsFile, `${json}\n`);
  else process.stdout.write(`${json}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseClaudeExecution,
  parseJsonValues,
  redactSecrets,
  stripAnsi,
};
