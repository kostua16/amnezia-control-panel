/* eslint-disable @typescript-eslint/no-require-imports */
// Upserts a single, idempotent "/fix-review summary" comment on a PR.
// The fix-review workflow posts started -> working -> finished (or skipped /
// no-changes / push-rejected / validation-failed / failed / cancelled) by
// calling this script with --mode and outcome flags. Reuses the shared
// sticky-comment machinery so the find/upsert logic has one source of truth.
const {
  getRepoSlug,
  upsertComment,
  parseStructuredOutput,
  quoteBlock,
  shortSha,
} = require('./lib/sticky-comment.cjs');
const { renderGateSummary } = require('./lib/gate-summary.cjs');

const COMMENT_MARKER = '<!-- fix-review-summary -->';

function reportHeading(state) {
  return `## FIX-REVIEW Report: ${state}`;
}

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function isTrue(value) {
  return value === true || value === 'true';
}

// Derive the GitHub repo base URL from the run URL so commit links respect the
// actual server (including GitHub Enterprise). Falls back to the run URL.
function repoBaseUrl(runUrl) {
  if (!runUrl) return '';
  return runUrl.replace(/\/actions\/runs\/.*$/, '');
}

function renderStarted({ headSha, runUrl, command, startedAt }) {
  return [
    COMMENT_MARKER,
    reportHeading('🔄 Review fix started'),
    '',
    `- Command: \`${command || '/fix-review'}\``,
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    `- Started: ${startedAt}`,
    '',
    '_Gathering review feedback and applying fixes — summary posts here when done._',
    '',
    '<!-- updated: ' + startedAt + ' -->',
  ].join('\n');
}

function renderWorking({ headSha, runUrl, command, updatedAt }) {
  return [
    COMMENT_MARKER,
    reportHeading('🔧 Applying review fixes…'),
    '',
    `- Command: \`${command || '/fix-review'}\``,
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    '_Claude is editing the branch and validating; results post here shortly._',
    '',
    '<!-- updated: ' + updatedAt + ' -->',
  ].join('\n');
}

function renderSkipped({ headSha, runUrl, reason, skipReasonCode, updatedAt }) {
  const lines = [COMMENT_MARKER, reportHeading('⏭️ Review fix skipped')];
  if (skipReasonCode) {
    // Machine-readable skip reason so auto-cover-review can tell skips that
    // stay ineligible under automation mode apart from transient ones (a stale
    // dispatch, or a manual-only class that automation mode re-allows) without
    // pattern-matching the quoted prose below. Strip any comment-closing
    // sequence so a future code containing `-->` (or `--!>`) cannot break the
    // HTML comment boundary and corrupt the rendered markdown. Codes are
    // hardcoded today; this enforces that contract at the renderer.
    const safeCode = String(skipReasonCode).replace(/--!?>/g, '');
    lines.push(`<!-- fix-review-skip-reason: ${safeCode} -->`);
  }
  lines.push(
    '',
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(
      reason ||
        'PR is not eligible (cross-repo, draft, closed, merged, automation-authored, or stale dispatch).',
    ),
    '',
    'Re-run `/fix-review` (or `/address-review`) on an eligible open same-repo PR.',
    '',
    '<!-- updated: ' + updatedAt + ' -->',
  );
  return lines.join('\n');
}

function renderNoChanges({ headSha, runUrl, command, structured, updatedAt }) {
  const lines = [
    COMMENT_MARKER,
    reportHeading('ℹ️ No changes needed'),
    '',
    `- Command: \`${command || '/fix-review'}\``,
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    'Review feedback had no actionable findings to fix.',
  ];
  if (structured && structured.summary) {
    lines.push('', quoteBlock(structured.summary));
  }
  lines.push('', '<!-- updated: ' + updatedAt + ' -->');
  return lines.join('\n');
}

