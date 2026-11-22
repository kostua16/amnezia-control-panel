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
// Applying --jq inside gh keeps the captured stdout to the fields the
// orchestrator reads; the full page still crosses the wire.
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

// A repo-wide recency window shared by every workflow_dispatch trigger, so it
// can cover a far shorter history than the per-workflow `--limit 50` it
// replaces; truncation must degrade to the per-workflow lookup, like the head
// read (checked by the caller).
function fetchDispatchRuns({ repo, run }) {
  return readRunsPage({ repo, query: 'event=workflow_dispatch', run });
}

// How far ahead of the clock a head commit's committer date may lie before it
// is treated as unknown: contributor clocks drift by seconds, not by much more.
const CLOCK_SKEW_MS = 5 * 60 * 1000;

// Returns null when the dispatch listing is complete for runs created at or
// after `headCommittedAt`: either it returned every dispatch run that exists,
// or its oldest run is not newer than the head commit. Otherwise returns the
// reason it cannot be trusted, for the fallback warning. A head commit date
// that is unknown, unparseable or ahead of the clock is never trusted: an
// empty value usually means the commit read failed, and a committer date in
// the future (skewed contributor clock, GIT_COMMITTER_DATE) would make any
// truncated window look complete.
function dispatchWindowGap(dispatched, headCommittedAt, now = Date.now()) {
  if (dispatched.total <= dispatched.runs.length) return null;
  const headTime = Date.parse(String(headCommittedAt ?? ''));
  if (Number.isNaN(headTime)) {
    return 'workflow_dispatch window unchecked: head commit date unavailable';
  }
  if (headTime > now + CLOCK_SKEW_MS) {
    return `workflow_dispatch window unchecked: head commit date ${headCommittedAt} is ahead of the clock`;
  }
  let oldest = Infinity;
  for (const runItem of dispatched.runs) {
    const created = Date.parse(String(runItem.created_at ?? ''));
    if (Number.isNaN(created)) {
      return 'workflow_dispatch window unchecked: a dispatch run has no readable created_at';
    }
    if (created < oldest) oldest = created;
  }
  return oldest <= headTime
    ? null
    : 'workflow_dispatch window does not reach the head commit';
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
      // The dispatch read goes first: when its window does not reach the head
      // commit the whole lookup degrades anyway, so the head read is skipped
      // and an idle PR pays one extra read instead of two.
      const dispatched = fetchDispatch({ repo, run });
      // The dispatch window is shared by all workflows' dispatches and its
      // total_count is the repository-wide lifetime count, so only its reach
      // relative to the head commit tells whether it holds this PR's runs. A
      // run dispatched for this head cannot predate the head commit; when the
      // window cannot be trusted, base-ref runs of an idle PR may have fallen
      // out of it and the per-workflow lookup is the only read with a
      // per-worker guarantee.
      const gap = dispatchWindowGap(dispatched, pr.headCommittedAt);
      if (gap) {
        warn(
          `orchestrate-pr-flow: ${gap} (head ${pr.headSha}), using per-workflow lookup.`,
        );
        return grouped;
      }
      const head = fetchHead({ repo, headSha: pr.headSha, run });
      if (head.total > head.runs.length) {
        warn(
          `orchestrate-pr-flow: ${head.total} runs on ${pr.headSha} exceed one page, using per-workflow lookup.`,
        );
        return grouped;
      }
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
  dispatchWindowGap,
  fetchDispatchRuns,
  fetchRunsForHead,
  groupWorkerRuns,
  resolveWorkerRunsSource,
  toRunListShape,
  workflowFileOf,
};
