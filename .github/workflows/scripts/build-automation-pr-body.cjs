#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { execFileSync } = require('child_process');
const fs = require('fs');

const REQUIRED_HEADINGS = [
  '## Problem / Trigger',
  '## Why Automation Changed This',
  '## What Changed',
  '## Evidence',
  '## Review Notes',
];

const MAX_FIELD_CHARS = 2200;
const MAX_EVIDENCE_CHARS = 3600;
const MAX_CHANGED_FILES = 30;

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? '';
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function redactSecrets(value) {
  return String(value || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/(Basic\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]+/g, '[REDACTED_GITHUB_PAT]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]')
    .replace(
      /((?:api[_-]?key|auth[_-]?token|access[_-]?token|github[_-]?token|password|secret)\s*[:=]\s*["']?)[^"'\s,}]+/gi,
      '$1[REDACTED]',
    );
}

function cleanText(value) {
  return redactSecrets(stripAnsi(value)).replace(/\r/g, '').trim();
}

function truncateText(value, limit = MAX_FIELD_CHARS) {
  const text = cleanText(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 35).trimEnd()}\n\n[truncated for PR body]`;
}

function parseJsonMaybe(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readOptionalFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
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

function parseJsonValues(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const parsed = parseJsonMaybe(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') return [parsed];

  const values = [];
  for (const line of raw.split('\n')) {
    const candidate = line.trim();
    if (!candidate.startsWith('{') && !candidate.startsWith('[')) continue;
    const value = parseJsonMaybe(candidate);
    if (Array.isArray(value)) values.push(...value);
    else if (value && typeof value === 'object') values.push(value);
  }
  return values;
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item.text === 'string') return item.text;
        if (item && typeof item.content === 'string') return item.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') return JSON.stringify(content);
  return '';
}

function extractResultText(value) {
  const parsed =
    typeof value === 'string' ? parseJsonMaybe(value) : (value ?? null);
  if (!parsed || typeof parsed !== 'object') {
    return typeof value === 'string' ? value : '';
  }

  for (const key of [
    'rationale',
    'why',
    'reason',
    'summary',
    'result',
    'notes',
    'text',
    'message',
  ]) {
    if (typeof parsed[key] === 'string' && parsed[key].trim()) {
      return parsed[key];
    }
  }

  return JSON.stringify(parsed);
}

function extractFinalResultFromExecutionText(executionText) {
  let finalResult = '';
  let finalAssistantText = '';

  for (const event of parseJsonValues(executionText)) {
    walk(event, (node) => {
      if (node.type === 'result' && typeof node.result === 'string') {
        finalResult = node.result;
      }
      if (node.role === 'assistant' && node.content) {
        const text = textFromContent(node.content);
        if (text.trim()) finalAssistantText = text;
      }
    });
  }

  return finalResult || finalAssistantText;
}

function normalizeChangedFilePath(value) {
  return cleanText(value)
    .replace(/^[-*]\s+/, '')
    .replace(/^`|`$/g, '')
    .trim();
}

function parseChangedFiles(value) {
  const parsed = parseJsonMaybe(value);
  let items = [];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed && typeof parsed === 'object') {
    items = parsed.changedFiles || parsed.files || parsed.paths || [];
  } else {
    items = String(value || '')
      .split(/[\n,]/)
      .map((item) => item.trim());
  }

  return [
    ...new Set(
      items
        .map((item) => {
          if (typeof item === 'string') return normalizeChangedFilePath(item);
          if (item && typeof item.path === 'string') return item.path.trim();
          return '';
        })
        .filter(Boolean),
    ),
  ].sort();
}

function collectChangedFilesFromGit(baseRef) {
  const candidates = [];
  if (baseRef) {
    candidates.push(['diff', '--name-only', `origin/${baseRef}...HEAD`]);
    candidates.push(['diff', '--name-only', `${baseRef}...HEAD`]);
  }
  candidates.push(['diff', '--name-only', 'HEAD~1..HEAD']);
  candidates.push(['diff', '--name-only', 'HEAD']);

  for (const args of candidates) {
    try {
      const output = execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const files = parseChangedFiles(output);
      if (files.length > 0) return files;
    } catch {
      // Try the next diff shape.
    }
  }

  return [];
}

function renderChangedFiles(files) {
  if (!files.length) return '- No changed files were detected by the builder.';

  const visible = files.slice(0, MAX_CHANGED_FILES);
  const lines = visible.map((filePath) => `- \`${filePath}\``);
  if (files.length > visible.length) {
    lines.push(`- ...and ${files.length - visible.length} more file(s)`);
  }
  return lines.join('\n');
}

function renderLinks(options) {
  const links = [];
  if (options.sourceRunUrl) links.push(`- Source run: ${options.sourceRunUrl}`);
  if (options.sourcePrUrl) links.push(`- Source PR: ${options.sourcePrUrl}`);
  if (options.sourceIssueUrl) {
    links.push(`- Source issue: ${options.sourceIssueUrl}`);
  }
  return links.join('\n');
}

