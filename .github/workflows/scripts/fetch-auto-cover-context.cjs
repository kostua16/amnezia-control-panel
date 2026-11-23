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
// GraphQL, which has its own rate-limit bucket: the shared
// lib/review-inputs-graphql.cjs adapter (the same one orchestrate-pr-flow
// uses) plus one small Auto Cover commits query. A full scan now costs the
// shared 5000/h REST quota only the single repo-wide fix-review run listing.
// The lib returns REST-shaped objects (snake_case fields, lowercase enums,
// `[bot]` logins, REST ids), so the written files keep their consumer
// contract. PR_FLOW_AUTO_COVER_SOURCE=rest is the ops rollback switch back to
// the legacy all-REST path, and any GraphQL doubt falls back to REST per PR.
//
// Error policy: commit status / check-run lookups legitimately return "no data"
// (HTTP 404) for fresh commits and are mapped to []. Rate-limit (403/429), 5xx,
// and network failures are rethrown so the workflow fails loudly instead of
// silently masking the missing data as empty (which would skew the coverage
// decision toward "no blocker").

const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const {
  fetchReviewInputsGraphql,
  MAX_PAGES_PER_CONNECTION,
} = require('./lib/review-inputs-graphql.cjs');
const { MAX_RETRIES, RETRY_BASE_MS, isTransient } = require('./lib/retry.cjs');
// Shared gh GraphQL arg building (the load-bearing -f/-F split) and the
// head-commit-date precedence helper — the exact ones orchestrate-pr-flow
// uses, so both GraphQL consumers speak to `gh api graphql` the same way.
// The transport itself is Auto Cover's own: it needs a large maxBuffer and a
// scan-wide retry budget (see createAutoCoverGraphqlRunner).
const {
  buildGraphqlArgs,
  headCommittedAtFromCommits,
} = require('./orchestrate-pr-flow.cjs');

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

// Auto Cover-specific GraphQL additions. Everything shared with the PR
// orchestrator (issue comments, review threads, reviews, check runs, commit
// statuses; cursor pagination, error handling, `[bot]` login and enum mapping,
// repo/PR validation) comes from lib/review-inputs-graphql.cjs — one source of
// truth, no second copy. The PR commits list is the only connection Auto Cover
// needs that the shared query does not carry (evaluate-auto-cover-review
// counts `fix(review):` commits), so it gets its own small paginated query.
const AUTO_COVER_COMMITS_QUERY = `
query AutoCoverPrCommits(
  $owner: String!, $name: String!, $number: Int!, $after: String
) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { commit { oid message authoredDate committedDate } }
      }
    }
  }
}
`;

// Same validation as lib/review-inputs-graphql.cjs: `Number(null)`,
// `Number('')` and negatives must not reach GitHub as PR 0.
function assertRepoAndNumber(repo, prNumber) {
  const repoParts = String(repo ?? '').split('/');
  if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) {
    throw new Error('repo must be exactly owner/name.');
  }
  const number = Number(prNumber);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error('prNumber must be a positive integer.');
  }
  return { owner: repoParts[0], name: repoParts[1], number };
}

// Synchronous, cursor-paginated commits read. A response carrying `errors`
// (or a null pullRequest) throws instead of degrading to a short/empty list,
// so a GraphQL incident can never silently shrink the attempt count; an
// overflow beyond MAX_PAGES_PER_CONNECTION throws too and the caller reads
// the paginated REST endpoint instead.
function fetchPrCommitsGraphql({ runGraphql, repo, prNumber }) {
  const { owner, name, number } = assertRepoAndNumber(repo, prNumber);
  const nodes = [];
  let after = null;
  for (let page = 0; ; page++) {
    const response = runGraphql(AUTO_COVER_COMMITS_QUERY, {
      owner,
      name,
      number,
      after,
    });
    if (!response || typeof response !== 'object') {
      throw new Error('GraphQL response was not an object.');
    }
    if (Array.isArray(response.errors) && response.errors.length > 0) {
      const first = response.errors[0]?.message ?? 'unknown error';
      throw new Error(`GraphQL returned errors: ${first}`);
    }
    const connection = response.data?.repository?.pullRequest?.commits;
    if (
      !connection ||
      !Array.isArray(connection.nodes) ||
      !connection.pageInfo ||
      typeof connection.pageInfo.hasNextPage !== 'boolean'
    ) {
      throw new Error('GraphQL response is missing the commits connection.');
    }
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return nodes;
    if (page + 1 >= MAX_PAGES_PER_CONNECTION) {
      throw new Error(
        `PR commits exceed ${MAX_PAGES_PER_CONNECTION} pages; falling back.`,
      );
    }
    if (!connection.pageInfo.endCursor) {
      throw new Error('PR commits has a next page without an end cursor.');
    }
    after = connection.pageInfo.endCursor;
  }
}

