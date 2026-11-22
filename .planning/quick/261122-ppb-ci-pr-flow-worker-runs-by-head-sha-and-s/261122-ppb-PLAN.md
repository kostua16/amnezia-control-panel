---
id: 261122-ppb
issue: 1163
branch: ci/pr-flow-worker-runs-by-head-sha
files:
  - .github/workflows/scripts/orchestrate-pr-flow.cjs
  - .github/workflows/scripts/lib/sticky-comment.cjs
  - .github/workflows/scripts/lib/worker-runs-by-head.cjs
  - .github/workflows/scripts/compare-worker-run-sources.cjs
  - .github/workflows/scripts/__tests__/worker-runs-by-head.test.cjs
  - .github/workflows/scripts/__tests__/orchestrate-pr-flow.test.cjs
  - .github/workflows/scripts/__tests__/sticky-comment.test.cjs
  - .github/workflows/pr-flow.yml
  - docs/workflow-e2e-scenarios.md
---

# Plan: worker runs by head sha + skip unchanged sticky comment

Issue: #1163. Goal: cut ~11 of ~24 REST calls per orchestrator wake without changing any decision.

## Facts (measured / verified)

- One wake (workflow_dispatch, writes intercepted and counted, `GH_DEBUG=api` for reads) on 6 open PRs: 13 REST reads + 7-11 writes, +5 GraphQL. 10 of the 13 reads are worker-run lookups: for each of 5 workers `gh run list --workflow <file> --limit 50 --json databaseId,status,conclusion,event,displayTitle,createdAt,updatedAt,url` = `GET /actions/workflows/<file>` + `GET /actions/workflows/N/runs`.
- `collectWorkerRuns(config, workerName)` (`orchestrate-pr-flow.cjs`, ~line 1980) returns that list; `getWorkerRuns` memoizes per worker name; `collectConfiguredWorkerRuns` fills all configured workers in the visibility step. Consumers: `summarizeWorkerRuns(workerRuns, workerName, pr)` and `getWorkerTargetUrl`.
- `matchesWorkerTitle` (~line 426): a run counts only if its display title contains `PR #<number>` AND the full `pr.headSha`. So only runs created for this head matter.
- Workers are dispatched by `dispatchWorker` with `--ref getWorkerDispatchRef(pr)`: the PR head branch for same-repo PRs, the BASE branch for cross-repository PRs. For same-repo PRs a dispatched run has `head_sha == pr.headSha` (when the branch has not moved since); for cross-repo PRs it does NOT (run head_sha is the base branch sha).
- `GET /repos/{repo}/actions/runs?head_sha=<sha>&per_page=100` returned `total_count=23` for #1159's head, each run has `path` (`.github/workflows/<file>`), `name`, `display_title`, `event`, `status`, `conclusion`, `created_at`, `updated_at`, `html_url`, `id`.
- `lib/sticky-comment.cjs` `upsertComment` default (`replaceExisting: true`): list comments (`--paginate`), POST a new comment, DELETE the old one, every call, even for an identical body. Other callers share this lib and must keep that behavior.

## Review corrections (independent review, verified; these override the text below where they conflict)

- **Not every worker run has `head_sha == pr.headSha`.** `fix-review.yml:513` dispatches `code-review.yml --ref main` and `project-manager.cjs` dispatches `dependency-review.yml` / `pr-finalizer.yml` on the base ref; such runs carry the PR number and head SHA only in `display_title`, with `head_sha` = the base branch sha (verified on run 31320791823: title `PR #1075 @ 676a597…`, head_branch `main`). So the lookup is the UNION of two reads: (a) `actions/runs?head_sha=<pr.headSha>&per_page=100` and (b) `actions/runs?event=workflow_dispatch&per_page=100` (covers base-ref dispatches). Dedupe by run `id`, then group by workflow file, then the existing `matchesWorkerTitle` filter applies unchanged. 2 REST calls replace 10. Do not change the dispatch sites.
- **Output size.** A 100-run response is ~1 MB and exceeds the 1 MiB `execFileSync` buffer (`ENOBUFS`). Both reads must pass `--jq` to keep only `{id, path, display_title, event, status, conclusion, created_at, updated_at, html_url}` plus `total_count`.
- **Truncation rule.** Validate `Number.isInteger(total_count) && Array.isArray(workflow_runs)`; head read: fall back when `total_count > workflow_runs.length`. The dispatch read is a recency window by nature (same as the old per-workflow `--limit 50`), so it is never treated as truncated, but `path` basename matching must strip any `@refs/...` suffix: `path.posix.basename(String(run.path ?? '').split('@')[0]) === worker.workflow` (so `code-review.yml` never collides with `antigravity-code-review.yml`).
- **Parity gate semantics.** The old per-workflow `--limit 50` window evicts runs repo-wide (live check: it still holds runs for only 3/21 open PRs for `code-review.yml`), while the new union keeps them, so "zero differences" is wrong. Classify per PR and worker: `new ⊇ old` (new additionally sees older runs of that PR+head) = expected improvement, reported but not failing; any case where old found a matching run that new missed = regression and exit 1; where both see the same set, `active`/`latest`/`failedCount`/target url must be identical. Report how many PRs have extra older runs in new, because `failedCount` feeds the retry caps (`MAX_CODE_REVIEW_RETRIES`, `MAX_FINALIZER_RETRIES`) and extra history can only make a cap trigger sooner, never later; say so in the PR.
- **Sticky comment: the body is never byte-identical.** `renderFlowComment` puts `[run](${status.targetUrl})` in every worker row and many `targetUrl`s default to `currentRunUrl` (contains `GITHUB_RUN_ID`, changes every wake), so `existing.body === body` would never match in Actions (it only matches in local dry runs where `GITHUB_RUN_ID` is unset). Rule: when a worker row's new link equals `currentRunUrl`, keep the existing row's link if the existing comment has a row for that worker; then compare. Rows whose link is a worker-run URL are compared as they are (a changed worker link is a real change and rewrites the comment). Implement as a pure `stabilizeRunLinks(existingBody, newBody, currentRunUrl)` next to the renderer, with tests that use two different `GITHUB_RUN_ID` values and assert 0 writes when nothing else changed and 1 post+delete when a worker link, state, reason or any other line changed. Do not call `writeTempJson` before the skip check.
- **Rollback switch.** Add `.github/workflows/pr-flow.yml` to `files:`; `PR_FLOW_WORKER_RUNS_SOURCE: ${{ vars.PR_FLOW_WORKER_RUNS_SOURCE || '' }}` with a pure `resolveWorkerRunsSource` (`head` default, `legacy`, anything unknown -> `legacy` with one warning) and a test for it.

