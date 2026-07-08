/* eslint-disable @typescript-eslint/no-require-imports */
// Upserts a single, idempotent "/rebase" summary comment on a PR for the
// rebase-pr workflow. The workflow posts started -> conflict-working -> a
// terminal state (complete / validation-failed / push-rejected / skipped /
// failed / cancelled) by calling this script with --mode and outcome flags.
// Reuses the shared sticky-comment machinery so find/upsert has one source.
const {
  getRepoSlug,
  upsertComment,
  parseStructuredOutput,
  quoteBlock,
  shortSha,
} = require('./lib/sticky-comment.cjs');
const {
  renderGateComparison,
  renderGateSummary,
} = require('./lib/gate-summary.cjs');

const COMMENT_MARKER = '<!-- rebase-pr-summary -->';

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function isTrue(value) {
  return value === true || value === 'true';
}

// Derive the GitHub repo base URL from the run URL so links respect the actual
// server (including GitHub Enterprise). Falls back to the run URL.
function repoBaseUrl(runUrl) {
  if (!runUrl) return '';
  return runUrl.replace(/\/actions\/runs\/.*$/, '');
}

function baseLine(baseRef, baseSha) {
  if (!baseRef) return '';
  const at = baseSha ? ` @ \`${shortSha(baseSha)}\`` : '';
  return `- Base: \`origin/${baseRef}\`${at}`;
}

function renderStarted({ headSha, baseRef, runUrl, startedAt }) {
  const lines = [COMMENT_MARKER, '## 🔄 Rebase started', ''];
  if (baseRef) lines.push(baseLine(baseRef));
  lines.push(
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    `- Started: ${startedAt}`,
    '',
    '_Rebasing onto the current base branch — summary posts here when done._',
    '',
    '<!-- updated: ' + startedAt + ' -->',
  );
  return lines.join('\n');
}

function renderConflictWorking({ headSha, baseRef, runUrl, updatedAt }) {
  const lines = [COMMENT_MARKER, '## 🔀 Resolving rebase conflicts…', ''];
  if (baseRef) lines.push(baseLine(baseRef));
  lines.push(
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    '_Claude (opus) is resolving the in-progress rebase conflicts; results post here shortly._',
    '',
    '<!-- updated: ' + updatedAt + ' -->',
  );
  return lines.join('\n');
}

function renderSkipped({ headSha, runUrl, reason, updatedAt }) {
  return [
    COMMENT_MARKER,
    '## ⏭️ Rebase skipped',
    '',
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(
      reason ||
        'PR is not eligible (closed, merged, draft, cross-repo, missing head, ' +
          '`do-not-merge`, or a stale dispatch head SHA).',
    ),
    '',
    'Re-run `/rebase` on an eligible open same-repo PR (not draft, not cross-repo, no `do-not-merge`).',
    '',
    '<!-- updated: ' + updatedAt + ' -->',
  ].join('\n');
}

