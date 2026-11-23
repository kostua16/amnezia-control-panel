/* eslint-disable @typescript-eslint/no-require-imports */
// Fetches every per-PR context object the auto-cover-review job needs, with
// bounded concurrency, and writes the same per-PR JSON files the bash loop
// consumes (`pr-<n>-{pr,comments,attempts,review-comments,reviews,commits,
// fix-review-runs,statuses,check-runs}.json` + a `pr-<n>-head-sha` text file).
//
// Replaces a sequential bash loop that issued ~8 gh calls per PR. The repo-wide
// fix-review run list is fetched once and written into every PR's context.
//
// Quota: the seven per-PR REST lookups (issue comments, review comments,
// reviews, commits, head commit, combined status, check-runs) are replaced by
// ONE `gh api graphql` query per PR. GraphQL has its own rate-limit bucket, so
// a full scan now costs the shared 5000/h REST quota only the single repo-wide
// fix-review run listing. Results are mapped back to the REST field shapes the
// context consumers read, so the written files keep their contract. Narrow
// REST fallbacks remain for >100-item pages and for a head SHA that moved
// between `gh pr view` and the GraphQL query (both rare). Ops can force the
// legacy all-REST path without a revert via PR_FLOW_AUTO_COVER_SOURCE=rest
// (mirrors PR_FLOW_REVIEW_SOURCE); tests select it by injecting only
// `fetchJson`.
//
// Error policy: commit status / check-run lookups legitimately return "no data"
// (HTTP 404) for fresh commits and are mapped to []. Rate-limit (403/429), 5xx,
// and network failures are rethrown so the workflow fails loudly instead of
// silently masking the missing data as empty (which would skew the coverage
// decision toward "no blocker").

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

// Bot-login restoration (the `[bot]` suffix) is shared with the PR flow's
// GraphQL adapter so the two paths cannot drift on which logins count as apps.
const { toUser } = require('./lib/review-inputs-graphql.cjs');

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