function renderProtectedPathsOnly({
  headSha,
  runUrl,
  command,
  structured,
  allowProtected,
  updatedAt,
}) {
  const changed = Array.isArray(structured.changed_files)
    ? structured.changed_files
    : [];
  // With the opt-in active, only the gate/push actions the workflow executes
  // remain protected — and those can never be auto-committed from this flow,
  // so there is no label/flag remedy to offer, only a manual commit.
  const explanation = isTrue(allowProtected)
    ? 'The agent produced a fix, but every edit was to `validate-pr-gate` or ' +
      '`commit-and-push` under `.github/actions/` — the two actions this ' +
      'workflow executes with credentials after the agent runs. Those stay ' +
      'force-restored even with protected edits allowed, so the edits were ' +
      'discarded, nothing was pushed, and the review findings are NOT ' +
      'resolved. Apply the fix manually with a normal commit to the PR branch.'
    : 'The agent produced a fix, but every edit was under `.github/actions/**`, ' +
      'which this workflow force-restores before committing (the agent may not ' +
      'modify the composite actions the workflow itself executes). The edits ' +
      'were discarded, nothing was pushed, and the review findings are NOT ' +
      'resolved.';
  const lines = [
    COMMENT_MARKER,
    reportHeading('⚠️ Fix limited to protected paths — not pushed'),
    '',
    `- Command: \`${command || '/fix-review'}\``,
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(explanation),
  ];
  if (!isTrue(allowProtected)) {
    lines.push(
      '',
      'To let the workflow deliver this fix without manual edits, either:',
      '- comment `/fix-review --allow` (one-shot, re-runs immediately), or',
      '- add the `allow-protected-edits` label to this PR (persists until ' +
        'removed, also covers automation re-runs), then comment `/fix-review`.',
      '',
      'Either way `.github/actions/` becomes committable except the gate and ' +
        'push actions the workflow itself executes, and the result still goes ' +
        'through the CI gate and re-review.',
    );
  }
  if (structured.summary) {
    lines.push('', quoteBlock(structured.summary));
  }
  if (changed.length > 0) {
    lines.push(
      '',
      `Attempted changes (${changed.length}):`,
      ...changed.map((f) => `- ${f}`),
    );
  }
  lines.push('', '<!-- updated: ' + updatedAt + ' -->');
  return lines.join('\n');
}

function renderPushRejected({
  headSha,
  runUrl,
  command,
  structured,
  pushFailureReason,
  updatedAt,
}) {
  const changed = Array.isArray(structured.changed_files)
    ? structured.changed_files
    : [];
  const copy = pushRejectedCopy(pushFailureReason);
  const lines = [
    COMMENT_MARKER,
    reportHeading(copy.heading),
    '',
    `- Command: \`${command || '/fix-review'}\``,
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(copy.message),
  ];
  if (changed.length > 0) {
    lines.push(
      '',
      `Attempted changes (${changed.length}):`,
      ...changed.map((f) => `- ${f}`),
    );
  }
  lines.push('', '<!-- updated: ' + updatedAt + ' -->');
  return lines.join('\n');
}

function pushRejectedCopy(pushFailureReason) {
  if (pushFailureReason === 'workflow-permission') {
    return {
      heading: '🚫 Push rejected (workflow permission)',
      message:
        'The fix touched a workflow file under `.github/workflows/**`, and GitHub rejected the active push credential for workflow-file updates. Verify the run used the intended `GH_PAT` and that the token or App installation is current with workflow-file write access, then re-run `/fix-review`.',
    };
  }

  if (!pushFailureReason || pushFailureReason === 'non-fast-forward') {
    return {
      heading: '🚫 Push rejected (non-fast-forward)',
      message:
        'The branch advanced while the fix ran (likely a concurrent push), so the ' +
        'commit could not be pushed without overwriting history. The workflow never ' +
        'force-pushes. Re-run `/fix-review` to reapply on the latest head.',
    };
  }

  return {
    heading: '🚫 Push rejected (push failed)',
    message:
      'The push to the branch failed; the exact git error is in the run log. The workflow never force-pushes. Resolve the underlying error, then re-run `/fix-review`.',
  };
}

function renderValidationFailed({
  headSha,
  runUrl,
  command,
  structured,
  gateOutcomes = {},
  updatedAt,
}) {
  const changed = Array.isArray(structured.changed_files)
    ? structured.changed_files
    : [];
  const lines = [
    COMMENT_MARKER,
    reportHeading('⚠️ Validation failed — fixes not pushed'),
    '',
    `- Command: \`${command || '/fix-review'}\``,
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(
      'The CI-matching gate did not pass, so the changes were NOT pushed. ' +
        'Fix the failing check and re-run `/fix-review`.',
    ),
    '',
    // Dual-block: the agent's self-reported checks (may be inaccurate) beside
    // the workflow gate's real outcomes (authoritative). The push verdict is
    // driven by the gate alone, never the agent self-report.
    renderGateSummary({
      agentValidation: structured.validation,
      gateOutcomes,
    }),
  ];
  if (changed.length > 0) {
    lines.push(
      '',
      `Attempted changes (${changed.length}):`,
      ...changed.map((f) => `- ${f}`),
    );
  }
  lines.push('', '<!-- updated: ' + updatedAt + ' -->');
  return lines.join('\n');
}

