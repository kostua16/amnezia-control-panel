/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const { evaluatePrPolicy } = require('./evaluate-pr-policy.cjs');

const HARD_REPAIR_BLOCKERS = [
  'do-not-merge',
  'deps-review-manual',
  'deps-review-blocked',
];
const MANUAL_REPAIR_CLASS_BLOCKERS = [
  'automation',
  'automation-fix',
  'dependabot',
  'planning',
  'trusted-planning',
];
const MANUAL_REPAIR_CLASS_ALLOWLIST = ['gsd-planning-execution'];

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function readJson(filePath, fallback = null) {
  if (!filePath) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function labelNames(labels = []) {
  return labels
    .map((label) => (typeof label === 'string' ? label : label?.name))
    .filter(Boolean)
    .map(String);
}

function normalizeBoolean(value) {
  return value === true || String(value ?? '').toLowerCase() === 'true';
}

function firstReason(reasons) {
  return reasons.find(Boolean) ?? null;
}

function allowsManualRepairClass(prClass) {
  const normalized = String(prClass ?? 'other').toLowerCase();
  return (
    MANUAL_REPAIR_CLASS_ALLOWLIST.includes(normalized) ||
    !MANUAL_REPAIR_CLASS_BLOCKERS.includes(normalized)
  );
}

function evaluateFixReviewEligibility({
  pr = {},
  policy = {},
  files = null,
  expectedHeadSha = '',
  automationReviewLoop = false,
} = {}) {
  const evaluated = evaluatePrPolicy(pr, policy, files);
  const labels = labelNames(evaluated.labels ?? pr.labels);
  const hardBlockers = labels.filter((label) =>
    HARD_REPAIR_BLOCKERS.includes(label),
  );
  const state = String(pr.state ?? '').toLowerCase();
  const stale = Boolean(expectedHeadSha && expectedHeadSha !== pr.headRefOid);
  const automationLoop = normalizeBoolean(automationReviewLoop);
  const manualClassBlocked =
    !automationLoop && !allowsManualRepairClass(evaluated.pr_class);

  const reason = firstReason([
    state !== 'open' ? 'PR is not open.' : null,
    pr.mergedAt ? 'PR is already merged.' : null,
    evaluated.same_repo === false ? 'PR is cross-repository.' : null,
    evaluated.is_draft === true ? 'PR is draft.' : null,
    stale ? 'PR head SHA is stale.' : null,
    hardBlockers.length > 0
      ? `Hard repair blocker present: ${hardBlockers.join(', ')}.`
      : null,
    manualClassBlocked
      ? `PR class "${evaluated.pr_class}" requires automation review loop.`
      : null,
  ]);
  const eligible = reason === null;

  return {
    eligible,
    reason,
    pr_number: pr.number,
    head_ref: pr.headRefName ?? '',
    head_sha: pr.headRefOid ?? '',
    auto_merge_enabled: Boolean(pr.autoMergeRequest?.enabledAt),
    automation_review_loop: automationLoop,
    pr_class: evaluated.pr_class,
    manual_only: evaluated.manual_only,
    merge_blocked_reason: evaluated.blocked_reason,
    merge_blocking_labels: evaluated.blocking_labels_present ?? [],
    repair_blocking_labels: hardBlockers,
  };
}

function main() {
  const result = evaluateFixReviewEligibility({
    pr: readJson(getArg('--pr-file'), {}),
    policy: readJson(
      getArg('--policy-file', '.github/workflows/policy.json'),
      {},
    ),
    files: readJson(getArg('--files-file'), null),
    expectedHeadSha: getArg('--head-sha', ''),
    automationReviewLoop: getArg('--automation-review-loop', 'false'),
  });
  process.stdout.write(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  HARD_REPAIR_BLOCKERS,
  MANUAL_REPAIR_CLASS_ALLOWLIST,
  MANUAL_REPAIR_CLASS_BLOCKERS,
  allowsManualRepairClass,
  evaluateFixReviewEligibility,
  labelNames,
};