## Behavior

1. **Worker runs by head.** New `lib/worker-runs-by-head.cjs`:
   - `fetchRunsForHead({ repo, headSha, run })`: `GET repos/{repo}/actions/runs?head_sha=<sha>&per_page=100` (`gh api`); returns `{ runs, total }`; throws on non-zero exit or unexpected shape.
   - `groupWorkerRuns(runs, config)`: maps REST fields to the `gh run list` shape the existing code reads (`id`->`databaseId`, `display_title`->`displayTitle`, `created_at`->`createdAt`, `updated_at`->`updatedAt`, `html_url`->`url`, `status`, `conclusion`, `event`) and groups by worker using the worker's `workflow` file name compared with the basename of the run `path`.
   - In `main`, build the per-worker arrays from ONE call when ALL hold: PR is not cross-repository, `total <= runs.length` (single page, no truncation), the read succeeded. Otherwise use the existing `collectWorkerRuns` per worker (unchanged), also on any thrown error (log one warning, then fall back).
   - Keep `collectWorkerRuns` and the lazy `getWorkerRuns` contract: a worker array must be exactly what the old path would give for that head (old path lists the latest 50 runs of the workflow across heads, then `matchesWorkerTitle` filters by PR+head; new path lists all runs of the head, then the same filter applies, so results after filtering must be identical).
2. **Sticky comment.** `upsertComment({ ..., skipIfUnchanged })`: when `existing` is found and `existing.body === body`, return without any write. Default `false` (no behavior change for other callers); the orchestrator passes `true`. `listComments` stays as is in this PR.

## Tasks

1. Implement `lib/worker-runs-by-head.cjs` + wiring in `orchestrate-pr-flow.cjs` (selection, fallback, one-warning logging).
2. Implement `skipIfUnchanged` in `lib/sticky-comment.cjs` and pass it from `upsertFlowComment` in the orchestrator only.
3. Parity script `compare-worker-run-sources.cjs --open --merged 30`: for every PR run both lookups for all configured workers, apply `summarizeWorkerRuns`, diff `{active.id, latest.id, failedCount}` and the target url per worker; read-only (GET only); exit 1 on any difference; print totals and the measured REST call count per PR (old 10 vs new 1). Run it for real with the local `gh` and paste the table in the PR.
4. Tests: grouping and field mapping; basename matching (`code-review.yml` vs `antigravity-code-review.yml` must not collide); single-page success; `total` greater than page size falls back; cross-repo falls back; thrown read falls back with exactly one warning; sticky comment skip when body equal, post+delete when different, post when no existing, default `false` unchanged; orchestrator passes `skipIfUnchanged: true`.
5. Docs: scenario rows in `docs/workflow-e2e-scenarios.md` (worker lookup by head with fallback; unchanged sticky comment is not rewritten) and the tests mapping line.

## Verification (all required, paste results in the PR)

- `npm run test-only` and `cd .github/workflows && node --test scripts/__tests__/*.test.cjs`; compare failing sets against clean `origin/main` (Windows `core.autocrlf=true` baseline CRLF failures exist; the new `checkout-before-local-action` invariant also fails on Windows at baseline).
- `npx prettier --check` and `npx eslint --no-ignore` on changed `.cjs`.
- Parity table (task 3) with zero differences. Any difference blocks.
- Instrumented dry count: REST calls per wake before/after on 3 PRs (writes intercepted), pasted in the PR.

## Out of scope

Status posting, labels, GraphQL review inputs, triggers/concurrency, `watch-pr-flow.cjs`, `makeDecision` logic, other `upsertComment` callers.

## Rollback

Env `PR_FLOW_WORKER_RUNS_SOURCE=legacy` forces the old per-worker lookup (wire it in `pr-flow.yml` as a repository variable like `PR_FLOW_REVIEW_SOURCE`); or revert.