// GraphQL commit nodes -> the REST `pulls/{n}/commits` item shape
// countFixReviewCommits and commitTimestamp read.
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

// Which transport feeds the Auto Cover context fetch. GraphQL has its own
// quota bucket, so it spares the (scarcer) REST one; REST stays the reference
// path and the fallback. A repository variable flips the default without a
// commit: `rest` is the rollback switch (same escape-hatch pattern as
// PR_FLOW_REVIEW_SOURCE in orchestrate-pr-flow.cjs).
const DEFAULT_CONTEXT_SOURCE = 'graphql';

function resolveAutoCoverSource(value = process.env.PR_FLOW_AUTO_COVER_SOURCE) {
  const requested = String(value ?? '')
    .trim()
    .toLowerCase();
  if (requested === '') return DEFAULT_CONTEXT_SOURCE;
  if (requested === 'graphql' || requested === 'rest') return requested;
  // A typo must never silently keep the newer path.
  console.warn(
    `fetch-auto-cover-context: unknown PR_FLOW_AUTO_COVER_SOURCE "${requested}", using rest.`,
  );
  return 'rest';
}

// Per-scan GraphQL quota accounting. `cost` sums every response seen —
// including 200-with-errors payloads and transport failures whose body still
// carries `data.rateLimit` — so usage is never under-reported exactly when
// queries fail. `remaining` keeps the MINIMUM finite value seen (the low-water
// mark across the concurrent workers), and an unknown/missing value stays
// null instead of collapsing to 0, which a monitor would read as "GraphQL
// quota exhausted".
function createGraphqlStats() {
  return { cost: 0, remaining: null, fellBack: false };
}

// Number(null) is 0 and Number('') is 0 — both finite — so a raw Number()
// guard would turn a missing value into "0 remaining" (reads as exhausted).
// Only real numeric values pass; anything else is unknown -> null.
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordRateLimit(stats, payload) {
  const rateLimit = payload?.data?.rateLimit;
  if (!rateLimit) return;
  const cost = toFiniteNumber(rateLimit.cost);
  if (cost !== null) stats.cost += cost;
  const remaining = toFiniteNumber(rateLimit.remaining);
  if (remaining !== null) {
    stats.remaining =
      stats.remaining === null
        ? remaining
        : Math.min(stats.remaining, remaining);
  }
}

// Wraps a runGraphql transport so every response — success, 200-with-errors,
// or a thrown transport failure — contributes its rateLimit numbers to stats.
function withRateLimitRecording(runGraphql, stats) {
  return (query, variables) => {
    let response;
    try {
      response = runGraphql(query, variables);
    } catch (error) {
      // execFileSync failures keep the response body on `error.stdout`; a
      // JSON error response can still carry the real rateLimit numbers.
      try {
        recordRateLimit(stats, JSON.parse(String(error?.stdout ?? '')));
      } catch {
        // No parseable body: this query's cost is unknowable.
      }
      throw error;
    }
    recordRateLimit(stats, response);
    return response;
  };
}

