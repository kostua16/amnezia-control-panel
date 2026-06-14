#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_LABELS = ['auto-fix', 'needs-review', 'audit-manual-finding'];
const MARKER_PREFIX = 'audit-manual-finding';
const MAX_TITLE_LENGTH = 120;

function parseJsonMaybe(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cleanText(value) {
  return String(value || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\r/g, '')
    .trim();
}

function stripMarkdown(value) {
  return cleanText(value)
    .replace(/^\s*[-*]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}

function parseList(value) {
  if (Array.isArray(value))
    return value.map(String).map(cleanText).filter(Boolean);
  const parsed = parseJsonMaybe(value);
  if (Array.isArray(parsed))
    return parsed.map(String).map(cleanText).filter(Boolean);
  return String(value || '')
    .split(/[\n,]/)
    .map(cleanText)
    .filter(Boolean);
}

function firstString(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
}

function normalizeSeverity(value) {
  const severity = cleanText(value).toLowerCase();
  if (!severity) return 'unspecified';
  if (['critical', 'high', 'medium', 'low', 'info'].includes(severity)) {
    return severity;
  }
  return severity;
}

function normalizeFinding(raw = {}, index = 0) {
  const findingId = firstString(
    raw.finding_id,
    raw.findingId,
    raw.id,
    raw.number,
    raw.key,
    `M-${index + 1}`,
  );
  const severity = normalizeSeverity(raw.severity || raw.priority || raw.level);
  const summary = firstString(
    raw.summary,
    raw.title,
    raw.finding,
    raw.problem,
    raw.name,
  );
  const details = firstString(
    raw.details,
    raw.description,
    raw.reason,
    raw.rationale,
    raw.notes,
    summary,
  );
  const files = parseList(
    raw.files || raw.paths || raw.changed_files || raw.file,
  );

  if (!summary && !details) return null;

  return {
    findingId,
    severity,
    summary: summary || details,
    details,
    files,
  };
}

function getNestedManualFindings(value) {
  if (!value || typeof value !== 'object') return [];
  for (const key of [
    'manual_findings',
    'manualFindings',
    'unfixed_findings',
    'unfixedFindings',
    'follow_up_findings',
    'followUpFindings',
  ]) {
    if (Array.isArray(value[key])) return value[key];
  }
  for (const key of ['audit', 'result', 'findings']) {
    const nested = getNestedManualFindings(value[key]);
    if (nested.length > 0) return nested;
  }
  return [];
}

function parseManualFindingsFromStructuredOutput(value) {
  const parsed = parseJsonMaybe(value);
  const rawFindings = getNestedManualFindings(parsed);
  return rawFindings
    .map((finding, index) => normalizeFinding(finding, index))
    .filter(Boolean);
}

function parseManualFindingsFromText(value) {
  const lines = cleanText(value).split('\n');
  const headingIndex = lines.findIndex((line) =>
    /^###\s+Manual-only findings\b/i.test(line.trim()),
  );
  if (headingIndex === -1) return [];

  const findings = [];
  let current = null;

  function pushCurrent() {
    if (!current) return;
    const normalized = normalizeFinding(current, findings.length);
    if (normalized) findings.push(normalized);
    current = null;
  }

  for (const line of lines.slice(headingIndex + 1)) {
    if (/^#{1,3}\s+\S/.test(line.trim())) break;
    const bullet = line.match(
      /^\s*[-*]\s+(?:\*\*)?(F-\d+)(?:\s*\(([^)]+)\))?(?:\*\*)?:?\s*(.*)$/i,
    );
    if (bullet) {
      pushCurrent();
      current = {
        finding_id: bullet[1],
        severity: bullet[2] || '',
        summary: stripMarkdown(bullet[3]),
        details: stripMarkdown(bullet[3]),
      };
      continue;
    }
    if (current && line.trim()) {
      current.details = `${current.details}\n${stripMarkdown(line)}`.trim();
    }
  }
  pushCurrent();

  return findings;
}

function collectManualFindings({ structuredOutput, textFallback }) {
  const structured = parseManualFindingsFromStructuredOutput(structuredOutput);
  if (structured.length > 0) return structured;
  return parseManualFindingsFromText(textFallback);
}

function normalizeFingerprintPart(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, ' ');
}

function fingerprintFinding(finding) {
  const payload = [
    normalizeFingerprintPart(finding.summary),
    finding.files.map(normalizeFingerprintPart).sort().join('|'),
  ].join('\n');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function markerForFingerprint(fingerprint) {
  return `<!-- ${MARKER_PREFIX}:${fingerprint} -->`;
}

function truncateTitle(value) {
  const title = cleanText(value).replace(/\s+/g, ' ');
  if (title.length <= MAX_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_TITLE_LENGTH - 3).trimEnd()}...`;
}

function renderIssueTitle(finding) {
  const prefix = finding.findingId
    ? `[audit] ${finding.findingId}: `
    : '[audit] ';
  return truncateTitle(`${prefix}${finding.summary}`);
}

function renderIssueBody({
  finding,
  fingerprint,
  sourceRunUrl,
  sourcePrUrl,
  changedFiles,
}) {
  const files = finding.files.length > 0 ? finding.files : changedFiles;
  const fileSection =
    files.length > 0
      ? files.map((filePath) => `- \`${filePath}\``).join('\n')
      : '- Not specified by the audit output.';
  const links = [
    sourceRunUrl ? `- Source run: ${sourceRunUrl}` : '',
    sourcePrUrl ? `- Source PR: ${sourcePrUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    markerForFingerprint(fingerprint),
    '## Manual Audit Finding',
    '',
    `**Finding:** ${finding.findingId || 'Unnumbered'}`,
    `**Severity:** ${finding.severity}`,
    '',
    '## Details',
    '',
    finding.details || finding.summary,
    '',
    '## Affected Files',
    '',
    fileSection,
    '',
    '## Source',
    '',
    links || '- Source workflow metadata was unavailable.',
    '',
    '## Follow-up',
    '',
    'This issue was created because the autonomous audit-fix workflow reported the finding as manual-only or unfixed. A developer should decide and implement the appropriate fix.',
  ].join('\n');
}

function runGh(args, options = {}) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.inheritStderr ? 'inherit' : 'pipe'],
    env: process.env,
  }).trim();
}

function parseOpenIssues(output) {
  const parsed = parseJsonMaybe(output);
  return Array.isArray(parsed) ? parsed : [];
}

function findExistingIssue(issues, fingerprint) {
  const marker = markerForFingerprint(fingerprint);
  return issues.find((issue) => String(issue.body || '').includes(marker));
}

function writeTempBody(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-manual-finding-'));
  const filePath = path.join(dir, 'body.md');
  fs.writeFileSync(filePath, `${body}\n`);
  return filePath;
}

function upsertIssues({
  findings,
  labels = DEFAULT_LABELS,
  sourceRunUrl,
  sourcePrUrl,
  changedFiles = [],
  runGhCommand = runGh,
}) {
  if (findings.length === 0) {
    return { findingCount: 0, createdCount: 0, updatedCount: 0 };
  }

  const existingIssues = parseOpenIssues(
    runGhCommand([
      'issue',
      'list',
      '--state',
      'open',
      '--label',
      'audit-manual-finding',
      '--json',
      'number,title,body',
      '--limit',
      '100',
    ]),
  );
  let createdCount = 0;
  let updatedCount = 0;

  for (const finding of findings) {
    const fingerprint = fingerprintFinding(finding);
    const title = renderIssueTitle(finding);
    const body = renderIssueBody({
      finding,
      fingerprint,
      sourceRunUrl,
      sourcePrUrl,
      changedFiles,
    });
    const bodyFile = writeTempBody(body);
    const existing = findExistingIssue(existingIssues, fingerprint);
    const labelArgs = labels.flatMap((label) => ['--label', label]);

    if (existing) {
      runGhCommand([
        'issue',
        'edit',
        String(existing.number),
        '--title',
        title,
        '--body-file',
        bodyFile,
        ...labelArgs,
      ]);
      updatedCount += 1;
    } else {
      runGhCommand([
        'issue',
        'create',
        '--title',
        title,
        '--body-file',
        bodyFile,
        ...labelArgs,
      ]);
      createdCount += 1;
    }
  }

  return {
    findingCount: findings.length,
    createdCount,
    updatedCount,
  };
}

function appendGithubOutputs(outputPath, values) {
  if (!outputPath) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`);
}

