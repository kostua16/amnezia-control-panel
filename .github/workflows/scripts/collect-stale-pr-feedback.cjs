/* eslint-disable @typescript-eslint/no-require-imports */
// Builds a single multi-PR review-feedback bundle for stale-PR consolidation.
// For each source PR it carries forward the same evidence the single-PR
// /fix-review collector gathers (unresolved threads, review submissions,
// non-noise comments, diff) plus a changed-file list, so the consolidation
// agent addresses review debt instead of replaying the source diff blindly.
//
// Reuses the data fetchers exported from collect-review-feedback.cjs so the gh
// shellout + noise-filter logic has one source of truth. formatMultiPrBundle is
// pure and unit-tested; main() is thin IO glue.
const fs = require('node:fs');
const {
  parseRepo,
  fetchReviewThreads,
  fetchReviews,
  fetchComments,
  fetchDiff,
} = require('./collect-review-feedback.cjs');
const { runJson } = require('./lib/sticky-comment.cjs');

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function formatMultiPrBundle({ prs }) {
  const lines = ['# Stale PR consolidation feedback', ''];
  lines.push('## Source PRs', '');
  for (const p of prs) {
    const labels = Array.isArray(p.labels) ? p.labels.join(', ') : '';
    lines.push(`- #${p.number}: ${p.title ?? ''}`);
    lines.push(`  - url: ${p.url || '_n/a_'}`);
    lines.push(`  - labels: ${labels || '(none)'}`);
    lines.push(`  - head ref: ${p.headRef || '(unknown)'}`);
    lines.push(`  - mergeability: ${p.mergeable || 'unknown'}`);
  }

  lines.push('', '## Unresolved review threads by PR', '');
  let threadsFound = false;
  for (const p of prs) {
    const threads = Array.isArray(p.threads) ? p.threads : [];
    if (threads.length === 0) continue;
    threadsFound = true;
    lines.push(`### PR #${p.number}`, '');
    for (const t of threads) {
      lines.push(`- \`${t.path}\`:${t.line ?? '-'} (@${t.author}): ${t.body}`);
    }
    lines.push('');
  }
  if (!threadsFound) lines.push('_None._', '');

  lines.push('## Review submissions by PR', '');
  let reviewsFound = false;
  for (const p of prs) {
    const reviews = Array.isArray(p.reviews) ? p.reviews : [];
    if (reviews.length === 0) continue;
    reviewsFound = true;
    lines.push(`### PR #${p.number}`, '');
    for (const r of reviews) {
      lines.push(`- (@${r.author}, ${r.state}): ${r.body}`);
    }
    lines.push('');
  }
  if (!reviewsFound) lines.push('_None._', '');

  lines.push('## Diffs by PR', '');
  for (const p of prs) {
    lines.push(`### PR #${p.number}`, '');
    const files = Array.isArray(p.files) ? p.files : [];
    if (files.length > 0) {
      lines.push(`Changed files (${files.length}):`, '');
      for (const f of files) lines.push(`- ${f}`);
      lines.push('');
    }
    lines.push('```diff', p.diff || '_diff unavailable_', '```', '');
  }
  return lines.join('\n');
}

function gatherPr(repo, owner, name, number, maxDiffChars) {
  return {
    threads: fetchReviewThreads(owner, name, number),
    reviews: fetchReviews(repo, number),
    comments: fetchComments(repo, number),
    diff: fetchDiff(repo, number, maxDiffChars),
  };
}

function main() {
  const repo = getArg('--repo') || process.env.GITHUB_REPOSITORY;
  const prsArg = getArg('--prs', '');
  const out = getArg('--out');
  const maxDiffChars =
    Number(getArg('--max-diff-chars-per-pr', '0')) || undefined;
  if (!repo || !prsArg || !out) {
    throw new Error('--repo, --prs, and --out are required.');
  }
  const { owner, name } = parseRepo(repo);
  const numbers = String(prsArg)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  const prsData = numbers.map((number) => {
    const meta = runJson(
      'gh',
      [
        'pr',
        'view',
        String(number),
        '--repo',
        repo,
        '--json',
        'number,title,url,labels,headRefName,mergeable,files',
      ],
      {},
    );
    const gathered = gatherPr(repo, owner, name, number, maxDiffChars);
    return {
      number,
      title: meta.title,
      url: meta.url,
      labels: (meta.labels || []).map((l) => l.name),
      headRef: meta.headRefName,
      mergeable: meta.mergeable,
      files: (meta.files || []).map((f) => f.path).filter(Boolean),
      threads: gathered.threads,
      reviews: gathered.reviews,
      comments: gathered.comments,
      diff: gathered.diff,
    };
  });

  fs.writeFileSync(out, formatMultiPrBundle({ prs: prsData }), 'utf8');
  console.log(
    `Wrote stale PR feedback bundle for ${prsData.length} PRs to ${out}`,
  );
}

if (require.main === module) {
  main();
}

module.exports = { formatMultiPrBundle };
