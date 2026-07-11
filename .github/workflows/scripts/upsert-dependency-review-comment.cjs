/* eslint-disable @typescript-eslint/no-require-imports */
// Thin wrapper around shared sticky-comment.cjs for the dependency-review
// workflow.  Builds the dependency-review signal body and delegates to
// upsertComment() so the find/create/replace-then-delete logic lives in one
// place.
const { getRepoSlug, upsertComment } = require('./lib/sticky-comment.cjs');

const COMMENT_MARKER = '<!-- dependency-review-signal -->';

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function main() {
  const prNumber = Number(getArg('--pr', getArg('--pr-number')));
  if (!prNumber) {
    throw new Error('--pr (pull request number) is required.');
  }

  const review =
    JSON.parse(process.env.STRUCTURED_OUTPUT || '{}');
  const body = [
    COMMENT_MARKER,
    '## Dependency Review Signal',
    '',
    `- Verdict: **${review.verdict || 'manual'}**`,
    `- Update type: **${review.update_type || 'unknown'}**`,
    `- Summary: ${review.summary || 'No summary returned.'}`,
    `- Notes: ${review.risk_notes || 'No additional notes returned.'}`,
  ].join('\n');

  const repo = getRepoSlug();
  upsertComment({ repo, prNumber, marker: COMMENT_MARKER, body });
}

if (require.main === module) {
  main();
}

module.exports = { COMMENT_MARKER };