function requireGitHubContext(env, findingCount) {
  if (findingCount === 0) return;
  const hasToken = Boolean(env.GH_TOKEN || env.GITHUB_TOKEN);
  const hasRepo = Boolean(env.GITHUB_REPOSITORY);
  if (!hasToken || !hasRepo) {
    throw new Error(
      'GitHub token and GITHUB_REPOSITORY are required when manual audit findings need issue upsert.',
    );
  }
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

function runCli() {
  const args = parseArgs(process.argv.slice(2));
  const textFallback =
    process.env.PR_BODY ||
    process.env.CLAUDE_LAST_OUTPUT ||
    process.env.AUDIT_TEXT ||
    '';
  const findings = collectManualFindings({
    structuredOutput: process.env.CLAUDE_STRUCTURED_OUTPUT,
    textFallback,
  });

  requireGitHubContext(process.env, findings.length);

  const result = upsertIssues({
    findings,
    sourceRunUrl: process.env.SOURCE_RUN_URL || '',
    sourcePrUrl: process.env.SOURCE_PR_URL || '',
    changedFiles: parseList(process.env.CHANGED_FILES),
  });

  appendGithubOutputs(args.githubOutput || process.env.GITHUB_OUTPUT, {
    finding_count: result.findingCount,
    created_count: result.createdCount,
    updated_count: result.updatedCount,
  });

  process.stdout.write(
    `Manual audit findings: ${result.findingCount}; created: ${result.createdCount}; updated: ${result.updatedCount}\n`,
  );
}

module.exports = {
  collectManualFindings,
  fingerprintFinding,
  markerForFingerprint,
  parseList,
  parseManualFindingsFromStructuredOutput,
  parseManualFindingsFromText,
  requireGitHubContext,
  renderIssueBody,
  renderIssueTitle,
  upsertIssues,
};

if (require.main === module) {
  runCli();
}