function renderAncestryFailed({
  headSha,
  baseRef,
  baseSha,
  mergeBase,
  replayCount,
  visibleCommitCount,
  runUrl,
  reason,
  updatedAt,
}) {
  const lines = [COMMENT_MARKER, '## 🧭 Rebase ancestry check failed', ''];
  if (baseRef) lines.push(baseLine(baseRef, baseSha));
  lines.push(
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Merge base: ${mergeBase ? `\`${shortSha(mergeBase)}\`` : '_unavailable_'}`,
    `- Replay count: ${replayCount || '_unknown_'}`,
    `- Visible PR commits: ${visibleCommitCount || '_unknown_'}`,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(
      reason ||
        'The runner could not prove a sane merge base/replay range for this PR.',
    ),
    '',
    'The workflow stopped before attempting `git rebase` or invoking ZAI. Re-run `/rebase` after the runner can see complete ancestry for the PR head and base branch.',
    '',
    '<!-- updated: ' + updatedAt + ' -->',
  );
  return lines.join('\n');
}

function pushedLabel({ pushed, dryRun }) {
  if (isTrue(dryRun)) return 'Pushed: dry-run (not pushed)';
  if (isTrue(pushed)) return 'Pushed: yes (`--force-with-lease`)';
  return 'Pushed: no (no changes after rebase)';
}

function parsePathList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseGateComparison(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function renderComplete({
  structured,
  numTurns,
  headSha,
  newHeadSha,
  baseRef,
  baseSha,
  runUrl,
  conflictsResolvedByAi,
  trivialConflictsAutoResolved,
  trivialConflictCount,
  trivialConflictPaths,
  pushed,
  dryRun,
  force,
  automergeDisabled,
  reviewFeedbackPresent,
  gateComparison,
  updatedAt,
}) {
  const conflicts = Array.isArray(structured.conflicts_resolved)
    ? structured.conflicts_resolved
    : [];
  const preserved = Array.isArray(structured.review_findings_preserved)
    ? structured.review_findings_preserved
    : [];
  const addressed = Array.isArray(structured.review_findings_addressed)
    ? structured.review_findings_addressed
    : [];
  const movedHead = Boolean(newHeadSha) && newHeadSha !== headSha;
  const lines = [COMMENT_MARKER, '## ✅ Rebase complete', ''];
  if (baseRef) lines.push(baseLine(baseRef, baseSha));
  lines.push(`- Old head: \`${shortSha(headSha)}\``);
  if (movedHead) {
    lines.push(`- New head: \`${shortSha(newHeadSha)}\``);
  }
  lines.push(
    `- Conflicts resolved by AI: ${isTrue(conflictsResolvedByAi) ? 'yes' : 'no'}`,
    `- Trivial conflicts auto-resolved: ${isTrue(trivialConflictsAutoResolved) ? 'yes' : 'no'}`,
    `- ${pushedLabel({ pushed, dryRun })}`,
    `- Run: ${runUrl || '_n/a_'}`,
  );
  if (isTrue(force)) {
    lines.push('- ⚡ **Force mode**: post-rebase validation gate skipped');
  }
  if (reviewFeedbackPresent !== null && reviewFeedbackPresent !== undefined) {
    lines.push(
      `- Unresolved review feedback: ${isTrue(reviewFeedbackPresent) ? 'present' : 'none'}`,
    );
  }
  const comparisonSummary = renderGateComparison(gateComparison);
  if (comparisonSummary) {
    lines.push('', comparisonSummary);
  }
  if (structured.summary) {
    lines.push('', quoteBlock(structured.summary));
  }
  if (conflicts.length > 0) {
    lines.push('', `**Conflicts resolved (${conflicts.length}):**`);
    conflicts.forEach((c) =>
      lines.push(`- \`${c.file}\` — ${c.resolution || '(no detail)'}`),
    );
  }
  const trivialPaths = parsePathList(trivialConflictPaths);
  const trivialCount =
    Number.isFinite(Number(trivialConflictCount)) &&
    Number(trivialConflictCount) > 0
      ? Number(trivialConflictCount)
      : trivialPaths.length;
  if (isTrue(trivialConflictsAutoResolved) && trivialCount > 0) {
    lines.push('', `**Trivial conflicts auto-resolved (${trivialCount}):**`);
    trivialPaths.forEach((filePath) => lines.push(`- \`${filePath}\``));
  }
  if (preserved.length > 0) {
    lines.push('', `**Review findings preserved (${preserved.length}):**`);
    preserved.forEach((f) => lines.push(`- ${f}`));
  }
  if (addressed.length > 0) {
    lines.push('', `**Review findings addressed (${addressed.length}):**`);
    addressed.forEach((f) => lines.push(`- ${f}`));
  }
  const turns =
    numTurns && Number.isFinite(Number(numTurns)) ? String(numTurns) : null;
  const footer = turns
    ? `_Turns: ${turns} · Updated ${updatedAt}_`
    : `_Updated ${updatedAt}_`;
  lines.push('', '---', footer);
  if (isTrue(automergeDisabled)) {
    lines.push(
      '',
      '> ⚠️ **Auto-merge was disabled** so the rebased branch is re-reviewed. ' +
        'Re-approve to merge.',
    );
  }
  lines.push('<!-- updated: ' + updatedAt + ' -->');
  return lines.join('\n');
}

function renderValidationFailed({
  headSha,
  runUrl,
  structured,
  gateOutcomes = {},
  gateComparison,
  updatedAt,
}) {
  const lines = [
    COMMENT_MARKER,
    '## ⚠️ Validation failed — rebased branch not pushed',
    '',
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(
      'The CI-matching gate did not pass, so the rebased branch was NOT pushed. ' +
        'Fix the failing check and re-run `/rebase`.',
    ),
    '',
    renderGateSummary({
      agentValidation: structured.validation,
      gateOutcomes,
    }),
  ];
  const comparisonSummary = renderGateComparison(gateComparison);
  if (comparisonSummary) {
    lines.push('', comparisonSummary);
  }
  if (structured.summary) {
    lines.push('', quoteBlock(structured.summary));
  }
  lines.push('', '<!-- updated: ' + updatedAt + ' -->');
  return lines.join('\n');
}

