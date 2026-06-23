/* eslint-disable @typescript-eslint/no-require-imports */
// Collects actionable review feedback for the /fix-review workflow into a single
// markdown bundle the agent reads. Drops resolved and outdated threads at the
// data layer (reviews on removed lines are not actionable), and strips slash
// commands / bot / sticky-summary comments so only real findings reach Claude.
// Uses the shared exec helpers so there is one source for gh-shellout logic.
const fs = require('node:fs');
const { run, runJson } = require('./lib/sticky-comment.cjs');

const STICKY_MARKERS = [
  '<!-- code-review-summary -->',
  '<!-- pr-size-guard -->',
  '<!-- pr-flow-orchestration -->',
  '<!-- fix-review-summary -->',
  '<!-- rebase-pr-summary -->',
];
const SLASH_COMMAND = /^\s*\/[\w-]+/;
const MAX_DIFF_CHARS = 30000;

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function parseRepo(repo) {
  const [owner, name] = String(repo).split('/');
  if (!owner || !name) {
    throw new Error(`--repo must be "owner/name", got "${repo}"`);
  }
  return { owner, name };
}

function isBot(user = {}) {
  return (
    String(user.type ?? '') === 'Bot' ||
    /\[bot\]$/.test(String(user.login ?? ''))
  );
}

// Drop noise: bots, slash-command comments (e.g. the /fix-review trigger itself),
// and other automation sticky summaries.
function isNoiseComment(comment) {
  if (isBot(comment.user)) return true;
  const body = String(comment.body ?? '');
  if (SLASH_COMMAND.test(body)) return true;
  return STICKY_MARKERS.some((marker) => body.includes(marker));
}

function fetchReviewThreads(owner, name, pr) {
  // Values are interpolated because they come from validated repo/pr inputs.
  // GraphQL fields are whitespace-separated (semicolons are NOT valid here).
  const query =
    `query { repository(owner: "${owner}", name: "${name}") {` +
    ` pullRequest(number: ${pr}) {` +
    ` reviewThreads(first: 100) { nodes { isResolved isOutdated path line` +
    ` comments(first: 50) { nodes { body author { login } } } } } } }`;
  const data = runJson('gh', ['api', 'graphql', '-f', `query=${query}`], {});
  if (data?.errors) {
    console.warn(
      'review-feedback GraphQL errors:',
      JSON.stringify(data.errors),
    );
  }
  const threads =
    data?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  return threads
    .filter((t) => !t.isResolved && !t.isOutdated)
    .flatMap((t) =>
      (t.comments?.nodes ?? []).map((c) => ({
        path: t.path,
        line: t.line ?? null,
        author: c.author?.login ?? 'unknown',
        body: String(c.body ?? '').trim(),
      })),
    )
    .filter((c) => c.body.length > 0);
}

function fetchReviews(repo, pr) {
  return runJson(
    'gh',
    ['api', `repos/${repo}/pulls/${pr}/reviews`, '--paginate'],
    [],
  )
    .filter((r) => r.body && String(r.body).trim().length > 0)
    .map((r) => ({
      state: r.state,
      author: r.user?.login ?? 'unknown',
      body: String(r.body).trim(),
    }));
}

function fetchComments(repo, pr) {
  return runJson(
    'gh',
    ['api', `repos/${repo}/issues/${pr}/comments`, '--paginate'],
    [],
  )
    .filter((c) => !isNoiseComment(c))
    .map((c) => ({
      author: c.user?.login ?? 'unknown',
      body: String(c.body ?? '').trim(),
    }))
    .filter((c) => c.body.length > 0);
}

function fetchDiff(repo, pr) {
  const diff = run('gh', ['pr', 'diff', String(pr), '--repo', repo], {
    allowFailure: true,
    fallback: '',
  });
  if (!diff) return '_diff unavailable_';
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  return `${diff.slice(0, MAX_DIFF_CHARS)}\n\n…(diff truncated at ${MAX_DIFF_CHARS} chars; use \`git diff\` for the rest)`;
}

function formatBundle({ threads, reviews, comments, diff }) {
  const sections = ['# Review feedback for /fix-review', ''];
  sections.push('## Unresolved, non-outdated review threads');
  if (threads.length === 0) {
    sections.push('_None._');
  } else {
    threads.forEach((t) => {
      sections.push(
        `- \`${t.path}\`:${t.line ?? '-'} (@${t.author}): ${t.body}`,
      );
    });
  }
  sections.push('', '## Review submissions');
  if (reviews.length === 0) {
    sections.push('_None._');
  } else {
    reviews.forEach((r) => {
      sections.push(`- (@${r.author}, ${r.state}): ${r.body}`);
    });
  }
  sections.push('', '## PR comments (non-command, human)');
  if (comments.length === 0) {
    sections.push('_None._');
  } else {
    comments.forEach((c) => {
      sections.push(`- (@${c.author}): ${c.body}`);
    });
  }
  sections.push('', '## Diff', '', '```diff', diff, '```', '');
  return sections.join('\n');
}

function main() {
  const repo = getArg('--repo') || process.env.GITHUB_REPOSITORY;
  const pr = Number(getArg('--pr', getArg('--pr-number')));
  const out = getArg('--out');
  if (!repo || !pr || !out) {
    throw new Error('--repo, --pr, and --out are required.');
  }
  const { owner, name } = parseRepo(repo);
  const bundle = formatBundle({
    threads: fetchReviewThreads(owner, name, pr),
    reviews: fetchReviews(repo, pr),
    comments: fetchComments(repo, pr),
    diff: fetchDiff(repo, pr),
  });
  fs.writeFileSync(out, bundle, 'utf8');
  console.log(`Wrote review feedback to ${out}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  STICKY_MARKERS,
  SLASH_COMMAND,
  MAX_DIFF_CHARS,
  parseRepo,
  isBot,
  isNoiseComment,
  formatBundle,
};
