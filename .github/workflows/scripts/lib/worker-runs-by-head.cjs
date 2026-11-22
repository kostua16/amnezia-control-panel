/* eslint-disable @typescript-eslint/no-require-imports */
// Worker-run lookup for the PR orchestrator that costs 2 REST reads per wake
// instead of 2 per configured worker (`gh run list --workflow <file>` first
// resolves the workflow, then lists its runs).
//
// A worker run only counts for a PR when its display title carries both
// `PR #<n>` and the full head SHA (see matchesWorkerTitle). Two populations
// can satisfy that:
//
//   1. Runs whose `head_sha` is the PR head. Workers dispatched on the PR head
//      branch (same-repository PRs) land here: one `?head_sha=` read.
//   2. Runs dispatched on the BASE branch (fix-review -> code-review,
//      project-manager -> dependency-review / pr-finalizer). Their `head_sha`
//      is the base branch tip; the PR number and head SHA only live in the run
//      title. They are reached through the recent `workflow_dispatch` runs.
//
// Filtering by `head_sha` alone would therefore silently lose population 2, so
// both reads are unioned (deduped by run id) before the unchanged title filter
// decides what matters. Anything that makes the union unreliable falls back to
// the per-workflow lookup, which stays the reference implementation.
const path = require('node:path');

const SOURCE_HEAD = 'head';
const SOURCE_LEGACY = 'legacy';

// A page of 100 full run objects is ~1 MB, past the 1 MiB execFileSync buffer.
// Trimming server-side keeps the response to the fields the orchestrator reads.
const RUN_FIELDS_JQ =
  '{total_count, workflow_runs: [.workflow_runs[] | {id, path, head_sha, display_title, event, status, conclusion, created_at, updated_at, html_url}]}';

// `head` is the default; `legacy` is the rollback switch. A typo must never
// silently enable the newer path, so anything unknown behaves like `legacy`.
function resolveWorkerRunsSource(
  value = process.env.PR_FLOW_WORKER_RUNS_SOURCE,
  warn = console.warn,
) {
  const requested = String(value ?? '')
    .trim()
    .toLowerCase();
  if (requested === '') return SOURCE_HEAD;
  if (requested === SOURCE_HEAD || requested === SOURCE_LEGACY) {
    return requested;
  }
  warn(
    `orchestrate-pr-flow: unknown PR_FLOW_WORKER_RUNS_SOURCE "${requested}", using legacy per-workflow lookup.`,
  );
  return SOURCE_LEGACY;
}

function parseRunsPage(raw) {
  const page = JSON.parse(raw);
  if (
    !Number.isInteger(page?.total_count) ||
    !Array.isArray(page?.workflow_runs)
  ) {
    throw new Error('unexpected workflow runs response shape');
  }
  return { runs: page.workflow_runs, total: page.total_count };
}

function readRunsPage({ repo, query, run }) {
  const output = run(
    'gh',
    [
      'api',
      `repos/${repo}/actions/runs?${query}&per_page=100`,
      '--jq',
      RUN_FIELDS_JQ,
    ],
    { retry: true },
  );
  return parseRunsPage(output);
}

function fetchRunsForHead({ repo, headSha, run }) {
  return readRunsPage({
    repo,
    query: `head_sha=${encodeURIComponent(headSha)}`,
    run,
  });
}

// A recency window by nature, exactly like the per-workflow `--limit 50` it
// replaces, so it is never treated as truncated.
function fetchDispatchRuns({ repo, run }) {
  return readRunsPage({ repo, query: 'event=workflow_dispatch', run });
}

// The workflow file a run belongs to. `path` can carry an `@refs/...` suffix;
// comparing basenames keeps `code-review.yml` from matching
// `antigravity-code-review.yml`.
function workflowFileOf(runItem) {
  return path.posix.basename(String(runItem.path ?? '').split('@')[0]);
}

// Same field names and empty-conclusion convention as
// `gh run list --json databaseId,status,conclusion,event,displayTitle,createdAt,updatedAt,url`
// so everything downstream reads both sources identically.
function toRunListShape(runItem) {
  return {
    databaseId: runItem.id,
    status: runItem.status,
    conclusion: runItem.conclusion ?? '',
    event: runItem.event,
    displayTitle: runItem.display_title,
    createdAt: runItem.created_at,
    updatedAt: runItem.updated_at,
    url: runItem.html_url,
  };
}

function groupWorkerRuns(runs, config) {
  const byId = new Map();
  for (const runItem of runs) {
    if (!byId.has(runItem.id)) byId.set(runItem.id, runItem);
  }
  const unique = [...byId.values()];

  const grouped = {};
  for (const [workerName, worker] of Object.entries(config.workers ?? {})) {
    grouped[workerName] = worker?.workflow
      ? unique
          .filter((runItem) => workflowFileOf(runItem) === worker.workflow)
          .map(toRunListShape)
      : [];
  }
  return grouped;
}

// Returns `getWorkerRuns(workerName)`. The two reads happen at most once per
// loader, on the first call; every later call is served from that snapshot.
function createWorkerRunsLoader({
  config,
  pr,
  getRepo,
  run,
  loadLegacy,
  source = resolveWorkerRunsSource(),
  fetchHead = fetchRunsForHead,
  fetchDispatch = fetchDispatchRuns,
  warn = console.warn,
}) {
  let grouped;

  function loadGrouped() {
    if (grouped !== undefined) return grouped;
    grouped = null;
    if (source !== SOURCE_HEAD) return grouped;
    // Cross-repository workers are dispatched on the base ref, so a head-sha
    // read would not find their runs at all.
    if (pr.isCrossRepository || !pr.headSha) return grouped;

    try {
      // Resolved inside the try so a missing repository variable degrades to
      // the per-workflow lookup instead of aborting the wake.
      const repo = getRepo();
      const head = fetchHead({ repo, headSha: pr.headSha, run });
      if (head.total > head.runs.length) {
        warn(
          `orchestrate-pr-flow: ${head.total} runs on ${pr.headSha} exceed one page, using per-workflow lookup.`,
        );
        return grouped;
      }
      const dispatched = fetchDispatch({ repo, run });
      grouped = groupWorkerRuns([...head.runs, ...dispatched.runs], config);
    } catch (error) {
      grouped = null;
      warn(
        `orchestrate-pr-flow: worker runs by head unavailable, using per-workflow lookup: ${error.message}`,
      );
    }
    return grouped;
  }

  return (workerName) => {
    const groups = loadGrouped();
    return groups ? (groups[workerName] ?? []) : loadLegacy(workerName);
  };
}

module.exports = {
  createWorkerRunsLoader,
  fetchDispatchRuns,
  fetchRunsForHead,
  groupWorkerRuns,
  resolveWorkerRunsSource,
  toRunListShape,
  workflowFileOf,
};
