/* eslint-disable @typescript-eslint/no-require-imports */
// Collects actionable review feedback for the /fix-review workflow into a single
// markdown bundle the agent reads. Drops resolved and outdated threads at the
// data layer (reviews on removed lines are not actionable), and strips slash
// commands / bot / sticky-summary comments so only real findings reach Claude.
// Uses the shared exec helpers so there is one source for gh-shellout logic.
const fs = require('node:fs');
const { run } = require('./lib/sticky-comment.cjs');
const { KILO_MARKER, isKiloUser } = require('./lib/kilo.cjs');

const STICKY_MARKERS = [
  '<!-- code-review-summary -->',
  '<!-- pr-size-guard -->',
  '<!-- pr-flow-orchestration -->',
  '<!-- fix-review-summary -->',
  '<!-- rebase-pr-summary -->',
];
const SLASH_COMMAND = /^\s*\/[\w-]+/;
const MAX_DIFF_CHARS = 30000;
const REVIEW_THREAD_FETCH_FAILURE_POLICY = 'fail-closed';

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

function isTrustedKiloSummary(comment) {
  return (
    isKiloUser(comment.user) && String(comment.body ?? '').includes(KILO_MARKER)
  );
}

// Drop noise: bots, slash-command comments (e.g. the /fix-review trigger itself),
// and other automation sticky summaries.
function isNoiseComment(comment) {
  if (isTrustedKiloSummary(comment)) return false;
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
    ` comments(first: 50) { nodes { body author { login } } } } } } } }`;
  // Intentionally fail closed here. Missing review-thread data can make
  // /fix-review report a false no-op while unresolved inline Kilo findings
  // still exist, so transient gh/GraphQL failures must abort collection.
  const output = run('gh', ['api', 'graphql', '-f', `query=${query}`], {
    retry: true,
  });
  const data = JSON.parse(output);
  if (data?.errors) {
    throw new Error(
      `review-feedback GraphQL errors: ${JSON.stringify(data.errors)}`,
    );
  }
  const threads =
    data?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  return extractReviewThreads(threads);
}

function extractReviewThreads(threads = [], { authorFilter } = {}) {
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
    .filter((c) => c.body.length > 0)
    .filter((c) => !authorFilter || c.author === authorFilter);
}

function failClosedJson(command, args) {
  const output = run(command, args, { retry: true });
  return JSON.parse(output);
}

function fetchReviews(repo, pr) {
  // Fail-closed: missing review data can mask actionable findings.
  return failClosedJson('gh', [
    'api',
    `repos/${repo}/pulls/${pr}/reviews`,
    '--paginate',
  ])
    .filter((r) => r.body && String(r.body).trim().length > 0)
    .map((r) => ({
      state: r.state,
      author: r.user?.login ?? 'unknown',
      body: String(r.body).trim(),
    }));
}

function fetchComments(repo, pr) {
  // Fail-closed: missing comment data can mask actionable findings.
  return failClosedJson('gh', [
    'api',
    `repos/${repo}/issues/${pr}/comments`,
    '--paginate',
  ])
    .filter((c) => !isNoiseComment(c))
    .map((c) => ({
      author: c.user?.login ?? 'unknown',
      body: String(c.body ?? '').trim(),
    }))
    .filter((c) => c.body.length > 0);
}

function fetchDiff(repo, pr, maxChars = MAX_DIFF_CHARS) {
  const limit =
    Number.isFinite(maxChars) && maxChars > 0 ? maxChars : MAX_DIFF_CHARS;
  const diff = run('gh', ['pr', 'diff', String(pr), '--repo', repo], {
    retry: true,
    allowFailure: true,
    fallback: '',
  });
  if (!diff) return '_diff unavailable_';
  if (diff.length <= limit) return diff;
  return `${diff.slice(0, limit)}\n\n…(diff truncated at ${limit} chars; use \`git diff\` for the rest)`;
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

function hasActionableFeedback({ threads = [], reviews = [], comments = [] }) {
  return threads.length > 0 || reviews.length > 0 || comments.length > 0;
}

function sectionBody(bundle, heading) {
  const marker = `## ${heading}`;
  const start = bundle.indexOf(marker);
  if (start === -1) return '';
  const rest = bundle.slice(start + marker.length);
  const next = rest.search(/\n## /);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function sectionHasFeedback(bundle, heading) {
  const normalized = sectionBody(bundle, heading).replace(/\s+/g, ' ').trim();
  return normalized.length > 0 && normalized !== '_None._';
}

function bundleHasActionableFeedback(bundle) {
  const markdown = String(bundle ?? '');
  return (
    sectionHasFeedback(markdown, 'Unresolved, non-outdated review threads') ||
    sectionHasFeedback(markdown, 'Review submissions') ||
    sectionHasFeedback(markdown, 'PR comments (non-command, human)')
  );
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
  REVIEW_THREAD_FETCH_FAILURE_POLICY,
  parseRepo,
  isBot,
  isTrustedKiloSummary,
  isNoiseComment,
  formatBundle,
  hasActionableFeedback,
  bundleHasActionableFeedback,
  failClosedJson,
  extractReviewThreads,
  fetchReviewThreads,
  fetchReviews,
  fetchComments,
  fetchDiff,
};