function renderFailed({ headSha, runUrl, failReason, updatedAt }) {
  const reason = failReason || 'The fix agent did not complete successfully.';
  return [
    COMMENT_MARKER,
    reportHeading('❌ Review fix failed'),
    '',
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(reason),
    '',
    'Re-run `/fix-review` after addressing the failure.',
    '',
    '<!-- updated: ' + updatedAt + ' -->',
  ].join('\n');
}

function renderCancelled({ headSha, runUrl, updatedAt }) {
  return [
    COMMENT_MARKER,
    reportHeading('🚫 Review fix cancelled'),
    '',
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
    '',
    quoteBlock(
      'The run did not finish — it was cancelled, most likely by the job timeout ' +
        'or by a newer `/fix-review` superseding it.',
    ),
    '',
    'Re-run `/fix-review` to retry.',
    '',
    '<!-- updated: ' + updatedAt + ' -->',
  ].join('\n');
}

function renderComplete({
  structured,
  numTurns,
  headSha,
  runUrl,
  command,
  commitSha,
  commitUrl,
  automergeDisabled,
  protectedReverted,
  allowProtected,
  updatedAt,
}) {
  const changed = Array.isArray(structured.changed_files)
    ? structured.changed_files
    : [];
  const addressed = Array.isArray(structured.findings_addressed)
    ? structured.findings_addressed
    : [];
  const skipped = Array.isArray(structured.findings_skipped)
    ? structured.findings_skipped
    : [];
  const lines = [
    COMMENT_MARKER,
    reportHeading('✅ Review fixes applied'),
    '',
    `- Command: \`${command || '/fix-review'}\``,
    `- Head SHA: \`${shortSha(headSha)}\``,
    `- Run: ${runUrl || '_n/a_'}`,
  ];
  if (commitSha && commitUrl) {
    lines.push(`- Commit: [${String(commitSha).slice(0, 12)}](${commitUrl})`);
  }
  lines.push('');
  if (structured.summary) {
    lines.push(quoteBlock(structured.summary), '');
  }
  lines.push(`**Changed files (${changed.length}):**`);
  if (changed.length > 0) {
    lines.push('<details><summary>paths</summary>', '');
    changed.forEach((f) => lines.push(`- ${f}`));
    lines.push('', '</details>');
  }
  if (addressed.length > 0) {
    lines.push('', `**Findings addressed (${addressed.length}):**`);
    addressed.forEach((f) =>
      lines.push(`- \`${f.file}\` — ${f.change || '(no detail)'}`),
    );
  }
  if (skipped.length > 0) {
    lines.push('', `**Findings skipped (${skipped.length}):**`);
    skipped.forEach((f) =>
      lines.push(`- \`${f.file}\` — ${f.reason || '(no reason)'}`),
    );
  }
  // Mixed-edit case: the pushed commit is real, but edits under the
  // force-restored protected paths were reverted before it — say so, or a
  // "✅ applied" summary silently hides a discarded part of the fix.
  if (isTrue(protectedReverted)) {
    lines.push(
      '',
      isTrue(allowProtected)
        ? '> ⚠️ **Part of the fix was reverted before commit:** edits to ' +
            '`validate-pr-gate` or `commit-and-push` under `.github/actions/` ' +
            'were discarded — the workflow executes those with credentials ' +
            'after the agent runs, so they are never auto-committable. Apply ' +
            'that part manually.'
        : '> ⚠️ **Part of the fix was reverted before commit:** edits under ' +
            '`.github/actions/**` were discarded (force-restored protected ' +
            'path). To let a re-run deliver them, comment `/fix-review ' +
            '--allow` (one-shot) or add the `allow-protected-edits` label and ' +
            'comment `/fix-review`.',
    );
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
      '> ⚠️ **Auto-merge was disabled** so this bot commit is re-reviewed. ' +
        'Re-approve to merge.',
    );
  }
  lines.push('<!-- updated: ' + updatedAt + ' -->');
  return lines.join('\n');
}

