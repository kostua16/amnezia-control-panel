/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const { evaluatePrPolicy } = require('./evaluate-pr-policy.cjs');

const FIX_REVIEW_COMMIT =
  /^fix\(review\): address review feedback via \/fix-review/m;
const DEFAULT_MAX_ATTEMPTS = 3;

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function readJson(filePath, fallback) {
  if (!filePath) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeLabels(pr = {}) {
  return (pr.labels ?? []).map((label) =>
    typeof label === 'string' ? label : label.name,
  );
}

function normalizeHeadSha(pr = {}) {
  return pr.headSha ?? pr.headRefOid ?? pr.head?.sha ?? '';
}

function normalizeHeadRef(pr = {}) {
  return pr.headRefName ?? pr.head?.ref ?? '';
}

function isOpen(pr = {}) {
  return String(pr.state ?? '').toUpperCase() === 'OPEN' && !pr.mergedAt;
}

function hasAny(labels, names) {
  return names.some((name) => labels.includes(name));
}

function countFixReviewCommits(commits = []) {
  return commits.filter((commit) => {
    const message =
      commit.message ??
      commit.commit?.message ??
      commit.commitMessageHeadline ??
      '';
    return FIX_REVIEW_COMMIT.test(String(message));
  }).length;
}

function countRecordedAttempts(attempts = []) {
  return attempts.filter(Boolean).length;
}

const FIX_REVIEW_NOOP_MARKER = '<!-- fix-review-summary -->';
const FIX_REVIEW_NOOP_TEXT = 'No changes needed';

function hasFixReviewNoOp(comments = []) {
  return comments.some(
    (c) =>
      String(c.body ?? '').includes(FIX_REVIEW_NOOP_MARKER) &&
      String(c.body ?? '').includes(FIX_REVIEW_NOOP_TEXT),
  );
}

function hasActiveFixReviewRun(runs = [], prNumber, headSha) {
  return runs.some((run) => {
    const title = run.displayTitle ?? run.display_title ?? '';
    const status = String(run.status ?? '').toLowerCase();
    return (
      title.includes(`PR #${prNumber}`) &&
      (!headSha || title.includes(headSha)) &&
      ['queued', 'in_progress', 'pending', 'waiting', 'requested'].includes(
        status,
      )
    );
  });
}

function evaluateAutoCoverReview({
  pr = {},
  policy = {},
  files = null,
  externalReview = null,
  commits = [],
  attempts = [],
  fixReviewRuns = [],
  comments = [],
  expectedHeadSha = '',
  maxAttempts = policy.maxAutoReviewFixAttempts ?? DEFAULT_MAX_ATTEMPTS,
} = {}) {
  const labels = normalizeLabels(pr);
  const headSha = normalizeHeadSha(pr);
  const stale = expectedHeadSha && expectedHeadSha !== headSha;

  if (!isOpen(pr)) {
    return { should_run: false, reason: 'PR is not open.' };
  }
  if (pr.isDraft || pr.draft) {
    return { should_run: false, reason: 'PR is draft.' };
  }
  if (stale) {
    return { should_run: false, reason: 'PR head SHA is stale.' };
  }

  const evaluated = evaluatePrPolicy(pr, policy, files);
  if (evaluated.same_repo === false) {
    return { should_run: false, reason: 'PR is cross-repository.' };
  }
  if (labels.includes('do-not-merge')) {
    return { should_run: false, reason: 'do-not-merge is present.' };
  }
  if (hasAny(labels, ['deps-review-manual', 'deps-review-blocked'])) {
    return {
      should_run: false,
      reason: 'Dependency review blocker is present.',
    };
  }

  const hasInternalBlock = hasAny(labels, [
    'ai-review-concerns',
    'security-review-concerns',
  ]);
  const hasExternalBlock = externalReview?.state === 'blocked';
  if (!hasInternalBlock && !hasExternalBlock) {
    return {
      should_run: false,
      reason: 'No review blocker is present.',
    };
  }

  const attemptsCount = Math.max(
    countFixReviewCommits(commits),
    countRecordedAttempts(attempts),
  );
  if (Number(maxAttempts) > 0 && attemptsCount >= Number(maxAttempts)) {
    return {
      should_run: false,
      reason: `auto-cover attempt cap reached (${attemptsCount}/${maxAttempts}).`,
      attempt_count: attemptsCount,
      max_attempts: Number(maxAttempts),
    };
  }

  if (hasFixReviewNoOp(comments)) {
    return {
      should_run: false,
      reason:
        'Latest fix-review confirmed false positives — no actionable findings.',
    };
  }

  if (hasActiveFixReviewRun(fixReviewRuns, pr.number, headSha)) {
    return {
      should_run: false,
      reason: 'A current fix-review run is already active.',
    };
  }

  return {
    should_run: true,
    reason: null,
    pr_number: pr.number,
    head_sha: headSha,
    head_ref_name: normalizeHeadRef(pr),
    pr_class: evaluated.pr_class,
    manual_only: evaluated.manual_only,
    attempt_count: attemptsCount,
    max_attempts: Number(maxAttempts),
  };
}

function main() {
  const policy = readJson(
    getArg('--policy-file', '.github/workflows/policy.json'),
    {},
  );
  const result = evaluateAutoCoverReview({
    pr: readJson(getArg('--pr-file'), {}),
    policy,
    files: readJson(getArg('--files-file'), null),
    externalReview: readJson(getArg('--external-review-file'), null),
    comments: readJson(getArg('--comments-file'), []),
    commits: readJson(getArg('--commits-file'), []),
    attempts: readJson(getArg('--attempts-file'), []),
    fixReviewRuns: readJson(getArg('--fix-review-runs-file'), []),
    expectedHeadSha: getArg('--head-sha', ''),
    maxAttempts: Number(
      getArg(
        '--max-attempts',
        policy.maxAutoReviewFixAttempts ?? DEFAULT_MAX_ATTEMPTS,
      ),
    ),
  });
  process.stdout.write(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  FIX_REVIEW_COMMIT,
  FIX_REVIEW_NOOP_MARKER,
  FIX_REVIEW_NOOP_TEXT,
  countFixReviewCommits,
  evaluateAutoCoverReview,
  hasActiveFixReviewRun,
  hasFixReviewNoOp,
};
