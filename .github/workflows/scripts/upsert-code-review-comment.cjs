/* eslint-disable @typescript-eslint/no-require-imports */
// Upserts a single, idempotent "code-review summary" comment on a PR.
// Owned by the code-review workflow itself so a summary appears on every
// trigger (workflow_dispatch included), independent of claude-code-action's
// track_progress (which only posts for pull_request/issue events).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const COMMENT_MARKER = '<!-- code-review-summary -->';

const REVIEW_CHECKLIST = [
  'General code review',
  'Security review (STRIDE)',
  'OWASP Top 10',
  'Diff hygiene',
  'Threat model',
];

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function getRepoSlug() {
  const repo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new Error('GH_REPO or GITHUB_REPOSITORY is required.');
  }
  return repo;
}

function run(command, args, options = {}) {
  try {
    return (
      execFileSync(command, args, {
        encoding: 'utf8',
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }) ?? ''
    ).trim();
  } catch (error) {
    const stderr = String(error.stderr ?? '').trim();
    if (options.allowFailure) {
      return options.fallback ?? '';
    }
    if (stderr) {
      console.error(stderr);
    }
    throw error;
  }
}

function runJson(command, args, fallback = []) {
  const output = run(command, args, {
    allowFailure: fallback !== undefined,
    fallback: JSON.stringify(fallback),
  });
  return output ? JSON.parse(output) : fallback;
}

function writeTempJson(prefix, payload) {
  const filePath = path.join(
    os.tmpdir(),
    `${prefix}-${process.pid}-${Date.now()}.json`,
  );
  fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
  return filePath;
}

