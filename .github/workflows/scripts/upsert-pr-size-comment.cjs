/* eslint-disable @typescript-eslint/no-require-imports */
const {
  run,
  getRepoSlug,
  listComments,
  upsertComment,
  findExistingComment: findExistingCommentByMarker,
} = require('./lib/sticky-comment.cjs');

const COMMENT_MARKER = '<!-- pr-size-guard -->';
const LARGE_PR_LABEL = 'large-pr';
// size/XL boundary — aligns with the size buckets in .github/workflows/policy.json
// (XS<=20 / S<=100 / M<=300 / L<=800 / XL>800). "Large PR" fires iff the PR is size/XL.
const DEFAULT_THRESHOLD = 800;

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function toNumber(value) {
  if (value == null) return null; // Number(null)===0 is a JS footgun that breaks ?? fallbacks
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildCommentBody(total, files) {
  return [
    COMMENT_MARKER,
    `> **Large PR** (${total} lines across ${files} files)`,
    '>',
    '> Consider splitting into smaller, focused PRs for easier review.',
  ].join('\n');
}

// Preserve the historical single-arg signature expected by callers/tests;
// the marker is this script's own.
const findExistingComment = (comments) =>
  findExistingCommentByMarker(comments, COMMENT_MARKER);

function upsertLargePrComment({ repo, prNumber, total, files }) {
  upsertComment({
    repo,
    prNumber,
    marker: COMMENT_MARKER,
    body: buildCommentBody(total, files),
  });
}

function deleteLargePrComment({ repo, prNumber }) {
  const existing = findExistingComment(listComments(repo, prNumber));
  if (!existing) {
    return;
  }

  run('gh', [
    'api',
    '-X',
    'DELETE',
    `repos/${repo}/issues/comments/${existing.id}`,
  ]);
}

function shouldWarnLargePr(total, threshold = DEFAULT_THRESHOLD) {
  return total > threshold;
}

function syncLargePrLabel({ repo, prNumber, shouldWarn }) {
  const command = shouldWarn ? '--add-label' : '--remove-label';
  run(
    'gh',
    ['pr', 'edit', String(prNumber), '--repo', repo, command, LARGE_PR_LABEL],
    { allowFailure: true },
  );
}

function main() {
  const repo = getRepoSlug();
  const prNumber = toNumber(getArg('--pr', getArg('--pr-number')));
  const total = toNumber(getArg('--total'));
  const files = toNumber(getArg('--files'));
  const threshold = toNumber(getArg('--threshold')) ?? DEFAULT_THRESHOLD;

  if (prNumber === null || total === null || files === null) {
    throw new Error('--pr, --total, and --files are required numeric flags.');
  }

  const warn = shouldWarnLargePr(total, threshold);
  if (warn) {
    upsertLargePrComment({ repo, prNumber, total, files });
  } else {
    deleteLargePrComment({ repo, prNumber });
  }

  syncLargePrLabel({ repo, prNumber, shouldWarn: warn });
}

if (require.main === module) {
  main();
}

module.exports = {
  COMMENT_MARKER,
  DEFAULT_THRESHOLD,
  LARGE_PR_LABEL,
  buildCommentBody,
  findExistingComment,
  shouldWarnLargePr,
  toNumber,
};