// Single GraphQL query per PR replacing seven REST calls. Nested connections
// request 100 nodes; when a page overflows (>100 items) the caller falls back
// to the paginated REST endpoint for that list instead of silently truncating.
const PULL_REQUEST_CONTEXT_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      comments(first: 100) {
        pageInfo { hasNextPage }
        nodes { databaseId body createdAt updatedAt author { login __typename } }
      }
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          comments(first: 100) {
            pageInfo { hasNextPage }
            nodes {
              databaseId
              body
              path
              originalCommit { oid }
              commit { oid }
              createdAt
              updatedAt
              author { login __typename }
            }
          }
        }
      }
      reviews(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          databaseId
          body
          state
          submittedAt
          commit { oid }
          author { login __typename }
        }
      }
      commits(first: 100) {
        pageInfo { hasNextPage }
        nodes { commit { oid message authoredDate committedDate } }
      }
      headCommit: commits(last: 1) {
        nodes {
          commit {
            oid
            committedDate
            # StatusContext is a plain list (no pageInfo, so it cannot
            # overflow) and has no updatedAt field in the schema; REST
            # statuses' updated_at degrades to created_at, which the freshness
            # fallback already prefers. Check runs come from checkSuites
            # below, so legacy statuses and check runs never conflate.
            status {
              contexts {
                context
                state
                createdAt
                targetUrl
                description
              }
            }
            checkSuites(first: 20) {
              pageInfo { hasNextPage }
              nodes {
                app { slug name }
                checkRuns(first: 100) {
                  pageInfo { hasNextPage }
                  nodes { name status conclusion }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

// A 200 response can still carry top-level `errors` (partial data). Resolving
// it would let missing connections masquerade as [] and skew the coverage
// decision toward "no blocker" — reject so the per-PR failure policy applies.
function assertNoGraphqlErrors(response) {
  const errors = response?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0]?.message ?? 'unknown error';
    throw new Error(`gh api graphql returned errors: ${first}`);
  }
}

// GraphQL fetcher: shells out to `gh api graphql` (separate rate-limit bucket
// from REST). Resolves `data`, rejects with gh stderr on any error — including
// a 200 response carrying `errors` — so the per-PR isolation / abort policy
// applies exactly like the REST fetcher.
function createGraphqlFetcher() {
  return function graphql(query, variables = {}) {
    return new Promise((resolve, reject) => {
      const args = ['api', 'graphql'];
      for (const [key, value] of Object.entries(variables)) {
        args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
      }
      args.push('-f', `query=${query}`);
      execFile(
        'gh',
        args,
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env },
        (err, stdout, stderr) => {
          if (err) {
            const wrapped = new Error(
              `gh api graphql failed: ${String(stderr || err.message).trim()}`,
            );
            wrapped.cause = err;
            return reject(wrapped);
          }
          let parsed;
          try {
            parsed = JSON.parse(String(stdout ?? '').trim() || '{}');
          } catch (parseErr) {
            const wrapped = new Error('gh api graphql returned non-JSON');
            wrapped.cause = parseErr;
            return reject(wrapped);
          }
          try {
            assertNoGraphqlErrors(parsed);
          } catch (error) {
            return reject(error);
          }
          resolve(parsed?.data ?? null);
        },
      );
    });
  };
}

// REST renders app logins with the `[bot]` suffix (github-actions[bot],
// kilo-code-bot[bot]); GraphQL Bot nodes return the bare login. Consumers
// (extractAttempts, isKiloUser) match the REST spelling, so `toUser` from
// lib/review-inputs-graphql.cjs restores it — one shared implementation for
// both GraphQL paths.

// The mappers below rebuild the REST field names (snake_case, lowercase enums)
// the context files have always contained, so consumers keep their contract.
function mapIssueComments(nodes = []) {
  return nodes.map((node) => ({
    id: node.databaseId ?? null,
    body: node.body ?? '',
    user: toUser(node.author),
    created_at: node.createdAt ?? null,
    updated_at: node.updatedAt ?? null,
  }));
}

function mapReviewComments(threadNodes = []) {
  const out = [];
  for (const thread of threadNodes) {
    for (const node of thread?.comments?.nodes ?? []) {
      out.push({
        id: node.databaseId ?? null,
        body: node.body ?? '',
        path: node.path ?? null,
        commit_id: node.commit?.oid ?? null,
        original_commit_id: node.originalCommit?.oid ?? null,
        user: toUser(node.author),
        created_at: node.createdAt ?? null,
        updated_at: node.updatedAt ?? null,
      });
    }
  }
  return out;
}

function mapReviews(nodes = []) {
  return nodes.map((node) => ({
    id: node.databaseId ?? null,
    body: node.body ?? '',
    state: node.state ?? null,
    commit_id: node.commit?.oid ?? null,
    submitted_at: node.submittedAt ?? null,
    user: toUser(node.author),
  }));
}

function mapCommits(nodes = []) {
  return nodes.map((node) => ({
    sha: node.commit?.oid ?? '',
    commit: {
      message: node.commit?.message ?? '',
      author: { date: node.commit?.authoredDate ?? '' },
      committer: { date: node.commit?.committedDate ?? '' },
    },
  }));
}

function mapStatuses(statusPayload) {
  return (statusPayload?.contexts ?? []).map((context) => ({
    context: context.context ?? '',
    state: String(context.state ?? '').toLowerCase(),
    created_at: context.createdAt ?? null,
    updated_at: context.updatedAt ?? null,
    target_url: context.targetUrl ?? null,
    description: context.description ?? null,
  }));
}

function mapCheckRuns(suiteNodes = []) {
  const out = [];
  for (const suite of suiteNodes) {
    const app = suite?.app
      ? { slug: suite.app.slug ?? null, name: suite.app.name ?? null }
      : null;
    for (const run of suite?.checkRuns?.nodes ?? []) {
      out.push({
        name: run.name ?? '',
        status: run.status ? String(run.status).toLowerCase() : null,
        conclusion: run.conclusion
          ? String(run.conclusion).toLowerCase()
          : null,
        app,
      });
    }
  }
  return out;
}

function checkRunsOverflow(headNode) {
  const suites = headNode?.checkSuites;
  return (
    Boolean(suites?.pageInfo?.hasNextPage) ||
    (suites?.nodes ?? []).some(
      (suite) => suite?.checkRuns?.pageInfo?.hasNextPage,
    )
  );
}

// GraphQL-backed replacement for fetchPrContext: one query per PR (plus the
// existing `gh pr view`, itself GraphQL) instead of seven REST calls. Narrow
// REST fallbacks keep behavior identical when a connection page overflows or
// the head SHA moved between `gh pr view` and the query. Deliberately a
// separate query from lib/review-inputs-graphql.cjs (whose gh call must run
// synchronously and which throws to fall back wholesale): this path stays
// async for bounded concurrency, also fetches the commit list, and falls back
// per list.
async function fetchPrContextViaGraphql({
  graphql,
  fetchJson,
  viewPull,
  repo,
  prNumber,
}) {
  // Same guard as lib/review-inputs-graphql: `a/b/c` must not silently drop
  // segments, and a non-numeric PR must not reach GitHub as #NaN/#0.
  const repoParts = String(repo ?? '').split('/');
  if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) {
    throw new Error(`repo must be exactly owner/name, got "${repo}".`);
  }
  const [owner, name] = repoParts;
  const number = Number(prNumber);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`prNumber must be a positive integer, got "${prNumber}".`);
  }
  const [pr, data] = await Promise.all([
    viewPull(prNumber),
    graphql(PULL_REQUEST_CONTEXT_QUERY, { owner, name, number }),
  ]);
  const pull = data?.repository?.pullRequest ?? null;
  if (!pull) {
    throw new Error(`gh api graphql returned no pullRequest for #${prNumber}`);
  }
  const headSha = normalizeHeadSha(pr);
  const threads = pull.reviewThreads?.nodes ?? [];
  const headNode = pull.headCommit?.nodes?.[0]?.commit ?? null;
  const headFromQuery = Boolean(headSha) && headNode?.oid === headSha;

  const fallbacks = {
    comments: Boolean(pull.comments?.pageInfo?.hasNextPage),
    reviewComments:
      Boolean(pull.reviewThreads?.pageInfo?.hasNextPage) ||
      threads.some((thread) => thread?.comments?.pageInfo?.hasNextPage),
    reviews: Boolean(pull.reviews?.pageInfo?.hasNextPage),
    commits: Boolean(pull.commits?.pageInfo?.hasNextPage),
    checkRuns: headFromQuery && checkRunsOverflow(headNode),
  };

  const restList = (apiPath) =>
    fetchJson(apiPath, { paginate: true }).then((value) => value ?? []);

  async function resolveHead() {
    if (!headSha) return { headCommittedAt: '', statuses: [], checkRuns: [] };
    if (headFromQuery) {
      const checkRuns = fallbacks.checkRuns
        ? ((
            await fetchJson(`repos/${repo}/commits/${headSha}/check-runs`, {
              paginate: true,
            })
          )?.check_runs ?? [])
        : mapCheckRuns(headNode.checkSuites?.nodes ?? []);
      return {
        headCommittedAt: headNode.committedDate ?? '',
        statuses: mapStatuses(headNode.status),
        checkRuns,
      };
    }
    // Head moved mid-fetch (or query missed it): legacy REST trio, same as
    // fetchPrContext, including the 404 -> [] mapping for fresh commits.
    const [commitPayload, statusPayload, checkPayload] = await Promise.all([
      fetchJson(`repos/${repo}/commits/${headSha}`),
      fetchJson(`repos/${repo}/commits/${headSha}/status`),
      fetchJson(`repos/${repo}/commits/${headSha}/check-runs`, {
        paginate: true,
      }),
    ]);
    return {
      headCommittedAt: commitTimestamp(commitPayload ?? {}),
      statuses: statusPayload?.statuses ?? [],
      checkRuns: checkPayload?.check_runs ?? [],
    };
  }

  const [comments, reviewComments, reviews, commits, head] = await Promise.all([
    fallbacks.comments
      ? restList(`repos/${repo}/issues/${prNumber}/comments`)
      : mapIssueComments(pull.comments?.nodes ?? []),
    fallbacks.reviewComments
      ? restList(`repos/${repo}/pulls/${prNumber}/comments`)
      : mapReviewComments(threads),
    fallbacks.reviews
      ? restList(`repos/${repo}/pulls/${prNumber}/reviews`)
      : mapReviews(pull.reviews?.nodes ?? []),
    fallbacks.commits
      ? restList(`repos/${repo}/pulls/${prNumber}/commits`)
      : mapCommits(pull.commits?.nodes ?? []),
    resolveHead(),
  ]);

  return {
    pr: { ...(pr ?? {}), headCommittedAt: head.headCommittedAt },
    comments,
    attempts: extractAttempts(comments),
    reviewComments,
    reviews,
    commits,
    statuses: head.statuses,
    checkRuns: head.checkRuns,
    headSha,
    // Consumed by fetchAutoCoverContext for quota accounting; never written
    // into the per-PR context files.
    rateLimit: data?.rateLimit ?? null,
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

// Attempt records are the workflow-owned summary comments posted with the
// GITHUB_TOKEN. Counting only those keeps a copied marker in a human comment
// from consuming (or faking) a repair attempt.
const ATTEMPT_RECORD_LOGIN = 'github-actions[bot]';

function extractAttempts(comments = []) {
  return comments.filter(
    (comment) =>
      String(comment.body ?? '').includes(AUTO_COVER_MARKER) &&
      (comment.user?.login ?? comment.author?.login) === ATTEMPT_RECORD_LOGIN,
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

// Which transport fetches per-PR context. GraphQL has its own quota bucket,
// so it spares the (scarcer) REST one; REST stays the reference path and the
// fallback. A repository variable overrides the default without a commit:
// `rest` is the rollback switch, mirroring PR_FLOW_REVIEW_SOURCE.
const DEFAULT_AUTO_COVER_SOURCE = 'graphql';

function resolveAutoCoverSource(value = process.env.PR_FLOW_AUTO_COVER_SOURCE) {
  const requested = String(value ?? '')
    .trim()
    .toLowerCase();
  if (requested === '') return DEFAULT_AUTO_COVER_SOURCE;
  if (requested === 'graphql' || requested === 'rest') return requested;
  // A typo must never silently enable the newer path.
  console.warn(
    `fetch-auto-cover-context: unknown PR_FLOW_AUTO_COVER_SOURCE "${requested}", using rest.`,
  );
  return 'rest';
}

async function fetchAutoCoverContext({
  repo,
  prs,
  outDir,
  fetchJson,
  viewPull,
  graphql,
  source,
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
  // Production default: one GraphQL query per PR (its own rate-limit bucket),
  // with narrow REST fallbacks through `fetcher`. PR_FLOW_AUTO_COVER_SOURCE=rest
  // forces the legacy all-REST path; injecting only `fetchJson` (no `graphql`)
  // selects it too, which is how the legacy tests exercise that path.
  const gql =
    resolveAutoCoverSource(source) === 'rest' || (fetchJson && !graphql)
      ? null
      : graphql || createGraphqlFetcher();
  let graphqlCost = 0;
  let graphqlRemaining = null;
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
        const ctx = gql
          ? await fetchPrContextViaGraphql({
              graphql: gql,
              fetchJson: fetcher,
              viewPull: viewPr,
              repo,
              prNumber,
            })
          : await fetchPrContext({
              fetchJson: fetcher,
              viewPull: viewPr,
              repo,
              prNumber,
            });
        if (ctx.rateLimit) {
          graphqlCost += Number(ctx.rateLimit.cost ?? 0);
          graphqlRemaining = Number(ctx.rateLimit.remaining ?? 0);
        }
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
    // GraphQL bucket usage for this scan (0 when the REST path ran);
    // `remaining` is the last observed value, for quota monitoring.
    graphql: { cost: graphqlCost, remaining: graphqlRemaining },
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
  DEFAULT_AUTO_COVER_SOURCE,
  DEFAULT_CONCURRENCY,
  DEFAULT_FIX_REVIEW_WORKFLOW,
  PULL_REQUEST_CONTEXT_QUERY,
  assertNoGraphqlErrors,
  createGhFetcher,
  createGraphqlFetcher,
  createViewPull,
  isMissingResponse,
  mapWithConcurrency,
  extractAttempts,
  normalizeHeadSha,
  commitTimestamp,
  resolveAutoCoverSource,
  mapIssueComments,
  mapReviewComments,
  mapReviews,
  mapCommits,
  mapStatuses,
  mapCheckRuns,
  fetchFixReviewRuns,
  fetchPrContext,
  fetchPrContextViaGraphql,
  writeContextFiles,
  fetchAutoCoverContext,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
