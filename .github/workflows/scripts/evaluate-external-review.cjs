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

function normalizeHeadCommittedAt(pr = {}) {
  return (
    pr.headCommittedAt ??
    pr.head_commit?.timestamp ??
    pr.head?.commit?.committedDate ??
    pr.head?.commit?.committed_at ??
    null
  );
}

function normalizeCommitId(item = {}) {
  return item.commit_id ?? item.commit?.oid ?? item.commit?.sha ?? null;
}

function isCurrentHead(item, headSha) {
  const commitId = normalizeCommitId(item);
  return Boolean(headSha && commitId && commitId === headSha);
}

function isUpdatedAfterHead(item, headCommittedAt) {
  const updated = itemTime(item);
  const headTime = asDate(headCommittedAt);
  return Boolean(headTime && updated >= headTime);
}

function isKiloSummary(comment = {}) {
  return (
    isKiloUser(comment.user ?? comment.author ?? {}) &&
    String(comment.body ?? '').includes(KILO_MARKER)
  );
}

const KILO_HISTORY_MARKER = '<!-- kilo-review-history -->';
const KILO_SEVERITIES = ['CRITICAL', 'WARNING', 'SUGGESTION'];
const DEFAULT_BLOCKING_SEVERITIES = 'critical,warning';
const ISSUES_FOUND_RE = /\b(\d+)\s+Issues?\s+Found\b/gi;

// Which Kilo severities block `pr-flow/kilo-review`. Read from the
// KILO_BLOCKING_SEVERITIES env var (comma-separated, case-insensitive) so the
// orchestrator and Auto Cover share one setting. `all` restores the rule that
// every reported finding blocks; an unknown severity name also falls back to
// that rule, because a typo must never silently let findings through.
// Returns a Set of blocking severities, or null when every finding blocks.
function parseBlockingSeverities(value) {
  const raw = String(value ?? '').trim() || DEFAULT_BLOCKING_SEVERITIES;
  if (raw.toLowerCase() === 'all') return null;
  const names = raw
    .split(',')
    .map((name) => name.trim().toUpperCase())
    .filter(Boolean);
  if (
    names.length === 0 ||
    names.some((name) => !KILO_SEVERITIES.includes(name))
  ) {
    return null;
  }
  return new Set(names);
}

function resolveBlockingSeverities(value) {
  if (value === null || value instanceof Set) return value;
  return parseBlockingSeverities(value);
}

function currentSummaryText(body) {
  return String(body ?? '')
    .replace(/\r\n/g, '\n')
    .split(KILO_HISTORY_MARKER)[0];
}

// Reads the `| Severity | Count |` overview table of the current summary (the
// text before the history marker). Returns { CRITICAL, WARNING, SUGGESTION }
// only for exactly one complete table with the three known rows and numeric
// counts whose sum matches every `N Issues Found` total in the same text.
// Anything else returns null so the caller keeps treating the review as
// blocking.
function severityCounts(text) {
  const lines = String(text ?? '').split('\n');
  const headers = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) =>
      /^\s*\|\s*Severity\s*\|\s*Count\s*\|\s*$/i.test(line),
    );
  if (headers.length !== 1) return null;
  const start = headers[0].index;
  if (!/^\s*\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*$/.test(lines[start + 1] ?? '')) {
    return null;
  }
  const counts = {};
  for (let i = start + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*\|/.test(line)) break;
    const row = line.match(/^\s*\|\s*([A-Za-z]+)\s*\|\s*(\d+)\s*\|\s*$/);
    if (!row) return null;
    const name = row[1].toUpperCase();
    if (!KILO_SEVERITIES.includes(name) || name in counts) return null;
    counts[name] = Number(row[2]);
  }
  if (!KILO_SEVERITIES.every((name) => name in counts)) return null;
  const total = KILO_SEVERITIES.reduce((sum, name) => sum + counts[name], 0);
  for (const match of String(text).matchAll(ISSUES_FOUND_RE)) {
    if (Number(match[1]) !== total) return null;
  }
  return counts;
}

