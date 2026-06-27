/* eslint-disable @typescript-eslint/no-require-imports */
// Fetches every per-PR context object the auto-cover-review job needs, with
// bounded concurrency, and writes the same per-PR JSON files the bash loop
// consumes (`pr-<n>-{pr,comments,attempts,review-comments,reviews,commits,
// fix-review-runs,statuses,check-runs}.json` + a `pr-<n>-head-sha` text file).
//
// Replaces a sequential bash loop that issued ~8 gh calls per PR. The repo-wide
// fix-review run list is fetched once and written into every PR's context.
//
// Error policy: commit status / check-run lookups legitimately return "no data"
// (HTTP 404) for fresh commits and are mapped to []. Rate-limit (403/429), 5xx,
// and network failures are rethrown so the workflow fails loudly instead of
// silently masking the missing data as empty (which would skew the coverage
// decision toward "no blocker").

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const AUTO_COVER_MARKER = '<!-- auto-cover-review-summary -->';
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_FIX_REVIEW_WORKFLOW = 'fix-review.yml';
const DEFAULT_RUN_LIMIT = 50;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--repo':
        args.repo = argv[++i];
        break;
      case '--out-dir':
        args.outDir = argv[++i];
        break;
      case '--prs-file':
        args.prsFile = argv[++i];
        break;
      case '--pr-number':
        args.prNumber = argv[++i];
        break;
      case '--concurrency':
        args.concurrency = argv[++i];
        break;
      case '--fix-review-workflow':
        args.fixReviewWorkflow = argv[++i];
        break;
      default:
        break;
    }
  }
  return args;
}

function readPrList({ prsFile, prNumber }) {
  if (prNumber) return [String(prNumber)];
  if (!prsFile) return [];
  return fs
    .readFileSync(prsFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isMissingResponse(stderr) {
  // A fresh commit with no statuses/check-runs, or a PR that closed between the
  // list and the fetch, returns HTTP 404 — that is expected, not a failure.
  return /HTTP 404/i.test(String(stderr ?? ''));
}

// Default fetcher: shells out to `gh api`. Returns parsed JSON, or null when the
// resource legitimately does not exist (HTTP 404). Rethrows rate-limit / 5xx /
// network errors with the gh stderr surfaced.
function createGhFetcher() {
  return function fetchJson(apiPath, { jq, paginate = false } = {}) {
    return new Promise((resolve, reject) => {
      const args = ['api', apiPath];
      if (paginate) args.push('--paginate');
      if (jq) args.push('--jq', jq);
      execFile(
        'gh',
        args,
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env },
        (err, stdout, stderr) => {
          if (err) {
            if (isMissingResponse(stderr)) return resolve(null);
            const wrapped = new Error(
              `gh api ${apiPath} failed: ${String(stderr || err.message).trim()}`,
            );
            wrapped.cause = err;
            return reject(wrapped);
          }
          const body = String(stdout ?? '').trim();
          if (!body) return resolve(jq ? null : []);
          try {
            resolve(JSON.parse(body));
          } catch (parseErr) {
            const wrapped = new Error(`gh api ${apiPath} returned non-JSON`);
            wrapped.cause = parseErr;
            reject(wrapped);
          }
        },
      );
    });
  };
}

// Default PR fetcher: shells out to `gh pr view --json` so the pr.json written
// for each PR has the EXACT shape the evaluators expect (incl. `files` and
// `isCrossRepository`, which the REST `pulls` endpoint omits). Fails loudly on
// error (a PR that closed between the list and the view aborts the scan, which
// matches the previous bash `gh pr view` behaviour under `set -e`).
function createViewPull() {
  const fields =
    'number,title,url,state,mergedAt,isDraft,headRefName,headRefOid,baseRefName,author,labels,files,isCrossRepository';
  return function viewPull(prNumber) {
    return new Promise((resolve, reject) => {
      execFile(
        'gh',
        ['pr', 'view', String(prNumber), '--json', fields],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env },
        (err, stdout, stderr) => {
          if (err) {
            const wrapped = new Error(
              `gh pr view ${prNumber} failed: ${String(stderr || err.message).trim()}`,
            );
            wrapped.cause = err;
            return reject(wrapped);
          }
          try {
            resolve(JSON.parse(String(stdout ?? '').trim() || '{}'));
          } catch (parseErr) {
            const wrapped = new Error(
              `gh pr view ${prNumber} returned non-JSON`,
            );
            wrapped.cause = parseErr;
            reject(wrapped);
          }
        },
      );
    });
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  const cap = Math.max(1, Number(limit) || 1);
  let cursor = 0;
  async function runSlot() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(cap, items.length) }, () => runSlot()),
  );
  return results;
}