// Pick the finished-state body from the outcome flags. Order matters: a Claude
// hard-failure is surfaced even if the (possibly clean) tree validates; a gate
// failure beats a non-fast-forward push; only a clean, pushed run is "complete".
function resolveFinishedBody({
  structured,
  numTurns,
  headSha,
  runUrl,
  command,
  commitSha,
  commitUrl,
  automergeDisabled,
  failed,
  failReason,
  outcome,
  hasChanges,
  restoredOnly,
  protectedReverted,
  allowProtected,
  gatePassed,
  gateOutcomes = {},
  pushed,
  pushFailureReason,
}) {
  const updatedAt = new Date().toISOString();
  if (outcome === 'cancelled') {
    return renderCancelled({ headSha, runUrl, updatedAt });
  }
  if (isTrue(failed)) {
    return renderFailed({ headSha, runUrl, failReason, updatedAt });
  }
  // The agent's only edits were inside restore-protected paths, so they were
  // reverted and never pushed. This is NOT a clean no-op: the findings were
  // actionable, the workflow just cannot deliver the fix — say so instead of
  // claiming there was nothing to do.
  if (!isTrue(hasChanges) && isTrue(restoredOnly)) {
    return renderProtectedPathsOnly({
      headSha,
      runUrl,
      command,
      structured,
      allowProtected,
      updatedAt,
    });
  }
  // Clean no-op: the agent changed nothing, so the gate was skipped and there
  // is nothing to push (fix-review.yml detect-noop sets has_changes=false).
  if (!isTrue(hasChanges)) {
    return renderNoChanges({ headSha, runUrl, command, structured, updatedAt });
  }
  // The workflow gate ran and failed: show the real per-check outcomes
  // (authoritative) beside the agent's self-report, and do NOT push. The gate
  // — never the agent self-report — drives the push verdict.
  if (!isTrue(gatePassed)) {
    return renderValidationFailed({
      headSha,
      runUrl,
      command,
      structured,
      gateOutcomes,
      updatedAt,
    });
  }
  const changed = Array.isArray(structured.changed_files)
    ? structured.changed_files
    : [];
  if (!isTrue(pushed)) {
    if (changed.length > 0) {
      return renderPushRejected({
        headSha,
        runUrl,
        command,
        structured,
        pushFailureReason,
        updatedAt,
      });
    }
    return renderNoChanges({ headSha, runUrl, command, structured, updatedAt });
  }
  return renderComplete({
    structured,
    numTurns,
    headSha,
    runUrl,
    command,
    commitSha,
    commitUrl,
    automergeDisabled,
    protectedReverted,
    allowProtected,
    updatedAt,
  });
}

function main() {
  const repo = getRepoSlug();
  const prNumber = Number(getArg('--pr', getArg('--pr-number')));
  const headSha = getArg('--head-sha');
  const runUrl = getArg('--run-url');
  const command = getArg('--command');
  const mode = getArg('--mode', 'complete');

  if (!prNumber) {
    throw new Error('--pr (pull request number) is required.');
  }

  const structured = parseStructuredOutput(
    process.env.STRUCTURED_OUTPUT || getArg('--structured-output'),
  );
  const commitSha = getArg('--commit-sha');
  const commitUrl =
    commitSha && runUrl ? `${repoBaseUrl(runUrl)}/commit/${commitSha}` : '';

  let body;
  const now = new Date().toISOString();
  switch (mode) {
    case 'started':
      body = renderStarted({ headSha, runUrl, command, startedAt: now });
      break;
    case 'working':
      body = renderWorking({ headSha, runUrl, command, updatedAt: now });
      break;
    case 'skipped':
      body = renderSkipped({
        headSha,
        runUrl,
        reason: getArg('--reason'),
        skipReasonCode: getArg('--skip-reason-code'),
        updatedAt: now,
      });
      break;
    default:
      body = resolveFinishedBody({
        structured,
        numTurns: getArg('--num-turns'),
        headSha,
        runUrl,
        command,
        commitSha,
        commitUrl,
        automergeDisabled: getArg('--automerge-disabled'),
        failed: getArg('--failed'),
        failReason: getArg('--fail-reason'),
        outcome: getArg('--outcome'),
        hasChanges: getArg('--has-changes'),
        restoredOnly: getArg('--restored-only'),
        protectedReverted: getArg('--protected-reverted'),
        allowProtected: getArg('--allow-protected'),
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
        pushed: getArg('--pushed'),
        pushFailureReason: getArg('--push-failure-reason'),
      });
  }

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
  reportHeading,
  isTrue,
  repoBaseUrl,
  renderStarted,
  renderWorking,
  renderSkipped,
  renderNoChanges,
  renderProtectedPathsOnly,
  renderPushRejected,
  renderValidationFailed,
  renderFailed,
  renderCancelled,
  renderComplete,
  resolveFinishedBody,
};