// Verdict of the current Kilo summary: 'passed' (No Issues Found), 'blocked',
// 'non-blocking' (findings exist but none has a blocking severity) or null (no
// verdict yet). With blockingSeverities `all`, every finding blocks.
function summaryVerdict(
  body,
  blockingSeverities = process.env.KILO_BLOCKING_SEVERITIES,
) {
  const text = currentSummaryText(body);
  if (
    /\b\d+\s+Issues?\s+Found\b/i.test(text) ||
    /Address before merge/i.test(text)
  ) {
    const blocking = resolveBlockingSeverities(blockingSeverities);
    if (blocking === null) return 'blocked';
    const counts = severityCounts(text);
    if (!counts) return 'blocked';
    const total = KILO_SEVERITIES.reduce((sum, name) => sum + counts[name], 0);
    // A consistent all-zero table is a clean review unless the summary still
    // asks for changes (`Address before merge`), in which case the evidence
    // contradicts itself and the review keeps blocking.
    if (total === 0) {
      return /Address before merge/i.test(text) ? 'blocked' : 'passed';
    }
    return KILO_SEVERITIES.some(
      (name) => blocking.has(name) && counts[name] > 0,
    )
      ? 'blocked'
      : 'non-blocking';
  }
  if (/No Issues Found/i.test(text)) return 'passed';
  return null;
}

// Severity of a Kilo inline comment from its leading `**SEVERITY:**` tag, or
// null for anything else (thread replies, unknown tags).
function inlineSeverity(body) {
  const match = String(body ?? '')
    .trim()
    .match(/^\*\*([A-Za-z]+):\*\*/);
  const name = match ? match[1].toUpperCase() : null;
  return name && KILO_SEVERITIES.includes(name) ? name : null;
}

function isBlockingInline(body, blocking) {
  if (blocking === null) return true;
  const severity = inlineSeverity(body);
  return severity === null || blocking.has(severity);
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
  headCommittedAt = null,
  pendingStatus = null,
}) {
  const latestReview = currentKiloReview(reviews, headSha);
  const latestSummary = sortNewest(comments.filter(isKiloSummary))[0];
  if (!latestSummary) return null;

  if (isCurrentHead(latestSummary, headSha)) return latestSummary;
  if (isUpdatedAfterHead(latestSummary, headCommittedAt)) return latestSummary;
  if (!latestReview) {
    return pendingStatus && itemTime(latestSummary) >= itemTime(pendingStatus)
      ? latestSummary
      : null;
  }

  return itemTime(latestSummary) >= itemTime(latestReview)
    ? latestSummary
    : null;
}

function currentInlineIssue(
  reviewComments = [],
  headSha,
  blockingSeverities = process.env.KILO_BLOCKING_SEVERITIES,
) {
  const blocking = resolveBlockingSeverities(blockingSeverities);
  return sortNewest(
    reviewComments.filter((comment) => {
      const user = comment.user ?? comment.author ?? {};
      // GitHub can remap a thread's displayed commit when the PR head moves.
      const reviewedCommit =
        comment.original_commit_id ?? normalizeCommitId(comment);
      // Non-blocking findings are dropped here, before the newest is picked,
      // so an older blocking finding cannot hide behind a newer suggestion.
      return (
        isKiloUser(user) &&
        headSha &&
        reviewedCommit === headSha &&
        String(comment.body ?? '').trim().length > 0 &&
        isBlockingInline(comment.body, blocking)
      );
    }),
  )[0];
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
  blockingSeverities = process.env.KILO_BLOCKING_SEVERITIES,
} = {}) {
  const blocking = resolveBlockingSeverities(blockingSeverities);
  const headSha = normalizeHeadSha(pr);
  const headCommittedAt = normalizeHeadCommittedAt(pr);
  const pendingStatus = latestPendingStatus(statuses, context);
  const inlineIssue = currentInlineIssue(reviewComments, headSha, blocking);

  const summary = currentKiloSummary({
    comments,
    reviews,
    headSha,
    headCommittedAt,
    pendingStatus,
  });
  const verdict = summaryVerdict(summary?.body, blocking);
  if (verdict === 'passed') {
    if (!inlineIssue || itemTime(summary) >= itemTime(inlineIssue)) {
      return {
        state: 'passed',
        reason: 'Kilo reported no current-head issues.',
      };
    }
  }
  // Unlike a clean summary, a suggestions-only summary never supersedes a
  // current-head blocking inline finding, whatever their timestamps: the two
  // disagree about the same head, so the blocking evidence wins.
  if (verdict === 'non-blocking' && !inlineIssue) {
    return {
      state: 'passed',
      reason: 'Kilo reported only suggestions.',
    };
  }

  if (inlineIssue) {
    return {
      state: 'blocked',
      reason: 'Kilo reported current-head inline review issues.',
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
  DEFAULT_BLOCKING_SEVERITIES,
  DEFAULT_CONTEXT,
  DEFAULT_WAIT_MINUTES,
  KILO_MARKER,
  KILO_SEVERITIES,
  evaluateExternalReview,
  currentInlineIssue,
  inlineSeverity,
  isKiloSummary,
  isKiloUser,
  parseBlockingSeverities,
  severityCounts,
  summaryVerdict,
};