function extractAttempts(comments = []) {
  return comments.filter((comment) =>
    String(comment.body ?? '').includes(AUTO_COVER_MARKER),
  );
}

function normalizeHeadSha(pr = {}) {
  return pr.headRefOid ?? pr.head?.sha ?? pr.headSha ?? '';
}

function commitTimestamp(commit = {}) {
  return commit.commit?.committer?.date ?? commit.commit?.author?.date ?? '';
}

async function fetchFixReviewRuns(fetchJson, repo, workflow, limit) {
  const data = await fetchJson(
    `repos/${repo}/actions/workflows/${workflow}/runs?per_page=${limit}`,
  );
  // hasActiveFixReviewRun() reads displayTitle/display_title + status.
  return data?.workflow_runs ?? [];
}

async function fetchPrContext({ fetchJson, viewPull, repo, prNumber }) {
  const [pr, comments, reviewComments, reviews, commits] = await Promise.all([
    viewPull(prNumber),
    fetchJson(`repos/${repo}/issues/${prNumber}/comments`, { paginate: true }),
    fetchJson(`repos/${repo}/pulls/${prNumber}/comments`, { paginate: true }),
    fetchJson(`repos/${repo}/pulls/${prNumber}/reviews`, { paginate: true }),
    fetchJson(`repos/${repo}/pulls/${prNumber}/commits`, { paginate: true }),
  ]);
  const commentList = comments ?? [];
  const headSha = normalizeHeadSha(pr);
  let statuses = [];
  let checkRuns = [];
  let headCommittedAt = '';
  if (headSha) {
    const commitPayload = await fetchJson(`repos/${repo}/commits/${headSha}`);
    headCommittedAt = commitTimestamp(commitPayload ?? {});
    const statusPayload = await fetchJson(
      `repos/${repo}/commits/${headSha}/status`,
    );
    statuses = statusPayload?.statuses ?? [];
    const checkPayload = await fetchJson(
      `repos/${repo}/commits/${headSha}/check-runs`,
      { paginate: true },
    );
    checkRuns = checkPayload?.check_runs ?? [];
  }
  return {
    pr: { ...(pr ?? {}), headCommittedAt },
    comments: commentList,
    attempts: extractAttempts(commentList),
    reviewComments: reviewComments ?? [],
    reviews: reviews ?? [],
    commits: commits ?? [],
    statuses,
    checkRuns,
    headSha,
  };
}

function writeContextFiles(outDir, prNumber, ctx, fixReviewRuns) {
  const prefix = path.join(outDir, `pr-${prNumber}`);
  fs.writeFileSync(`${prefix}-pr.json`, JSON.stringify(ctx.pr));
  fs.writeFileSync(`${prefix}-comments.json`, JSON.stringify(ctx.comments));
  fs.writeFileSync(`${prefix}-attempts.json`, JSON.stringify(ctx.attempts));
  fs.writeFileSync(
    `${prefix}-review-comments.json`,
    JSON.stringify(ctx.reviewComments),
  );
  fs.writeFileSync(`${prefix}-reviews.json`, JSON.stringify(ctx.reviews));
  fs.writeFileSync(`${prefix}-commits.json`, JSON.stringify(ctx.commits));
  fs.writeFileSync(
    `${prefix}-fix-review-runs.json`,
    JSON.stringify(fixReviewRuns),
  );
  fs.writeFileSync(`${prefix}-statuses.json`, JSON.stringify(ctx.statuses));
  fs.writeFileSync(`${prefix}-check-runs.json`, JSON.stringify(ctx.checkRuns));
  fs.writeFileSync(`${prefix}-head-sha`, ctx.headSha);
}

