#!/usr/bin/env node

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    const parsed = parseJson(value, null);
    if (Array.isArray(parsed)) return parsed;
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

function asObject(value) {
  const parsed = parseJson(value, null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed
    : {};
}

function isBlankMetricValue(value) {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function mergeClaudeMetrics(primary, fallback) {
  const merged = { ...asObject(fallback), ...asObject(primary) };
  const fallbackMetrics = asObject(fallback);
  for (const [key, value] of Object.entries(fallbackMetrics)) {
    if (isBlankMetricValue(merged[key]) && !isBlankMetricValue(value)) {
      merged[key] = value;
    }
  }
  return merged;
}

function valueOrFallback(value, fallback = 'N/A') {
  return value === null || value === undefined || value === ''
    ? fallback
    : String(value);
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

function formatSampleText(value, fallback = 'N/A') {
  const text = redactSecrets(valueOrFallback(value, fallback))
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= 240) return text;
  return `${text.slice(0, 237)}...`;
}

function formatDuration(metrics) {
  if (
    metrics.durationSec !== null &&
    metrics.durationSec !== undefined &&
    metrics.durationSec !== ''
  ) {
    return `${metrics.durationSec}s`;
  }
  if (
    metrics.durationMs !== null &&
    metrics.durationMs !== undefined &&
    metrics.durationMs !== ''
  ) {
    return `${Math.round(Number(metrics.durationMs) / 100) / 10}s`;
  }
  return 'N/A';
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === '') return 'N/A';
  const number = Number(value);
  if (!Number.isFinite(number)) return valueOrFallback(value);
  return `$${number.toFixed(4)}`;
}

function formatRate(value) {
  if (value === null || value === undefined || value === '') return 'N/A';
  const number = Number(value);
  if (!Number.isFinite(number)) return valueOrFallback(value);
  return `${number}%`;
}

function formatToolBreakdown(value) {
  const breakdown = asObject(value);
  const entries = Object.entries(breakdown).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) return '_none_';
  return entries.map(([name, count]) => `${name}: ${count}`).join(', ');
}

