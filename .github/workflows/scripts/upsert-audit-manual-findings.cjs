#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AUDIT_MODE = 'audit-manual-findings';
const GSD_DEFERRED_MODE = 'gsd-deferred-proposals';
const DEFAULT_LABELS = ['auto-fix', 'needs-review', 'audit-manual-finding'];
const MODE_CONFIGS = {
  [AUDIT_MODE]: {
    labels: DEFAULT_LABELS,
    markerPrefix: 'audit-manual-finding',
    issueListLabel: 'audit-manual-finding',
    reportName: 'Manual audit findings',
    titlePrefix: '[audit]',
    bodyHeading: 'Manual Audit Finding',
    bodyIntro:
      'This issue was created because the autonomous audit-fix workflow reported the finding as manual-only or unfixed. A developer should decide and implement the appropriate fix.',
  },
  [GSD_DEFERRED_MODE]: {
    labels: ['needs-review', 'gsd-deferred-proposal', 'area/planning'],
    markerPrefix: 'gsd-deferred-proposal',
    issueListLabel: 'gsd-deferred-proposal',
    reportName: 'GSD deferred proposals',
    titlePrefix: '[gsd-deferred]',
    bodyHeading: 'Deferred GSD Proposal',
    bodyIntro:
      'This issue was created because the GSD planning executor intentionally deferred this proposal from the selected implementation PR. A developer should decide whether and how to schedule the follow-up work.',
  },
};
const MARKER_PREFIX = MODE_CONFIGS[AUDIT_MODE].markerPrefix;
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
  return severity || 'unspecified';
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

function parseGsdDeferredProposalsFromStructuredOutput(value) {
  const parsed = parseJsonMaybe(value);
  const rawFindings = getNestedManualFindings(parsed);
  if (rawFindings.length > 0) {
    return rawFindings
      .map((finding, index) => normalizeFinding(finding, index))
      .filter(Boolean);
  }
  if (!parsed || typeof parsed !== 'object') return [];
  for (const key of [
    'deferred_proposals',
    'deferredProposals',
    'proposals_deferred',
    'proposalsDeferred',
  ]) {
    if (Array.isArray(parsed[key])) {
      return parsed[key]
        .map((finding, index) => normalizeFinding(finding, index))
        .filter(Boolean);
    }
  }
  return [];
}

