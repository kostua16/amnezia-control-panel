/* eslint-disable @typescript-eslint/no-require-imports */
// Upserts a single, idempotent "code-review summary" comment on a PR.
// Owned by the code-review workflow itself so a summary appears on every
// trigger (workflow_dispatch included), independent of claude-code-action's
// track_progress (which only posts for pull_request/issue events).
const {
  getRepoSlug,
  upsertComment,
  parseStructuredOutput,
  quoteBlock,
  shortSha,
  findExistingComment: findExistingCommentByMarker,
} = require('./lib/sticky-comment.cjs');
const fs = require('node:fs');

const COMMENT_MARKER = '<!-- code-review-summary -->';
const BOT_LOGIN = 'github-actions[bot]';

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

// Preserve the historical single-arg signature expected by callers/tests;
// the marker is this script's own.
const findExistingComment = (comments) =>
  findExistingCommentByMarker(comments, COMMENT_MARKER);

// When the caller already knows the sticky comment's id — the started step of
// the same job recorded it via --emit-id-file — the REST list of the PR's
// issue comments can be skipped. upsertComment accepts a supplied comment
// list, so a synthetic entry carrying the id, the bot login and the marker is
// enough for it to match and address the comment directly. An invalid id
// yields null, which sends upsertComment back to the marker-scan list. A stale
// id (comment deleted meanwhile) degrades to the tolerated orphan-delete
// warning, the same as a concurrent delete on the list path.
function resolveKnownCommentList(knownCommentId) {
  if (knownCommentId === null || knownCommentId === undefined) return null;
  const raw = String(knownCommentId).trim();
  if (!raw) return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return [{ id, user: { login: BOT_LOGIN }, body: COMMENT_MARKER }];
}

function verdictIcon(verdict) {
  if (verdict === 'concerns') return '⚠️';
  if (verdict === 'passed') return '✅';
  return 'ℹ️';
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

function renderSkipped({ headSha, runUrl, updatedAt }) {
  return [
    COMMENT_MARKER,
    '## ⚪ Code review was skipped',
    '',
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(
      'The review step did not start because an earlier setup or prerequisite ' +
        'step failed.',
    ),
    '',
    'Inspect the failed prerequisite step, then re-dispatch with `/review`.',
    '',
    '<!-- updated: ' + updatedAt + ' -->',
  ].join('\n');
}

function isCancelledOutcome(outcome) {
  return outcome === 'cancelled';
}

function isSkippedOutcome(outcome) {
  return outcome === 'skipped';
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

function main() {
  const repo = getRepoSlug();
  const prNumber = Number(getArg('--pr', getArg('--pr-number')));
  const headSha = getArg('--head-sha');
  const runUrl = getArg('--run-url');
  const mode = getArg('--mode', 'complete');
  const knownCommentId = getArg('--known-comment-id');
  const emitIdFile = getArg('--emit-id-file');

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
    const outcome = getArg('--outcome');
    if (isCancelledOutcome(outcome)) {
      body = renderCancelled({
        headSha,
        runUrl,
        updatedAt: new Date().toISOString(),
      });
    } else if (isSkippedOutcome(outcome)) {
      body = renderSkipped({
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

  const result = upsertComment({
    repo,
    prNumber,
    marker: COMMENT_MARKER,
    body,
    comments: resolveKnownCommentList(knownCommentId),
  });

  // Hand the new comment's id to a later invocation in the same job (the
  // workflow's complete step) so it can skip the REST list.
  if (emitIdFile && Number.isInteger(result?.createdId)) {
    fs.writeFileSync(emitIdFile, String(result.createdId), 'utf8');
  }
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
  renderSkipped,
  isCancelledOutcome,
  isSkippedOutcome,
  renderComplete,
  renderFailureBody,
  findExistingComment,
  resolveKnownCommentList,
};