function parseIssueNumbers(value) {
  const issues = String(value || '')
    .split(/[\n,]/)
    .map((item) => item.trim().replace(/^#/, ''))
    .filter(Boolean)
    .filter((item) => /^\d+$/.test(item));
  return [...new Set(issues)];
}

function renderClosingIssues(value) {
  return parseIssueNumbers(value)
    .map((issue) => `Closes #${issue}`)
    .join('\n');
}

// Non-closing reference for umbrella/tracking issues: a partial fix must
// reference its umbrella without a closing keyword, or merging would close
// the entire backlog.
function renderRelatedIssues(value) {
  return parseIssueNumbers(value)
    .map((issue) => `Part of #${issue} (umbrella/tracking issue — stays open)`)
    .join('\n');
}

function sectionFallback(value, fallback) {
  const text = truncateText(value);
  return text || fallback;
}

function buildAutomationPrBody(options = {}) {
  const structured = parseJsonMaybe(options.structuredOutput) || {};
  const hasStructuredOutput = Object.keys(structured).length > 0;
  const executionText = readOptionalFile(options.executionFile);
  const executionResult = extractFinalResultFromExecutionText(executionText);
  const structuredRationale = hasStructuredOutput
    ? extractResultText(structured.rationale || structured.why || structured)
    : '';
  const DEFAULT_RATIONALE =
    'Automation produced changes, but no model rationale was captured.';
  const hasRationaleSource =
    options.rationale ||
    structuredRationale ||
    executionResult ||
    options.claudeLastOutput;
  const rationale = hasRationaleSource
    ? sectionFallback(
        hasRationaleSource,
        DEFAULT_RATIONALE,
      )
    : options.evidence
      ? 'No structured rationale captured — see Evidence section for audit details.'
      : DEFAULT_RATIONALE;

  const changedFiles =
    parseChangedFiles(options.changedFiles).length > 0
      ? parseChangedFiles(options.changedFiles)
      : collectChangedFilesFromGit(options.baseRef);

  const links = renderLinks(options);
  const evidenceParts = [
    links,
    options.evidence,
    options.failedJobs ? `Failed jobs:\n${options.failedJobs}` : '',
    options.errorLogs ? `Error log excerpts:\n${options.errorLogs}` : '',
    options.affectedFiles ? `Affected files:\n${options.affectedFiles}` : '',
  ]
    .map((part) => truncateText(part, MAX_EVIDENCE_CHARS))
    .filter(Boolean);

  const closingIssues = renderClosingIssues(options.closingIssues);
  const relatedIssues = renderRelatedIssues(options.relatedIssues);
  const reviewNotes = [options.reviewNotes, closingIssues, relatedIssues]
    .map((part) => truncateText(part))
    .filter(Boolean)
    .join('\n\n');

  const workflowName = cleanText(options.workflowName || 'automation');
  const footer =
    options.footer ||
    `Auto-generated by the \`${workflowName}\` workflow. Review the evidence and rationale before merging.`;

  return [
    '## Problem / Trigger',
    sectionFallback(
      options.problem || options.trigger || structured.problem,
      'Automation was triggered by a repository workflow event.',
    ),
    '',
    '## Why Automation Changed This',
    rationale,
    '',
    '## What Changed',
    [
      truncateText(options.changes || structured.changes || ''),
      renderChangedFiles(changedFiles),
    ]
      .filter(Boolean)
      .join('\n\n'),
    '',
    '## Evidence',
    evidenceParts.length
      ? evidenceParts.join('\n\n')
      : '- No additional evidence was provided.',
    '',
    '## Review Notes',
    reviewNotes || 'Manual review is required for automation-authored changes.',
    '',
    '---',
    `*${truncateText(footer, 500)}*`,
  ].join('\n');
}

function validateRichBody(body) {
  const text = String(body || '');
  const missing = REQUIRED_HEADINGS.filter(
    (heading) => !text.includes(heading),
  );
  if (missing.length > 0) {
    throw new Error(
      `PR body is missing required section(s): ${missing.join(', ')}`,
    );
  }
  if (!/Auto-generated by/i.test(text)) {
    throw new Error('PR body is missing automation footer.');
  }
  return true;
}

function appendOutput(outputPath, key, value) {
  const delimiter = `EOF-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.appendFileSync(
    outputPath,
    `${key}<<${delimiter}\n${value}\n${delimiter}\n`,
  );
}

function optionsFromEnv(env = process.env) {
  return {
    affectedFiles: env.AFFECTED_FILES,
    baseRef: env.BASE_REF,
    changedFiles: env.CHANGED_FILES,
    changes: env.CHANGES,
    claudeLastOutput: env.CLAUDE_LAST_OUTPUT,
    closingIssues: env.CLOSING_ISSUES,
    errorLogs: env.ERROR_LOGS,
    evidence: env.EVIDENCE,
    executionFile: env.EXECUTION_FILE,
    failedJobs: env.FAILED_JOBS,
    footer: env.FOOTER,
    problem: env.PROBLEM,
    rationale: env.RATIONALE,
    relatedIssues: env.RELATED_ISSUES,
    reviewNotes: env.REVIEW_NOTES,
    sourceIssueUrl: env.SOURCE_ISSUE_URL,
    sourcePrUrl: env.SOURCE_PR_URL,
    sourceRunUrl: env.SOURCE_RUN_URL,
    structuredOutput: env.STRUCTURED_OUTPUT,
    trigger: env.TRIGGER,
    workflowName: env.WORKFLOW_NAME,
  };
}

function runCli() {
  if (process.argv.includes('--validate-rich-body')) {
    try {
      validateRichBody(process.env.PR_BODY || '');
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    return;
  }

  const body = buildAutomationPrBody(optionsFromEnv());
  validateRichBody(body);

  const bodyFile = getArg('--body-file');
  if (bodyFile) {
    fs.writeFileSync(bodyFile, `${body}\n`);
    return;
  }

  const outputPath = getArg('--github-output') || process.env.GITHUB_OUTPUT;
  if (outputPath) appendOutput(outputPath, 'body', body);
  else process.stdout.write(`${body}\n`);
}

module.exports = {
  REQUIRED_HEADINGS,
  buildAutomationPrBody,
  cleanText,
  extractFinalResultFromExecutionText,
  parseChangedFiles,
  redactSecrets,
  renderClosingIssues,
  renderRelatedIssues,
  truncateText,
  validateRichBody,
};

if (require.main === module) {
  runCli();
}