function renderPushRejected({ headSha, runUrl, reason, updatedAt }) {
  return [
    COMMENT_MARKER,
    '## 🚫 Push rejected',
    '',
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(
      reason ||
        'The `--force-with-lease` push was rejected (the branch advanced under ' +
          'us or branch protection refused the rewrite).',
    ),
    '',
    'The workflow never retries with plain `--force`. Re-run `/rebase` to ' +
      'reapply on the latest head once protection allows it.',
    '',
    '<!-- updated: ' + updatedAt + ' -->',
  ].join('\n');
}

function renderFailed({ headSha, runUrl, failReason, updatedAt }) {
  const reason = failReason || 'The rebase could not complete successfully.';
  return [
    COMMENT_MARKER,
    '## ❌ Rebase failed',
    '',
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(reason),
    '',
    'Re-run `/rebase` after addressing the failure.',
    '',
    '<!-- updated: ' + updatedAt + ' -->',
  ].join('\n');
}

function renderCancelled({ headSha, runUrl, updatedAt }) {
  return [
    COMMENT_MARKER,
    '## 🚫 Rebase cancelled',
    '',
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(
      'The run did not finish — it was cancelled, most likely by the job ' +
        'timeout or by a newer `/rebase` superseding it.',
    ),
    '',
    'Re-run `/rebase` to retry.',
    '',
    '<!-- updated: ' + updatedAt + ' -->',
  ].join('\n');
}

// Terminal-state precedence: cancellation > Claude/git hard-failure > no-op
// (rebase moved nothing) > gate failure > dry-run > push rejection > complete.
// The no-op check precedes the gate check because a no-op rebase intentionally
// skips the gate (nothing to validate or push) and must read as "complete", not
// "validation-failed".
function resolveFinishedBody({
  structured,
  numTurns,
  headSha,
  newHeadSha,
  baseRef,
  baseSha,
  runUrl,
  conflictsResolvedByAi,
  trivialConflictsAutoResolved,
  trivialConflictCount,
  trivialConflictPaths,
  automergeDisabled,
  failed,
  failReason,
  outcome,
  gatePassed,
  gateOutcomes = {},
  gateComparison,
  gateNoNewFailures,
  pushed,
  rebaseMovedHead,
  dryRun,
  force,
  reviewFeedbackPresent,
}) {
  const updatedAt = new Date().toISOString();
  if (outcome === 'cancelled') {
    return renderCancelled({ headSha, runUrl, updatedAt });
  }
  if (isTrue(failed)) {
    return renderFailed({ headSha, runUrl, failReason, updatedAt });
  }
  if (!isTrue(rebaseMovedHead)) {
    return renderComplete({
      structured,
      numTurns,
      headSha,
      baseRef,
      baseSha,
      runUrl,
      conflictsResolvedByAi,
      trivialConflictsAutoResolved,
      trivialConflictCount,
      trivialConflictPaths,
      pushed,
      dryRun,
      automergeDisabled,
      reviewFeedbackPresent,
      rebaseMovedHead,
      gateComparison,
      force,
      updatedAt,
    });
  }
  // Force mode skips the post-rebase validation gate — the workflow
  // never runs validate-pr-gate when force=true, so gate outcomes are
  // absent/unreliable. Fall through to push/complete with force indicator.
  if (!isTrue(force) && !isTrue(gatePassed) && !isTrue(gateNoNewFailures)) {
    return renderValidationFailed({
      headSha,
      runUrl,
      structured,
      gateOutcomes,
      gateComparison,
      updatedAt,
    });
  }
  if (isTrue(dryRun)) {
    return renderComplete({
      structured,
      numTurns,
      headSha,
      newHeadSha,
      baseRef,
      baseSha,
      runUrl,
      conflictsResolvedByAi,
      trivialConflictsAutoResolved,
      trivialConflictCount,
      trivialConflictPaths,
      pushed: false,
      dryRun: 'true',
      automergeDisabled,
      reviewFeedbackPresent,
      gateComparison,
      force,
      updatedAt,
    });
  }
  if (!isTrue(pushed)) {
    return renderPushRejected({ headSha, runUrl, updatedAt });
  }
  return renderComplete({
    structured,
    numTurns,
    headSha,
    newHeadSha,
    baseRef,
    baseSha,
    runUrl,
    conflictsResolvedByAi,
    trivialConflictsAutoResolved,
    trivialConflictCount,
    trivialConflictPaths,
    pushed,
    dryRun,
    automergeDisabled,
    reviewFeedbackPresent,
    gateComparison,
    force,
    updatedAt,
  });
}