// 64 MiB, matching the REST and `gh pr view` fetchers: a comment-heavy PR can
// push a GraphQL response past Node's 1 MiB execFileSync default, and an
// ENOBUFS there would silently drop the PR to the 7-call REST path.
const GRAPHQL_MAX_BUFFER = 64 * 1024 * 1024;
// Per-call kill switch: without it a timeout-class transient (dial/TLS hang,
// stalled response) can pin execFileSync for the OS network timeout on EVERY
// attempt — ~20 queries x 3 attempts would eat the `cover` job's 10-minute cap
// even though the retry-sleep budget below is respected.
const GRAPHQL_TIMEOUT_MS = 30_000;
// Cumulative retry-sleep budget for ONE scan. The transport is synchronous
// and the `cover` job caps at 10 minutes, so during a GraphQL 5xx incident
// unbounded per-query backoff (MAX_RETRIES per query x up to 100 PRs) could
// exceed the job timeout on sleeps alone. Once the budget is spent the
// transport marks itself degraded and every remaining PR goes straight to
// the REST fallback without sleeping.
const DEFAULT_RETRY_BUDGET_MS = 60_000;
// Cumulative WALL-CLOCK budget for the whole GraphQL phase of a scan: sleeps
// are not the only cost — slow-but-successful queries add up too. Past this
// the transport degrades to REST for the remaining PRs, keeping the scan
// inside the job timeout even when every query is merely slow.
const DEFAULT_WALL_BUDGET_MS = 240_000;

// Cross-platform synchronous sleep (the lib's runGraphql contract is sync).
// Trade-off: Atomics.wait blocks the event loop, so other workers' async REST
// fallbacks stall for the duration of a backoff. Accepted deliberately: the
// retry budget caps total stall at DEFAULT_RETRY_BUDGET_MS per scan, and an
// async transport would mean restructuring the shared lib's paging loop.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// execFileSync kills the child on `timeout` (SIGTERM, error.killed) and Go's
// net stack can surface ETIMEDOUT; neither appears in gh's "HTTP 5xx" stderr,
// so timeout kills get their own transient classification.
function isTimeoutKill(error) {
  return (
    error?.killed === true ||
    error?.code === 'ETIMEDOUT' ||
    error?.signal === 'SIGTERM'
  );
}

