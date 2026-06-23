/* eslint-disable @typescript-eslint/no-require-imports */
// Computes rebase eligibility for rebase-pr.yml. It reuses the merge-eligibility
// facts already normalized by evaluate-pr-policy.cjs (same_repo, is_draft, the
// label set) but applies a NARROWER gate than merge: a rebase is a branch
// refresh, not a merge, so only the `do-not-merge` label blocks it. Labels that
// block merge (manual-only / needs-review / ai-review-concerns /
// security-review-concerns) do NOT block a rebase. evaluate-pr-policy's
// `eligible` output is deliberately NOT used here.
//
// The head-SHA stale guard rejects a dispatch whose expected head no longer
// matches the PR head, so a queued rebase cannot land on a moved branch.
const fs = require('node:fs');

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function evaluateRebaseEligibility(pr, ev, expectedHeadSha) {
  const labels = Array.isArray(ev?.labels) ? ev.labels : [];
  const hasDoNotMerge = labels.includes('do-not-merge');
  const expected = String(expectedHeadSha ?? '');
  const staleHead = expected.length > 0 && expected !== pr.headRefOid;
  const isOpen = String(pr.state ?? '').toLowerCase() === 'open';
  const isMerged = Boolean(pr.mergedAt);
  const isCrossRepo = ev?.same_repo !== true;
  const isDraft = ev?.is_draft === true;
  const hasHead = Boolean(pr.headRefName) && Boolean(pr.headRefOid);
  const autoMergeEnabled = Boolean(
    pr.autoMergeRequest && pr.autoMergeRequest.enabledAt,
  );

  const eligible =
    isOpen &&
    !isMerged &&
    !isCrossRepo &&
    !isDraft &&
    !hasDoNotMerge &&
    hasHead &&
    !staleHead;

  let reason = null;
  if (!eligible) {
    if (staleHead) {
      reason = `expected head ${expected} does not match current ${pr.headRefOid}`;
    } else if (!isOpen) {
      reason = `PR state is ${pr.state ?? 'unknown'}`;
    } else if (isMerged) {
      reason = 'PR is merged';
    } else if (isCrossRepo) {
      reason = 'PR is cross-repository';
    } else if (isDraft) {
      reason = 'PR is draft';
    } else if (hasDoNotMerge) {
      reason = 'do-not-merge label present';
    } else if (!hasHead) {
      reason = 'head ref is missing';
    }
  }

  return {
    head_ref: pr.headRefName ?? '',
    head_sha: pr.headRefOid ?? '',
    base_ref: pr.baseRefName ?? '',
    auto_merge_enabled: autoMergeEnabled,
    do_not_merge: hasDoNotMerge,
    stale_head: staleHead,
    eligible,
    reason,
  };
}

function main() {
  const prFile = getArg('--pr-file');
  const evalFile = getArg('--eval-file');
  const expectedHeadSha =
    getArg('--expected-head-sha') ?? process.env.EXPECTED_HEAD_SHA ?? '';
  if (!prFile || !evalFile) {
    throw new Error('--pr-file and --eval-file are required');
  }
  const pr = JSON.parse(fs.readFileSync(prFile, 'utf8'));
  const ev = JSON.parse(fs.readFileSync(evalFile, 'utf8'));
  const result = evaluateRebaseEligibility(pr, ev, expectedHeadSha);
  for (const [key, value] of Object.entries(result)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

module.exports = { evaluateRebaseEligibility };

if (require.main === module) {
  main();
}
