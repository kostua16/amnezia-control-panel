/* eslint-disable @typescript-eslint/no-require-imports */
// Thin wrapper around shared sticky-comment.cjs for the pr-finalizer workflow.
// Builds the finalizer status body and delegates to upsertComment().
const {
  getRepoSlug,
  listComments,
  findExistingComment,
  upsertComment,
} = require('./lib/sticky-comment.cjs');

const COMMENT_MARKER = '<!-- pr-finalizer -->';

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

  const decision = process.env.DECISION || '';
  const summary = process.env.SUMMARY || '';
  const applyStatus = process.env.APPLY_STATUS || 'not_requested';
  const applyDetails = process.env.APPLY_DETAILS || '';

  const lines = [COMMENT_MARKER, '## PR Finalizer', ''];

  lines.push(`- Status: **${decision}**`);
  lines.push(`- Summary: ${summary}`);

  if (decision === 'approve_and_enable_automerge') {
    lines.push(`- Apply result: **${applyStatus}**`);
    if (applyDetails) {
      lines.push(`- Apply details: ${applyDetails}`);
    }
  }

  const body = lines.join('\n');
  const repo = getRepoSlug();

  // Idempotency: skip if the existing comment already matches exactly.
  const existing = findExistingComment(
    listComments(repo, prNumber),
    COMMENT_MARKER,
  );
  if (existing?.body === body) {
    console.info('Finalizer comment already up to date.');
    return;
  }

  upsertComment({ repo, prNumber, marker: COMMENT_MARKER, body });
}

if (require.main === module) {
  main();
}

module.exports = { COMMENT_MARKER };