// Auto Cover's gh GraphQL transport: same arg building as orchestrate-pr-flow,
// but with a large maxBuffer, a per-call timeout, a scan-wide retry-sleep
// budget and a scan-wide wall-clock budget. `budget.degraded` flips true once
// any bound is exhausted; callers check it to skip GraphQL entirely for the
// remaining PRs.
function createAutoCoverGraphqlRunner({
  execFileSyncImpl = execFileSync,
  sleep = sleepSync,
  retryBudgetMs = DEFAULT_RETRY_BUDGET_MS,
  wallBudgetMs = DEFAULT_WALL_BUDGET_MS,
  now = Date.now,
} = {}) {
  const budget = {
    remainingMs: Number(retryBudgetMs) || 0,
    degraded: false,
  };
  const startedAt = now();
  const wallBudget = Number(wallBudgetMs) || 0;
  function runQuery(query, variables) {
    if (now() - startedAt >= wallBudget) {
      budget.degraded = true;
      throw new Error(
        `GraphQL wall-clock budget (${wallBudget}ms) spent; degrading to REST.`,
      );
    }
    const args = buildGraphqlArgs(query, variables);
    for (let attempt = 0; ; attempt++) {
      try {
        const stdout = execFileSyncImpl('gh', args, {
          encoding: 'utf8',
          maxBuffer: GRAPHQL_MAX_BUFFER,
          timeout: GRAPHQL_TIMEOUT_MS,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return JSON.parse(String(stdout ?? '').trim() || '{}');
      } catch (error) {
        const stderr = String(error?.stderr ?? '');
        const transient = isTransient(stderr) || isTimeoutKill(error);
        if (!transient || attempt >= MAX_RETRIES - 1) throw error;
        const delay = RETRY_BASE_MS * 2 ** attempt;
        if (budget.degraded || delay > budget.remainingMs) {
          // Budget spent: no more sleeping; every remaining PR falls back to
          // REST immediately.
          budget.degraded = true;
          throw error;
        }
        budget.remainingMs -= delay;
        console.warn(
          `fetch-auto-cover-context: transient GraphQL error, retrying in ${delay}ms ` +
            `(retry budget left ${budget.remainingMs}ms): ${stderr.split('\n')[0]}`,
        );
        sleep(delay);
      }
    }
  }
  return { runQuery, budget };
}

// GraphQL-backed replacement for fetchPrContext: the shared lib query covers
// comments, review threads, reviews, check runs and commit statuses (REST
// shapes, cursor pagination, loud errors); one small extra query covers the
// PR commits list. On ANY doubt the lib throws ReviewInputsUnavailable and
// this function reads REST for the whole PR instead — partial GraphQL data
// can never silently become an empty context. `stats` (optional) collects the
// GraphQL quota numbers for the scan manifest.
async function fetchPrContextAuto({
  runGraphql,
  fetchJson,
  viewPull,
  repo,
  prNumber,
  stats = null,
}) {
  const gql = stats ? withRateLimitRecording(runGraphql, stats) : runGraphql;
  const markFallback = () => {
    if (stats) stats.fellBack = true;
  };
  const pr = await viewPull(prNumber);
  const headSha = normalizeHeadSha(pr);
  // Reuse the already-fetched `gh pr view` payload on the REST path. The flag
  // is set only AFTER the REST read succeeded: a PR whose fallback also failed
  // belongs in `failed` alone, never in `manifest.graphql.fallbackPrs`.
  const restFallback = async () => {
    const ctx = await fetchPrContext({
      fetchJson,
      viewPull: async () => pr,
      repo,
      prNumber,
    });
    markFallback();
    return ctx;
  };

  if (!headSha) return restFallback();

  let inputs;
  try {
    inputs = fetchReviewInputsGraphql({
      repo,
      prNumber,
      headSha,
      runGraphql: gql,
    });
  } catch (error) {
    console.warn(
      `fetch-auto-cover-context: PR #${prNumber} GraphQL inputs unavailable, using REST: ${error.message}`,
    );
    return restFallback();
  }

  let commits;
  let rawCommits = null;
  try {
    rawCommits = fetchPrCommitsGraphql({ runGraphql: gql, repo, prNumber });
    commits = mapCommits(rawCommits);
  } catch (error) {
    console.warn(
      `fetch-auto-cover-context: PR #${prNumber} GraphQL commits unavailable, using REST: ${error.message}`,
    );
    commits =
      (await fetchJson(`repos/${repo}/pulls/${prNumber}/commits`, {
        paginate: true,
      })) ?? [];
    markFallback();
  }

  // Same precedence as orchestrate-pr-flow (headCommittedAtFromCommits): the
  // GraphQL commits list carries the head commit date; anything unusable
  // falls back to the REST commit read.
  let headCommittedAt = rawCommits
    ? headCommittedAtFromCommits(
        rawCommits.map((node) => node.commit ?? {}),
        headSha,
      )
    : '';
  if (!headCommittedAt) {
    const payload = await fetchJson(`repos/${repo}/commits/${headSha}`);
    headCommittedAt = commitTimestamp(payload ?? {});
    markFallback();
  }

  return {
    pr: { ...(pr ?? {}), headCommittedAt },
    comments: inputs.comments,
    attempts: extractAttempts(inputs.comments),
    reviewComments: inputs.reviewComments,
    reviews: inputs.reviews,
    commits,
    statuses: inputs.statuses,
    checkRuns: inputs.checkRuns,
    headSha,
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

async function fetchAutoCoverContext({
  repo,
  prs,
  outDir,
  fetchJson,
  viewPull,
  runGraphql,
  createGraphqlRunner,
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
      // Stable shape: quota monitors can read manifest.graphql on every scan,
      // including empty ones.
      graphql: { cost: 0, remaining: null, fallbackPrs: [] },
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
  // Transport selection is explicit: `source` (or PR_FLOW_AUTO_COVER_SOURCE,
  // default `graphql`) picks the shared-lib GraphQL path with per-PR REST
  // fallback, or the legacy all-REST path. Tests inject either a plain
  // `runGraphql` function or a whole `createGraphqlRunner` factory (for the
  // retry-budget/degraded behaviour); production uses the Auto Cover runner
  // with its 64 MiB buffer and scan-wide retry budget.
  const resolvedSource = source ?? resolveAutoCoverSource();
  let gqlRunner = null;
  if (resolvedSource === 'graphql') {
    gqlRunner = runGraphql
      ? { runQuery: runGraphql, budget: { degraded: false } }
      : (createGraphqlRunner ?? createAutoCoverGraphqlRunner)();
  }
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
      // One stats object per PR (no shared mutation between workers); even a
      // failed PR keeps whatever its GraphQL responses reported, so cost is
      // counted for queries that errored mid-fetch.
      const stats = createGraphqlStats();
      try {
        let ctx;
        if (gqlRunner && !gqlRunner.budget.degraded) {
          ctx = await fetchPrContextAuto({
            runGraphql: gqlRunner.runQuery,
            fetchJson: fetcher,
            viewPull: viewPr,
            repo,
            prNumber,
            stats,
          });
        } else {
          // REST source, or the GraphQL transport degraded (retry-sleep or
          // wall-clock budget spent): go straight to REST without another
          // GraphQL attempt or any sleeping. The degraded flag is set only
          // AFTER the read succeeded, so a failed PR never appears in
          // manifest.graphql.fallbackPrs.
          ctx = await fetchPrContext({
            fetchJson: fetcher,
            viewPull: viewPr,
            repo,
            prNumber,
          });
          if (gqlRunner) stats.fellBack = true;
        }
        writeContextFiles(outDir, prNumber, ctx, fixReviewRuns);
        return { pr: prNumber, ok: true, stats };
      } catch (error) {
        return {
          pr: prNumber,
          ok: false,
          error: String(error?.message || error),
          stats,
        };
      }
    },
  );

  const ok = results.filter((r) => r.ok).map((r) => r.pr);
  const failed = results
    .filter((r) => !r.ok)
    .map(({ pr, error }) => ({ pr, error }));

  // Scan-level GraphQL quota numbers: summed cost, the minimum finite
  // `remaining` seen across all workers (the true low-water mark, not
  // whichever worker happened to finish last; unknown stays null), and the
  // PRs that needed a REST fallback so a degraded scan is distinguishable
  // from a healthy one.
  const graphql = { cost: 0, remaining: null, fallbackPrs: [] };
  for (const result of results) {
    const stats = result?.stats;
    if (!stats) continue;
    graphql.cost += stats.cost;
    if (stats.remaining !== null) {
      graphql.remaining =
        graphql.remaining === null
          ? stats.remaining
          : Math.min(graphql.remaining, stats.remaining);
    }
    if (stats.fellBack) graphql.fallbackPrs.push(result.pr);
  }

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
    graphql,
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
  AUTO_COVER_COMMITS_QUERY,
  DEFAULT_CONCURRENCY,
  DEFAULT_CONTEXT_SOURCE,
  DEFAULT_FIX_REVIEW_WORKFLOW,
  createGhFetcher,
  createViewPull,
  isMissingResponse,
  mapWithConcurrency,
  extractAttempts,
  normalizeHeadSha,
  commitTimestamp,
  assertRepoAndNumber,
  createGraphqlStats,
  recordRateLimit,
  withRateLimitRecording,
  createAutoCoverGraphqlRunner,
  GRAPHQL_MAX_BUFFER,
  GRAPHQL_TIMEOUT_MS,
  DEFAULT_RETRY_BUDGET_MS,
  DEFAULT_WALL_BUDGET_MS,
  isTimeoutKill,
  fetchPrCommitsGraphql,
  mapCommits,
  resolveAutoCoverSource,
  fetchFixReviewRuns,
  fetchPrContext,
  fetchPrContextAuto,
  writeContextFiles,
  fetchAutoCoverContext,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
