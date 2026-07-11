/* eslint-disable @typescript-eslint/no-require-imports */
// Thin wrapper around shared sticky-comment.cjs for the planning-intake-repair
// workflow.  Builds the repair status body and delegates to upsertComment().
const { getRepoSlug, upsertComment } = require('./lib/sticky-comment.cjs');

const COMMENT_MARKER = '<!-- planning-intake-repair -->';

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

  const body = [
    COMMENT_MARKER,
    '## Planning Intake Repair',
    '',
    `- Source PR: #${process.env.SOURCE_PR_NUMBER || ''}`,
    `- Namespace: \`${process.env.PHASE_NAMESPACE || ''}.x\``,
    `- Quick artifact: \`${process.env.QUICK_ARTIFACT_PATH || ''}\``,
    `- PR body updated: ${process.env.BODY_UPDATED || 'false'}`,
    `- Branch pushed: ${process.env.PUSHED || 'false'}`,
  ].join('\n');

  const repo = getRepoSlug();
  upsertComment({ repo, prNumber, marker: COMMENT_MARKER, body });
}

if (require.main === module) {
  main();
}

module.exports = { COMMENT_MARKER };
