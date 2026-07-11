/* eslint-disable @typescript-eslint/no-require-imports */
// Thin wrapper around shared sticky-comment.cjs for the pr-improve workflow.
// Builds the improvement analysis body and delegates to upsertComment().
const { getRepoSlug, upsertComment } = require('./lib/sticky-comment.cjs');

const COMMENT_MARKER = '<!-- pr-improve -->';

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

  const analysis = JSON.parse(process.env.STRUCTURED_OUTPUT || '{}');
  const planningPrUrl = process.env.PLANNING_PR_URL || '';
  const quickArtifactPath = process.env.QUICK_ARTIFACT_PATH || '';

  const body = [
    COMMENT_MARKER,
    '## Claude+GSD Improvement Intake',
    '',
    `- Summary: ${analysis.summary || 'No summary returned.'}`,
    `- Quick tasks: ${(analysis.quick_tasks || []).length}`,
    `- Phase suggestions: ${(analysis.phase_suggestions || []).length}`,
    `- Quick artifact: \`${quickArtifactPath}\``,
    planningPrUrl
      ? `- Planning intake PR: ${planningPrUrl}`
      : '- Planning intake PR: not created',
    '- Execution: merge the planning PR; the GSD planning executor imports merged artifacts four times per day.',
  ].join('\n');

  const repo = getRepoSlug();
  upsertComment({ repo, prNumber, marker: COMMENT_MARKER, body });
}

if (require.main === module) {
  main();
}

module.exports = { COMMENT_MARKER };