function main() {
  const prNumber = Number(getArg('--pr', getArg('--pr-number')));
  const headSha = getArg('--head-sha');
  const newHeadSha = getArg('--new-head-sha');
  const baseRef = getArg('--base-ref');
  const baseSha = getArg('--base-sha');
  const runUrl = getArg('--run-url');
  const mode = getArg('--mode', 'complete');

  if (!prNumber) {
    throw new Error('--pr (pull request number) is required.');
  }

  const structured = parseStructuredOutput(
    process.env.STRUCTURED_OUTPUT || getArg('--structured-output'),
  );
  const gateComparison = parseGateComparison(
    process.env.GATE_COMPARISON_JSON || getArg('--gate-comparison-json'),
  );
  const now = new Date().toISOString();
  let body;
  switch (mode) {
    case 'started':
      body = renderStarted({ headSha, baseRef, runUrl, startedAt: now });
      break;
    case 'conflict-working':
      body = renderConflictWorking({
        headSha,
        baseRef,
        runUrl,
        updatedAt: now,
      });
      break;
    case 'skipped':
      body = renderSkipped({
        headSha,
        runUrl,
        reason: getArg('--reason'),
        updatedAt: now,
      });
      break;
    case 'ancestry-failed':
      body = renderAncestryFailed({
        headSha,
        baseRef,
        baseSha,
        mergeBase: getArg('--merge-base'),
        replayCount: getArg('--replay-count'),
        visibleCommitCount: getArg('--visible-commit-count'),
        runUrl,
        reason: getArg('--reason'),
        updatedAt: now,
      });
      break;
    case 'complete':
      body = resolveFinishedBody({
        structured,
        numTurns: getArg('--num-turns'),
        headSha,
        newHeadSha,
        baseRef,
        baseSha,
        runUrl,
        conflictsResolvedByAi: getArg('--conflicts-resolved-by-ai'),
        trivialConflictsAutoResolved: getArg(
          '--trivial-conflicts-auto-resolved',
        ),
        trivialConflictCount: getArg('--trivial-conflict-count'),
        trivialConflictPaths: getArg('--trivial-conflict-paths'),
        automergeDisabled: getArg('--automerge-disabled'),
        failed: getArg('--failed'),
        failReason: getArg('--fail-reason'),
        outcome: getArg('--outcome'),
        gatePassed: getArg('--gate-passed'),
        gateOutcomes: {
          lint: getArg('--lint-outcome'),
          typecheck: getArg('--typecheck-outcome'),
          format: getArg('--format-outcome'),
          test: getArg('--test-outcome'),
          build: getArg('--build-outcome'),
          scriptTests: getArg('--script-tests-outcome'),
          prismaSafe: getArg('--prisma-safe-outcome'),
        },
        gateComparison,
        gateNoNewFailures: getArg('--gate-no-new-failures'),
        pushed: getArg('--pushed'),
        rebaseMovedHead: getArg('--rebase-moved-head'),
        dryRun: getArg('--dry-run'),
        force: getArg('--force'),
        reviewFeedbackPresent: getArg('--review-feedback-present'),
      });
      break;
    default:
      throw new Error(`Unknown rebase comment mode: ${mode}`);
  }

  const repo = getRepoSlug();
  upsertComment({
    repo,
    prNumber,
    marker: COMMENT_MARKER,
    body,
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  COMMENT_MARKER,
  isTrue,
  parsePathList,
  parseGateComparison,
  repoBaseUrl,
  renderStarted,
  renderConflictWorking,
  renderSkipped,
  renderAncestryFailed,
  renderComplete,
  renderValidationFailed,
  renderPushRejected,
  renderFailed,
  renderCancelled,
  resolveFinishedBody,
};
