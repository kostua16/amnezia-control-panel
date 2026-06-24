/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const { KILO_MARKER, isKiloUser } = require('./lib/kilo.cjs');

const DEFAULT_CONTEXT = 'pr-flow/kilo-review';
const DEFAULT_WAIT_MINUTES = 30;

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function readJson(filePath, fallback) {
  if (!filePath) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function asDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function itemTime(item = {}) {
  return (
    asDate(item.updated_at) ||
    asDate(item.updatedAt) ||
    asDate(item.submitted_at) ||
    asDate(item.submittedAt) ||
    asDate(item.created_at) ||
    asDate(item.createdAt) ||
    new Date(0)
  );
}

function sortNewest(items) {
  return [...items].sort((a, b) => itemTime(b) - itemTime(a));
}

function normalizeHeadSha(pr = {}) {
  return pr.headSha ?? pr.headRefOid ?? pr.head?.sha ?? '';
}

function normalizeCommitId(item = {}) {
  return item.commit_id ?? item.commit?.oid ?? item.commit?.sha ?? null;
}

function isCurrentHead(item, headSha) {
  const commitId = normalizeCommitId(item);
  return Boolean(headSha && commitId && commitId === headSha);
}

function isKiloSummary(comment = {}) {
  return (
    isKiloUser(comment.user ?? comment.author ?? {}) &&
    String(comment.body ?? '').includes(KILO_MARKER)
  );
}

function summaryVerdict(body) {
  const text = String(body ?? '');
  if (
    /\b\d+\s+Issues?\s+Found\b/i.test(text) ||
    /Address before merge/i.test(text)
  ) {
    return 'blocked';
  }
  if (/No Issues Found/i.test(text)) return 'passed';
  return null;
}

function isKiloCheck(check = {}) {
  const fields = [
    check.name,
    check.app?.slug,
    check.app?.name,
    check.workflowName,
    check.workflow_name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return fields.includes('kilo');
}

function checkSkipped(checkRuns = []) {
  return checkRuns.some((check) => {
    if (!isKiloCheck(check)) return false;
    return ['cancelled', 'skipped'].includes(
      String(check.conclusion ?? '').toLowerCase(),
    );
  });
}

function latestPendingStatus(statuses = [], context = DEFAULT_CONTEXT) {
  return sortNewest(
    statuses.filter(
      (status) =>
        status.context === context &&
        String(status.state ?? '').toLowerCase() === 'pending',
    ),
  )[0];
}

function ageMinutes(startedAt, now) {
  const started = asDate(startedAt);
  const current = asDate(now) ?? new Date();
  if (!started) return 0;
  return Math.max(0, (current - started) / 60000);
}

function currentKiloReview(reviews = [], headSha) {
  return sortNewest(
    reviews.filter((review) => {
      const user = review.user ?? review.author ?? {};
      return isKiloUser(user) && isCurrentHead(review, headSha);
    }),
  )[0];
}

function currentKiloSummary({
  comments = [],
  reviews = [],
  headSha,
  pendingStatus = null,
}) {
  const latestReview = currentKiloReview(reviews, headSha);
  const latestSummary = sortNewest(comments.filter(isKiloSummary))[0];
  if (!latestSummary) return null;

  if (isCurrentHead(latestSummary, headSha)) return latestSummary;
  if (!latestReview) {
    return pendingStatus && itemTime(latestSummary) >= itemTime(pendingStatus)
      ? latestSummary
      : null;
  }

  return itemTime(latestSummary) >= itemTime(latestReview)
    ? latestSummary
    : null;
}

function hasCurrentInlineIssues(reviewComments = [], headSha) {
  return reviewComments.some((comment) => {
    const user = comment.user ?? comment.author ?? {};
    return (
      isKiloUser(user) &&
      isCurrentHead(comment, headSha) &&
      String(comment.body ?? '').trim().length > 0
    );
  });
}

function evaluateExternalReview({
  pr = {},
  comments = [],
  reviewComments = [],
  reviews = [],
  checkRuns = [],
  statuses = [],
  now = new Date().toISOString(),
  waitMinutes = DEFAULT_WAIT_MINUTES,
  context = DEFAULT_CONTEXT,
} = {}) {
  const headSha = normalizeHeadSha(pr);
  const pendingStatus = latestPendingStatus(statuses, context);

  if (hasCurrentInlineIssues(reviewComments, headSha)) {
    return {
      state: 'blocked',
      reason: 'Kilo reported current-head inline review issues.',
    };
  }

  const summary = currentKiloSummary({
    comments,
    reviews,
    headSha,
    pendingStatus,
  });
  const verdict = summaryVerdict(summary?.body);
  if (verdict === 'passed') {
    return {
      state: 'passed',
      reason: 'Kilo reported no current-head issues.',
    };
  }
  if (verdict === 'blocked') {
    return {
      state: 'blocked',
      reason: 'Kilo reported current-head issues.',
    };
  }

  if (checkSkipped(checkRuns)) {
    return {
      state: 'skipped',
      reason: 'Kilo review check was cancelled or skipped.',
    };
  }

  const pendingAge = ageMinutes(
    pendingStatus?.created_at ?? pendingStatus?.createdAt,
    now,
  );
  if (pendingStatus && pendingAge >= Number(waitMinutes)) {
    return {
      state: 'skipped',
      reason: `No current-head Kilo reply after ${waitMinutes} minutes.`,
    };
  }

  return {
    state: 'pending',
    reason: 'Waiting for current-head Kilo review signal.',
  };
}

function main() {
  const result = evaluateExternalReview({
    pr: readJson(getArg('--pr-file'), {}),
    comments: readJson(getArg('--comments-file'), []),
    reviewComments: readJson(getArg('--review-comments-file'), []),
    reviews: readJson(getArg('--reviews-file'), []),
    checkRuns: readJson(getArg('--check-runs-file'), []),
    statuses: readJson(getArg('--statuses-file'), []),
    now: getArg('--now', new Date().toISOString()),
    waitMinutes: Number(getArg('--wait-minutes', DEFAULT_WAIT_MINUTES)),
  });
  process.stdout.write(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_CONTEXT,
  DEFAULT_WAIT_MINUTES,
  KILO_MARKER,
  evaluateExternalReview,
  isKiloSummary,
  isKiloUser,
  summaryVerdict,
};