function parseGsdDeferredProposalsFromText(value) {
  const lines = cleanText(value).split('\n');
  const headingIndex = lines.findIndex((line) =>
    /^###\s+Proposals deferred\b/i.test(line.trim()),
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
      /^\s*[-*]\s+(?:\*\*)?(Proposal\s+\d+)(?:\s*\(([^)]+)\))?(?:\*\*)?:?\s*(.*)$/i,
    );
    if (bullet) {
      pushCurrent();
      current = {
        finding_id: stripMarkdown(bullet[1]),
        severity: 'deferred',
        summary: stripMarkdown(bullet[2] || bullet[3] || bullet[1]),
        details: stripMarkdown(bullet[3] || bullet[2] || ''),
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

function normalizeMode(value) {
  const mode = cleanText(value || AUDIT_MODE);
  if (MODE_CONFIGS[mode]) return mode;
  throw new Error(`Unsupported manual finding mode: ${mode}`);
}

function configForMode(mode) {
  return MODE_CONFIGS[normalizeMode(mode)];
}

function collectManualFindings({
  structuredOutput,
  textFallback,
  mode = AUDIT_MODE,
}) {
  if (normalizeMode(mode) === GSD_DEFERRED_MODE) {
    const structured =
      parseGsdDeferredProposalsFromStructuredOutput(structuredOutput);
    if (structured.length > 0) return structured;
    return parseGsdDeferredProposalsFromText(textFallback);
  }
  const structured = parseManualFindingsFromStructuredOutput(structuredOutput);
  if (structured.length > 0) return structured;
  return parseManualFindingsFromText(textFallback);
}

function normalizeFingerprintPart(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, ' ');
}

function fingerprintFinding(finding, options = {}) {
  const payload = [
    normalizeFingerprintPart(finding.summary),
    finding.files.map(normalizeFingerprintPart).sort().join('|'),
  ];
  if (options.fingerprintSalt) {
    payload.unshift(
      normalizeFingerprintPart(options.fingerprintSalt),
      normalizeFingerprintPart(finding.findingId || ''),
    );
  }
  return crypto
    .createHash('sha256')
    .update(payload.join('\n'))
    .digest('hex')
    .slice(0, 16);
}

function markerForFingerprint(fingerprint, markerPrefix = MARKER_PREFIX) {
  return `<!-- ${markerPrefix}:${fingerprint} -->`;
}

function truncateTitle(value) {
  const title = cleanText(value).replace(/\s+/g, ' ');
  if (title.length <= MAX_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_TITLE_LENGTH - 3).trimEnd()}...`;
}

function renderIssueTitle(finding, mode = AUDIT_MODE) {
  const config = configForMode(mode);
  const prefix = finding.findingId
    ? `${config.titlePrefix} ${finding.findingId}: `
    : `${config.titlePrefix} `;
  return truncateTitle(`${prefix}${finding.summary}`);
}

function renderIssueBody({
  finding,
  fingerprint,
  sourceRunUrl,
  sourcePrUrl,
  changedFiles,
  sourceArtifact,
  sourceHash,
  importedPlan,
  sourceTitle,
  mode = AUDIT_MODE,
}) {
  const config = configForMode(mode);
  const files = finding.files.length > 0 ? finding.files : changedFiles;
  const fileSection =
    files.length > 0
      ? files.map((filePath) => `- \`${filePath}\``).join('\n')
      : '- Not specified by the automation output.';
  const links = [
    sourceRunUrl ? `- Source run: ${sourceRunUrl}` : '',
    sourcePrUrl ? `- Source PR: ${sourcePrUrl}` : '',
    sourceArtifact ? `- Source artifact: \`${sourceArtifact}\`` : '',
    importedPlan ? `- Imported plan: \`${importedPlan}\`` : '',
    sourceHash ? `- Source SHA-256: \`${sourceHash}\`` : '',
    sourceTitle ? `- Source title: ${sourceTitle}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    markerForFingerprint(fingerprint, config.markerPrefix),
    `## ${config.bodyHeading}`,
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
    config.bodyIntro,
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

function findExistingIssue(issues, fingerprint, mode = AUDIT_MODE) {
  const marker = markerForFingerprint(
    fingerprint,
    configForMode(mode).markerPrefix,
  );
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
  labels,
  sourceRunUrl,
  sourcePrUrl,
  sourceArtifact,
  sourceHash,
  importedPlan,
  sourceTitle,
  changedFiles = [],
  mode = AUDIT_MODE,
  runGhCommand = runGh,
}) {
  const config = configForMode(mode);
  const effectiveLabels = labels || config.labels;
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
      config.issueListLabel,
      '--json',
      'number,title,body',
      '--limit',
      '100',
    ]),
  );
  let createdCount = 0;
  let updatedCount = 0;

  for (const finding of findings) {
    const fingerprint = fingerprintFinding(finding, {
      fingerprintSalt: sourceHash || sourceArtifact || '',
    });
    const title = renderIssueTitle(finding, mode);
    const body = renderIssueBody({
      finding,
      fingerprint,
      sourceRunUrl,
      sourcePrUrl,
      sourceArtifact,
      sourceHash,
      importedPlan,
      sourceTitle,
      changedFiles,
      mode,
    });
    const bodyFile = writeTempBody(body);
    const existing = findExistingIssue(existingIssues, fingerprint, mode);
    // gh issue create accepts --label; gh issue edit only accepts --add-label/--remove-label.
    // Build per-branch flag arrays so the edit path does not pass an unsupported --label.
    const createLabelArgs = effectiveLabels.flatMap((label) => [
      '--label',
      label,
    ]);
    const editLabelArgs = effectiveLabels.flatMap((label) => [
      '--add-label',
      label,
    ]);

    if (existing) {
      runGhCommand([
        'issue',
        'edit',
        String(existing.number),
        '--title',
        title,
        '--body-file',
        bodyFile,
        ...editLabelArgs,
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
        ...createLabelArgs,
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
  const mode = normalizeMode(args.mode || process.env.MANUAL_FINDING_MODE);
  const config = configForMode(mode);
  const reportOnly = args.reportOnly === 'true';
  const textFallback =
    process.env.PR_BODY ||
    process.env.CLAUDE_LAST_OUTPUT ||
    process.env.AUDIT_TEXT ||
    '';
  const findings = collectManualFindings({
    structuredOutput: process.env.CLAUDE_STRUCTURED_OUTPUT,
    textFallback,
    mode,
  });

  const result = reportOnly
    ? {
        findingCount: findings.length,
        createdCount: 0,
        updatedCount: 0,
      }
    : (() => {
        requireGitHubContext(process.env, findings.length);
        return upsertIssues({
          findings,
          labels: config.labels,
          sourceRunUrl: process.env.SOURCE_RUN_URL || '',
          sourcePrUrl: process.env.SOURCE_PR_URL || '',
          sourceArtifact: process.env.SOURCE_ARTIFACT || '',
          sourceHash: process.env.SOURCE_HASH || '',
          importedPlan: process.env.IMPORTED_PLAN || '',
          sourceTitle: process.env.SOURCE_TITLE || '',
          changedFiles: parseList(process.env.CHANGED_FILES),
          mode,
        });
      })();

  appendGithubOutputs(args.githubOutput || process.env.GITHUB_OUTPUT, {
    finding_count: result.findingCount,
    created_count: result.createdCount,
    updated_count: result.updatedCount,
  });

  process.stdout.write(
    `${config.reportName}: ${result.findingCount}; created: ${result.createdCount}; updated: ${result.updatedCount}\n`,
  );
}

module.exports = {
  AUDIT_MODE,
  GSD_DEFERRED_MODE,
  collectManualFindings,
  fingerprintFinding,
  markerForFingerprint,
  normalizeSeverity,
  parseList,
  parseGsdDeferredProposalsFromText,
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