// Parses the structured review output defensively: empty/invalid JSON -> {}.
function parseStructuredOutput(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function verdictIcon(verdict) {
  if (verdict === 'concerns') return '⚠️';
  if (verdict === 'passed') return '✅';
  return 'ℹ️';
}

function shortSha(sha) {
  return sha ? String(sha).slice(0, 12) : 'unknown';
}

// Prefix every line with "> " so multi-line text stays inside a Markdown
// blockquote instead of leaking into the surrounding body.
function quoteBlock(text) {
  return String(text)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function renderStarted({ headSha, runUrl, startedAt }) {
  const checklist = REVIEW_CHECKLIST.map((item) => `- [ ] ${item}`).join('\n');
  return [
    COMMENT_MARKER,
    '## 🔄 Code review in progress',
    '',
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    `- Started: ${startedAt}`,
    '',
    '### Review checklist',
    checklist,
    '',
    '_Results will be posted here when the run completes._',
    '',
    '<!-- updated: ' + startedAt + ' -->',
  ].join('\n');
}

function renderFailureBody({ headSha, runUrl, failReason, updatedAt }) {
  const reason =
    failReason || 'The review agent did not complete successfully.';
  return [
    COMMENT_MARKER,
    '## ❌ Code review failed to complete',
    '',
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(reason),
    '',
    'Re-dispatch the review after addressing the failure, or comment `/review`.',
    '',
    '<!-- updated: ' + updatedAt + ' -->',
  ].join('\n');
}

function renderCancelled({ headSha, runUrl, updatedAt }) {
  return [
    COMMENT_MARKER,
    '## 🚫 Code review was cancelled',
    '',
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(
      'The review run did not finish — it was cancelled, most likely by ' +
        'the job timeout or by a newer review run superseding it.',
    ),
    '',
    'Re-dispatch with `/review`, or raise the review timeout if this recurs.',
    '',
    '<!-- updated: ' + updatedAt + ' -->',
  ].join('\n');
}

function renderComplete({
  structured,
  numTurns,
  headSha,
  runUrl,
  failed,
  failReason,
}) {
  const updatedAt = new Date().toISOString();
  if (failed === true || failed === 'true') {
    return renderFailureBody({ headSha, runUrl, failReason, updatedAt });
  }

  const codeReview = structured.code_review || {};
  const securityReview = structured.security_review || {};
  const reviewedFiles = Array.isArray(structured.reviewed_files)
    ? structured.reviewed_files
    : [];

  // Missing verdicts mean the review did not actually produce its result
  // (empty structured output without a hard failure). Default to incomplete,
  // never a green "passed" — the label step treats missing verdicts as
  // concerns, so the comment must not claim success.
  if (!codeReview.verdict || !securityReview.verdict) {
    return renderFailureBody({
      headSha,
      runUrl,
      failReason: failReason || 'Review did not produce structured verdicts.',
      updatedAt,
    });
  }

  const anyConcerns =
    codeReview.verdict === 'concerns' || securityReview.verdict === 'concerns';
  const overallIcon = anyConcerns ? '⚠️' : '✅';
  const overallText = anyConcerns ? 'with concerns' : 'passed';

  const sections = [
    COMMENT_MARKER,
    `## ${overallIcon} Code review complete — ${overallText}`,
    '',
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
  ];

  sections.push(
    `**Code review — ${verdictIcon(codeReview.verdict)} ${
      codeReview.verdict || 'unknown'
    }**`,
  );
  if (codeReview.summary) {
    sections.push(quoteBlock(codeReview.summary));
  }
  const blocking = Number.isInteger(codeReview.blocking_findings_count)
    ? codeReview.blocking_findings_count
    : 0;
  sections.push(`Blocking findings: **${blocking}**`);
  sections.push('');

  sections.push(
    `**Security review — ${verdictIcon(securityReview.verdict)} ${
      securityReview.verdict || 'unknown'
    }**`,
  );
  if (securityReview.summary) {
    sections.push(quoteBlock(securityReview.summary));
  }
  sections.push(
    `Highest severity: **${securityReview.highest_severity || 'none'}**`,
  );
  sections.push('');

  sections.push(`**Reviewed files (${reviewedFiles.length}):**`);
  if (reviewedFiles.length > 0) {
    sections.push('<details><summary>paths</summary>');
    sections.push('');
    for (const file of reviewedFiles) {
      sections.push(`- ${file}`);
    }
    sections.push('');
    sections.push('</details>');
  }

  const turns =
    numTurns && Number.isFinite(Number(numTurns)) ? String(numTurns) : null;
  const footer = turns
    ? `_Turns: ${turns} · Updated ${updatedAt}_`
    : `_Updated ${updatedAt}_`;
  sections.push('', '---', footer, '<!-- updated: ' + updatedAt + ' -->');

  return sections.join('\n');
}

function findExistingComment(comments) {
  return (
    comments.find(
      (comment) =>
        comment.user?.login === 'github-actions[bot]' &&
        String(comment.body ?? '').includes(COMMENT_MARKER),
    ) ?? null
  );
}

function listComments(repo, prNumber) {
  return runJson(
    'gh',
    ['api', `repos/${repo}/issues/${prNumber}/comments`, '--paginate'],
    [],
  );
}

function upsertComment({ repo, prNumber, body }) {
  const existing = findExistingComment(listComments(repo, prNumber));
  const payloadPath = writeTempJson('code-review-comment', { body });

  try {
    if (existing) {
      run('gh', [
        'api',
        '-X',
        'PATCH',
        `repos/${repo}/issues/comments/${existing.id}`,
        '--input',
        payloadPath,
      ]);
      return;
    }
    run('gh', [
      'api',
      '-X',
      'POST',
      `repos/${repo}/issues/${prNumber}/comments`,
      '--input',
      payloadPath,
    ]);
  } finally {
    fs.rmSync(payloadPath, { force: true });
  }
}

function main() {
  const repo = getRepoSlug();
  const prNumber = Number(getArg('--pr', getArg('--pr-number')));
  const headSha = getArg('--head-sha');
  const runUrl = getArg('--run-url');
  const mode = getArg('--mode', 'complete');

  if (!prNumber) {
    throw new Error('--pr (pull request number) is required.');
  }

  let body;
  if (mode === 'started') {
    body = renderStarted({
      headSha,
      runUrl,
      startedAt: new Date().toISOString(),
    });
  } else {
    // A cancelled review step (job timeout or superseded) is the root cause
    // of an "execution output unreadable" failure, so surface it distinctly
    // rather than as a generic model error.
    if (getArg('--outcome') === 'cancelled') {
      body = renderCancelled({
        headSha,
        runUrl,
        updatedAt: new Date().toISOString(),
      });
    } else {
      body = renderComplete({
        structured: parseStructuredOutput(
          process.env.STRUCTURED_OUTPUT || getArg('--structured-output'),
        ),
        numTurns: getArg('--num-turns'),
        headSha,
        runUrl,
        failed: getArg('--failed'),
        failReason: getArg('--fail-reason'),
      });
    }
  }

  upsertComment({ repo, prNumber, body });
}

if (require.main === module) {
  main();
}

module.exports = {
  COMMENT_MARKER,
  REVIEW_CHECKLIST,
  parseStructuredOutput,
  verdictIcon,
  quoteBlock,
  renderStarted,
  renderCancelled,
  renderComplete,
  renderFailureBody,
  findExistingComment,
};