function codeBlock(value) {
  const text = valueOrFallback(value, '(none)');
  return ['```', text.replace(/```/g, "'''"), '```'].join('\n');
}

function formatFailedToolSamples(value) {
  const samples = asArray(value);
  if (samples.length === 0) return '';

  return samples
    .slice(0, 5)
    .map((sample) => {
      if (!sample || typeof sample !== 'object') {
        return `- ${formatSampleText(sample)}`;
      }

      const target = formatSampleText(
        sample.command || sample.filePath || '',
        '',
      );
      const targetText = target ? `: ${target}` : '';
      const error = sample.error
        ? `\n  Error: ${formatSampleText(sample.error)}`
        : '';
      return `- ${formatSampleText(sample.tool, 'unknown')} (${formatSampleText(sample.category, 'unknown')})${targetText}${error}`;
    })
    .join('\n');
}

function escapeTable(value) {
  return valueOrFallback(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function normalizeMetrics(input = {}) {
  const metricsJson = asObject(
    input.claudeMetricsJson || input.metricsJson || input.metrics_json,
  );
  const merged = { ...metricsJson, ...input };
  return {
    outcome: merged.claudeStepOutcome || merged.outcome,
    attempt: merged.claudeUsedAttempt || merged.usedAttempt || merged.attempt,
    modelUsed: merged.claudeModelUsed || merged.modelUsed,
    numTurns: merged.claudeTurns || merged.claudeNumTurns || merged.numTurns,
    maxTurns: merged.maxTurns,
    turnsBudgetPct: merged.claudeTurnsBudgetPct || merged.turnsBudgetPct,
    durationMs: merged.claudeDurationMs || merged.durationMs,
    durationSec: merged.claudeDurationSec || merged.durationSec,
    totalCostUsd: merged.claudeTotalCostUsd || merged.totalCostUsd,
    costPerTurn: merged.claudeCostPerTurn || merged.costPerTurn,
    durationPerTurnMs:
      merged.claudeDurationPerTurnMs || merged.durationPerTurnMs,
    numToolCalls: merged.claudeNumToolCalls || merged.numToolCalls,
    toolBreakdown: merged.claudeToolBreakdown || merged.toolBreakdown,
    readFilesCount: merged.claudeReadFilesCount || merged.readFilesCount,
    editFilesCount: merged.claudeEditFilesCount || merged.editFilesCount,
    numFailedToolCalls:
      merged.claudeNumFailedToolCalls || merged.numFailedToolCalls,
    changedFilesCount:
      merged.claudeChangedFilesCount || merged.changedFilesCount,
    numRejectedToolCalls:
      merged.claudeNumRejectedToolCalls || merged.numRejectedToolCalls,
    denialRate: merged.claudeDenialRate || merged.denialRate,
    isError: merged.claudeIsError || merged.isError,
    failureReason: merged.claudeFailureReason || merged.failureReason,
    actionError: merged.claudeActionError || merged.actionError,
    errorMessages: merged.claudeErrorMessages || merged.errorMessages,
    lastOutput: merged.claudeLastOutput || merged.lastOutput,
    failedToolSamples:
      merged.claudeFailedToolSamples || merged.failedToolSamples,
    changedFilesList: merged.claudeChangedFilesList || merged.changedFilesList,
    rejectedToolsList:
      merged.claudeRejectedToolsList || merged.rejectedToolsList,
    readFilesList: merged.claudeReadFilesList || merged.readFilesList,
    editFilesList: merged.claudeEditFilesList || merged.editFilesList,
  };
}

function hasClaudeInfo(metrics) {
  return [
    metrics.outcome,
    metrics.attempt,
    metrics.modelUsed,
    metrics.numTurns,
    metrics.isError,
    metrics.failureReason,
    metrics.actionError,
    metrics.errorMessages,
    metrics.lastOutput,
    metrics.failedToolSamples,
  ].some((value) => value !== null && value !== undefined && value !== '');
}

function renderClaudeExecutionSection(input = {}, options = {}) {
  const metrics = normalizeMetrics(input);
  if (!hasClaudeInfo(metrics)) return '';

  const heading = options.heading || '### Claude Execution';

  // A cancelled run never reaches the step that publishes claude-* outputs,
  // so turn/cost/tool metrics are usually blank. Surface a clear marker
  // instead of a table full of N/A; if metrics were recovered anyway (e.g.
  // parsed from logs), still render them under the notice.
  let cancelledNotice = '';
  if (metrics.outcome === 'cancelled') {
    const CANCELLED_MARKER =
      '_Cancelled before metrics were captured — the run was likely stopped by its `timeout-minutes` cap, so Claude turn/cost/tool metrics are unavailable._';
    const hasRealMetrics = [
      metrics.numTurns,
      metrics.modelUsed,
      metrics.durationMs,
      metrics.durationSec,
      metrics.totalCostUsd,
      metrics.numToolCalls,
      metrics.failureReason,
      metrics.actionError,
      metrics.errorMessages,
      metrics.lastOutput,
      metrics.failedToolSamples,
    ].some((value) => !isBlankMetricValue(value));
    if (!hasRealMetrics) {
      return `${['', heading, '', CANCELLED_MARKER].join('\n')}\n`;
    }
    cancelledNotice =
      '_Cancelled before completion; metrics below were recovered from logs._';
  }

  const turns = valueOrFallback(metrics.numTurns);
  const turnsPct = metrics.turnsBudgetPct
    ? ` (${metrics.turnsBudgetPct}%)`
    : '';
  const attempt = metrics.attempt ? `${metrics.attempt}/3` : 'N/A';
  const rows = [
    ['Outcome', valueOrFallback(metrics.outcome)],
    ['Attempt', attempt],
    ['Model', valueOrFallback(metrics.modelUsed)],
    ['Turns', `${turns}${turnsPct}`],
    ['Duration', formatDuration(metrics)],
    ['Cost', formatCurrency(metrics.totalCostUsd)],
    ['Cost/turn', formatCurrency(metrics.costPerTurn)],
    ['Tool calls', valueOrFallback(metrics.numToolCalls, '0')],
    ['Tool breakdown', formatToolBreakdown(metrics.toolBreakdown)],
    ['Read files', valueOrFallback(metrics.readFilesCount, '0')],
    ['Edit files', valueOrFallback(metrics.editFilesCount, '0')],
    ['Failed tool calls', valueOrFallback(metrics.numFailedToolCalls, '0')],
    ['Files changed', valueOrFallback(metrics.changedFilesCount, '0')],
    ['Rejections', valueOrFallback(metrics.numRejectedToolCalls, '0')],
    ['Denial rate', formatRate(metrics.denialRate)],
    ['Claude is_error', valueOrFallback(metrics.isError)],
  ];

  const lines = ['', heading];
  if (cancelledNotice) {
    lines.push('', cancelledNotice);
  }
  lines.push(
    '| Metric | Value |',
    '|--------|-------|',
    ...rows.map(([metric, value]) => `| ${metric} | ${escapeTable(value)} |`),
  );

  const primaryError = metrics.actionError || metrics.failureReason;
  if (primaryError) {
    lines.push(
      '',
      `**Error:** \`${valueOrFallback(primaryError).replace(/`/g, "'")}\``,
    );
  }

  const errors = asArray(metrics.errorMessages).filter(
    (message) => message && message !== primaryError,
  );
  if (errors.length > 0) {
    lines.push(
      '',
      '**Error messages:**',
      ...errors
        .slice(0, 5)
        .map((message) => `- \`${String(message).replace(/`/g, "'")}\``),
    );
  }

  const rejectedTools = asArray(metrics.rejectedToolsList);
  if (rejectedTools.length > 0) {
    lines.push(
      '',
      '<details><summary>Rejected tools</summary>',
      '',
      codeBlock(rejectedTools.join('\n')),
      '',
      '</details>',
    );
  }

  const failedToolSamples = formatFailedToolSamples(metrics.failedToolSamples);
  if (failedToolSamples) {
    lines.push(
      '',
      '<details><summary>Failed tool samples</summary>',
      '',
      codeBlock(failedToolSamples),
      '',
      '</details>',
    );
  }

  const changedFiles = asArray(metrics.changedFilesList);
  if (changedFiles.length > 0) {
    lines.push(
      '',
      '<details><summary>Changed files</summary>',
      '',
      codeBlock(changedFiles.join('\n')),
      '',
      '</details>',
    );
  }

  if (metrics.lastOutput) {
    lines.push(
      '',
      '<details><summary>Last Claude SDK output</summary>',
      '',
      codeBlock(metrics.lastOutput),
      '',
      '</details>',
    );
  }

  return `${lines.join('\n')}\n`;
}

if (require.main === module) {
  const input = process.argv[2] ? JSON.parse(process.argv[2]) : {};
  process.stdout.write(renderClaudeExecutionSection(input));
}

module.exports = {
  mergeClaudeMetrics,
  normalizeMetrics,
  renderClaudeExecutionSection,
};