async function fetchAutoCoverContext({
  repo,
  prs,
  outDir,
  fetchJson,
  viewPull,
  concurrency = DEFAULT_CONCURRENCY,
  fixReviewWorkflow = DEFAULT_FIX_REVIEW_WORKFLOW,
  runLimit = DEFAULT_RUN_LIMIT,
} = {}) {
  if (!repo) throw new Error('--repo is required.');
  if (!outDir) throw new Error('--out-dir is required.');
  const list = (prs ?? []).map((value) => String(value).trim()).filter(Boolean);
  fs.mkdirSync(outDir, { recursive: true });

  if (list.length === 0) {
    const manifest = {
      repo,
      fetched_at: new Date().toISOString(),
      prs: [],
      ok: [],
      failed: [],
      count: 0,
    };
    fs.writeFileSync(path.join(outDir, 'prs-to-evaluate.txt'), '');
    fs.writeFileSync(
      path.join(outDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
    return manifest;
  }

  const fetcher = fetchJson || createGhFetcher();
  const viewPr = viewPull || createViewPull();
  const fixReviewRuns = await fetchFixReviewRuns(
    fetcher,
    repo,
    fixReviewWorkflow,
    runLimit,
  );

  // Per-PR failures (e.g. a transient 5xx on one commit-status lookup) are
  // isolated: the failed PR is skipped and recorded, but the rest of the scan
  // completes. Only a systemic failure — the shared fix-review-runs fetch
  // (above) or EVERY PR failing — aborts the job so the scan retries next cycle
  // instead of running on empty data.
  const results = await mapWithConcurrency(
    list,
    concurrency,
    async (prNumber) => {
      try {
        const ctx = await fetchPrContext({
          fetchJson: fetcher,
          viewPull: viewPr,
          repo,
          prNumber,
        });
        writeContextFiles(outDir, prNumber, ctx, fixReviewRuns);
        return { pr: prNumber, ok: true };
      } catch (error) {
        return {
          pr: prNumber,
          ok: false,
          error: String(error?.message || error),
        };
      }
    },
  );

  const ok = results.filter((r) => r.ok).map((r) => r.pr);
  const failed = results
    .filter((r) => !r.ok)
    .map(({ pr, error }) => ({ pr, error }));

  if (list.length > 0 && ok.length === 0) {
    throw new Error(
      `fetch-auto-cover-context: all ${list.length} PR(s) failed; aborting. ` +
        `Last error: ${failed[failed.length - 1]?.error ?? 'unknown'}`,
    );
  }

  // The bash dispatch loop iterates only the successfully fetched PRs.
  fs.writeFileSync(
    path.join(outDir, 'prs-to-evaluate.txt'),
    ok.length > 0 ? `${ok.join('\n')}\n` : '',
  );
  for (const { pr, error } of failed) {
    console.warn(`PR #${pr}: fetch failed, skipping — ${error}`);
  }

  const manifest = {
    repo,
    fetched_at: new Date().toISOString(),
    prs: list,
    ok,
    failed,
    count: list.length,
  };
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  return manifest;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo || process.env.GITHUB_REPOSITORY;
  const outDir = args.outDir;
  const prs = readPrList(args);
  if (!repo) throw new Error('--repo (or GITHUB_REPOSITORY) is required.');
  if (!outDir) throw new Error('--out-dir is required.');
  const manifest = await fetchAutoCoverContext({
    repo,
    prs,
    outDir,
    concurrency: Number(args.concurrency || DEFAULT_CONCURRENCY),
    fixReviewWorkflow: args.fixReviewWorkflow || DEFAULT_FIX_REVIEW_WORKFLOW,
  });
  process.stdout.write(JSON.stringify(manifest, null, 2));
}

module.exports = {
  AUTO_COVER_MARKER,
  DEFAULT_CONCURRENCY,
  DEFAULT_FIX_REVIEW_WORKFLOW,
  createGhFetcher,
  createViewPull,
  isMissingResponse,
  mapWithConcurrency,
  extractAttempts,
  normalizeHeadSha,
  commitTimestamp,
  fetchFixReviewRuns,
  fetchPrContext,
  writeContextFiles,
  fetchAutoCoverContext,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
